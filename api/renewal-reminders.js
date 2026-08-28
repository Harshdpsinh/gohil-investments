import { FieldValue } from 'firebase-admin/firestore'
import { getAdminDb, getWhatsAppConfig, sendWhatsAppTemplate } from './_shared.js'
// The one source of truth for when a policy is due. This file used to carry its
// own copy and the two drifted apart in two ways that both sent reminders on the
// wrong day: it preferred nextPremiumDue where the app prefers expiryDate, and
// its parser read legacy DD/MM/YYYY dates as MM/DD/YYYY whenever the day was 12
// or lower — 01/12/2026 became 12 Jan, eleven months early. Import, never copy.
import { getDueDate, daysUntilPolicyDue, parseAnyDate } from '../src/utils/dateUtils.js'
import { isOccasionToday } from '../src/utils/occasions.js'

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

    const whatsapp = getWhatsAppConfig()
    const policySnap = await db.collection('policies').get()
    const enabledDays = new Set(settings.intervals.filter(item => item.enabled).map(item => item.days))
    let sent = 0
    let skipped = 0

    // Pass 1 — decide which policies are due today. The whole collection still has to be
    // scanned: getDueDate picks between expiryDate, nextPremiumDue and a computed date per
    // policy, and legacy rows store DD/MM/YYYY, so no indexed range query is safe here.
    const due = []
    for (const doc of policySnap.docs) {
      const policy = { id: doc.id, ...doc.data() }
      const dueDate = getDueDate(policy)          // yyyy-MM-dd, same as the app shows
      const daysBefore = daysUntilPolicyDue(policy)
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

      const detail = buildDetail({ policy, client, dueDate, daysBefore })
      const message = buildMessage(detail, settings)
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
          dueDate,
          daysBefore,
          mobile: digits(mobile),
          // The composed text is a preview for the app's log view. What Meta
          // actually renders is the approved template plus these variables.
          message,
          template: whatsapp.templateName,
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

      const result = await sendWhatsAppTemplate(whatsapp, mobile, detail)
      await logRef.set({
        status: result.ok ? 'sent' : 'failed',
        messageId: result.messageId || '',
        mobile: result.to || digits(mobile),
        error: result.error || '',
        sentAt: result.ok ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      if (result.ok) sent += 1
    }

    let birthdaysSent = 0
    let birthdaysSkipped = 0
    const birthdayTemplate = process.env.WHATSAPP_BIRTHDAY_TEMPLATE_NAME
    if (birthdayTemplate) {
      const allClients = (await db.collection('clients').get()).docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(client => !client.mergedIntoClientId && !client.deleted)
      const bdayConfig = {
        ...whatsapp,
        templateName: birthdayTemplate,
        templateOrder: String(process.env.WHATSAPP_BIRTHDAY_TEMPLATE_PARAMS || 'clientName')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
      }
      const todayKey = new Date().toISOString().slice(0, 10)
      for (const client of allClients) {
        const kinds = []
        if (isOccasionToday(client.dob)) kinds.push('birthday')
        if (isOccasionToday(client.anniversary || client.weddingDate)) kinds.push('anniversary')
        for (const kind of kinds) {
          const logRef = db.collection('occasion_logs').doc(`${kind}-${client.id}-${todayKey}`)
          const claimed = await db.runTransaction(async tx => {
            const existing = await tx.get(logRef)
            if (existing.exists) return false
            tx.set(logRef, {
              clientId: client.id,
              clientName: client.name || '',
              kind,
              date: todayKey,
              status: 'sending',
              createdAt: FieldValue.serverTimestamp(),
            })
            return true
          })
          if (!claimed) {
            birthdaysSkipped += 1
            continue
          }
          if (!digits(client.mobile)) {
            await logRef.set({ status: 'failed', error: 'No mobile' }, { merge: true })
            birthdaysSkipped += 1
            continue
          }
          const result = await sendWhatsAppTemplate(bdayConfig, client.mobile, { clientName: client.name || 'Customer' })
          await logRef.set({
            status: result.ok ? 'sent' : 'failed',
            error: result.error || '',
            messageId: result.messageId || '',
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true })
          if (result.ok) birthdaysSent += 1
          else birthdaysSkipped += 1
        }
      }
    }

    res.status(200).json({ sent, skipped, birthdaysSent, birthdaysSkipped })
  } catch (error) {
    res.status(500).json({ error: error.message || 'Renewal reminder cron failed' })
  }
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

// The facts a reminder is built from — and the source of the WhatsApp
// template's body variables, so the message sent and the preview logged always
// describe the same policy.
function buildDetail({ policy, client, dueDate, daysBefore }) {
  return {
    clientName: client?.name || policy.clientName || 'Customer',
    policyNumber: policy.policyNumber || '-',
    policyType: policy.policyType || 'Insurance',
    insurer: policy.insurer || 'your insurer',
    planName: policy.planName || '',
    premium: money(policy.premium || 0),
    dueDate: formatDate(dueDate),
    days: daysBefore,
  }
}

function buildMessage(detail, settings) {
  const daysBefore = detail.days
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

function reminderKey(policyId, dueDate, daysBefore) {
  return `${policyId}_${dueDate}_${daysBefore}`.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function formatDate(value) {
  const date = parseAnyDate(value)
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
