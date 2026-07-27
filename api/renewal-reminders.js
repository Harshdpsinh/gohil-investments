import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'

const DEFAULT_PROMPT = 'Please renew your policy on time to keep your insurance protection active without interruption.'
const DEFAULT_INTERVALS = [30, 15, 7, 1, 0].map(days => ({ id: `d${days}`, days, enabled: true }))
const STOP_STATUSES = new Set(['Renewed-Out', 'Cancelled', 'Matured'])

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })

  // Fail closed. A missing secret must never mean "no auth required" — this endpoint
  // sends WhatsApp messages to the entire client book.
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res.status(503).json({ error: 'CRON_SECRET is not configured. Refusing to run.' })
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const db = getAdminDb()
    const settings = normaliseSettings((await db.collection('renewal_reminder_settings').doc('active').get()).data())
    if (!settings.enabled) return res.status(200).json({ sent: 0, skipped: 0, disabled: true })

    const evolution = getEvolutionConfig()
    const policySnap = await db.collection('policies').get()
    const enabledDays = new Set(settings.intervals.filter(item => item.enabled).map(item => item.days))
    let sent = 0
    let skipped = 0

    // Pass 1 — decide which policies are due today. The whole collection still has to be
    // scanned: the due date can come from nextPremiumDue, expiryDate or renewalDate, and
    // legacy rows store dates as DD/MM/YYYY, so no single indexed range query is safe here.
    const due = []
    for (const doc of policySnap.docs) {
      const policy = { id: doc.id, ...doc.data() }
      const dueDate = getPolicyDueDate(policy)
      const daysBefore = daysUntil(dueDate)
      const status = String(policy.status || 'Active').trim()
      if (!dueDate || !enabledDays.has(daysBefore) || STOP_STATUSES.has(status) || policy.is_renewed) {
        skipped += 1
        continue
      }
      due.push({ policy, dueDate, daysBefore })
    }

    // Only load the clients those policies actually need, instead of the whole collection.
    const clients = due.length ? await loadClientsForPolicies(db, due.map(item => item.policy)) : []

    // Pass 2 — send.
    for (const { policy, dueDate, daysBefore } of due) {
      const client = findPolicyClient(policy, clients)
      const mobile = policy.clientMobile || client?.mobile || ''
      if (!digits(mobile)) {
        skipped += 1
        continue
      }

      const message = buildMessage({ policy, client, dueDate, daysBefore, settings })
      const id = reminderKey(policy.id, dueDate, daysBefore)
      const logRef = db.collection('renewal_reminder_logs').doc(id)
      const claimed = await db.runTransaction(async tx => {
        const existing = await tx.get(logRef)
        if (existing.exists) return false
        tx.set(logRef, {
          policyId: policy.id,
          policyNumber: policy.policyNumber || '',
          clientId: client?.id || policy.clientId || '',
          clientName: client?.name || policy.clientName || '',
          insurer: policy.insurer || '',
          dueDate: toDateText(dueDate),
          daysBefore,
          mobile: digits(mobile),
          message,
          status: 'sending',
          manual: false,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        return true
      })
      if (!claimed) {
        skipped += 1
        continue
      }

      const result = await sendEvolutionMessage(evolution, mobile, message)
      await logRef.set({
        status: result.ok ? 'sent' : 'failed',
        messageId: result.messageId || '',
        error: result.error || '',
        sentAt: result.ok ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      if (result.ok) sent += 1
    }

    res.status(200).json({ sent, skipped })
  } catch (error) {
    res.status(500).json({ error: error.message || 'Renewal reminder cron failed' })
  }
}

function getAdminDb() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.')
    const serviceAccount = JSON.parse(raw)
    if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n')
    initializeApp({ credential: cert(serviceAccount) })
  }
  return getFirestore()
}

function getEvolutionConfig() {
  const baseUrl = String(process.env.EVOLUTION_API_BASE_URL || '').replace(/\/+$/, '')
  const instanceName = process.env.EVOLUTION_API_INSTANCE_NAME
  const apiKey = process.env.EVOLUTION_API_KEY
  if (!baseUrl || !instanceName || !apiKey) throw new Error('Evolution API environment variables are not configured.')
  return { baseUrl, instanceName, apiKey }
}

function normaliseSettings(settings = {}) {
  const seen = new Set()
  const intervals = (settings.intervals?.length ? settings.intervals : DEFAULT_INTERVALS)
    .map((item, index) => ({
      id: item.id || `d${item.days ?? index}`,
      days: Math.max(0, Number(item.days) || 0),
      enabled: item.enabled !== false,
    }))
    .filter(item => {
      if (seen.has(item.days)) return false
      seen.add(item.days)
      return true
    })
  return {
    enabled: settings.enabled !== false,
    prompt: String(settings.prompt || DEFAULT_PROMPT).trim(),
    intervals,
  }
}

// Fetches only the client docs referenced by the given policies. Policies written before
// clientId existed are matched by name instead, and that fallback needs the full
// collection — so it is loaded only when at least one such policy is actually due.
async function loadClientsForPolicies(db, policies) {
  const ids = [...new Set(policies.map(policy => policy.clientId).filter(Boolean))]
  const loadAll = async () => {
    const snap = await db.collection('clients').get()
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  }

  // A policy with no clientId can only be matched by name, which needs every client.
  if (policies.some(policy => !policy.clientId && clean(policy.clientName))) return await loadAll()
  if (!ids.length) return []

  const clients = []
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).map(id => db.collection('clients').doc(id))
    const docs = await db.getAll(...refs)
    docs.filter(doc => doc.exists).forEach(doc => clients.push({ id: doc.id, ...doc.data() }))
  }

  // A clientId can dangle after a client merge or delete. If any due policy did not
  // resolve, fall back to the full collection so the name match still gets its chance.
  const resolved = new Set(clients.map(client => client.id))
  const unresolved = policies.some(policy => !resolved.has(policy.clientId) && clean(policy.clientName))
  return unresolved ? await loadAll() : clients
}

function findPolicyClient(policy, clients) {
  return clients.find(client => client.id === policy.clientId)
    || clients.find(client => clean(client.name) === clean(policy.clientName))
    || null
}

function buildMessage({ policy, client, dueDate, daysBefore, settings }) {
  const detail = {
    clientName: client?.name || policy.clientName || 'Customer',
    policyNumber: policy.policyNumber || '-',
    policyType: policy.policyType || 'Insurance',
    insurer: policy.insurer || 'your insurer',
    planName: policy.planName || '',
    premium: money(policy.premium || 0),
    dueDate: formatDate(dueDate),
    days: daysBefore,
  }
  const custom = applyTokens(settings.prompt, detail)
  const timing = daysBefore === 0
    ? 'is due for renewal today'
    : `is due for renewal in ${daysBefore} day${daysBefore === 1 ? '' : 's'}`

  return [
    `Dear ${detail.clientName},`,
    '',
    custom,
    '',
    `Your ${detail.policyType} policy ${detail.policyNumber} with ${detail.insurer} ${timing}.`,
    `Renewal date: ${detail.dueDate}`,
    `Premium: ${detail.premium}`,
    detail.planName ? `Plan: ${detail.planName}` : '',
    '',
    'Kindly contact us to complete the renewal and avoid any break in coverage.',
    '',
    'Gohil Investments',
    'Wealth Management & Insurance Advisory',
    'Harshdipsinh Gohil - 7698997894',
    'Pradipsinh Gohil - 9426204547',
    'Bhavnagar, Gujarat',
  ].filter(Boolean).join('\n')
}

async function sendEvolutionMessage(config, mobile, text) {
  try {
    const response = await fetch(`${config.baseUrl}/message/sendText/${encodeURIComponent(config.instanceName)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.apiKey,
      },
      body: JSON.stringify({ number: digits(mobile), text }),
    })
    const body = await response.text()
    if (!response.ok) return { ok: false, error: `Evolution API HTTP ${response.status}: ${body.slice(0, 200)}` }
    let json = {}
    try { json = body ? JSON.parse(body) : {} } catch {}
    return { ok: true, messageId: json.key?.id || json.messageId || json.id || '' }
  } catch (error) {
    return { ok: false, error: error.message || 'Could not reach Evolution API.' }
  }
}

function getPolicyDueDate(policy) {
  return parseDate(policy.nextPremiumDue || policy.expiryDate || policy.renewalDate)
}

function parseDate(value) {
  if (!value) return null
  if (value instanceof Date) return validDate(value)
  if (value instanceof Timestamp) return validDate(value.toDate())
  if (typeof value?.toDate === 'function') return validDate(value.toDate())
  if (typeof value === 'string') {
    const text = value.trim()
    const iso = validDate(new Date(text))
    if (iso) return iso
    const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
    if (match) {
      const [, dd, mm, yyyy] = match
      const year = Number(yyyy.length === 2 ? `20${yyyy}` : yyyy)
      return validDate(new Date(year, Number(mm) - 1, Number(dd)))
    }
  }
  return null
}

function validDate(date) {
  return Number.isNaN(date?.getTime?.()) ? null : date
}

function daysUntil(date) {
  if (!date) return null
  const today = startOfDay(new Date())
  const due = startOfDay(date)
  return Math.round((due - today) / 86400000)
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function reminderKey(policyId, dueDate, daysBefore) {
  return `${policyId}_${toDateText(dueDate)}_${daysBefore}`.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function toDateText(date) {
  if (!date) return ''
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatDate(date) {
  if (!date) return '-'
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function money(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value) || 0)
}

function applyTokens(prompt, detail) {
  return String(prompt || '')
    .replaceAll('{clientName}', detail.clientName)
    .replaceAll('{policyNumber}', detail.policyNumber)
    .replaceAll('{policyType}', detail.policyType)
    .replaceAll('{insurer}', detail.insurer)
    .replaceAll('{planName}', detail.planName)
    .replaceAll('{premium}', detail.premium)
    .replaceAll('{dueDate}', detail.dueDate)
    .replaceAll('{days}', String(detail.days ?? ''))
}

function clean(value) {
  return String(value || '').toLowerCase().trim()
}

function digits(value) {
  return String(value || '').replace(/\D/g, '')
}
