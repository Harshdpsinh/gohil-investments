import {
  addManualRenewalReminderLog,
  claimRenewalReminder,
  finishRenewalReminderLog,
  getAllClients,
  getAllPolicies,
  getRenewalReminderSettings,
} from '../firebase/firestore'
import { daysUntilPolicyDue, fmtCurrency, fmtDate, getDueDate as getPolicyDueDate } from '../utils/dateUtils'
import { sendWhatsApp } from '../utils/whatsappSender'

export const DEFAULT_RENEWAL_REMINDER_PROMPT =
  'Please renew your policy on time to keep your insurance protection active without interruption.'

export const DEFAULT_RENEWAL_REMINDER_INTERVALS = [
  { id: 'd30', days: 30, enabled: true },
  { id: 'd15', days: 15, enabled: true },
  { id: 'd7', days: 7, enabled: true },
  { id: 'd1', days: 1, enabled: true },
  { id: 'd0', days: 0, enabled: true },
]

const STOP_STATUSES = new Set(['Renewed-Out', 'Cancelled', 'Matured'])

export function defaultRenewalReminderSettings() {
  return {
    enabled: true,
    prompt: DEFAULT_RENEWAL_REMINDER_PROMPT,
    intervals: DEFAULT_RENEWAL_REMINDER_INTERVALS,
  }
}

export function normaliseReminderSettings(settings) {
  // getRenewalReminderSettings() returns null when the settings document has
  // never been saved. A `= {}` parameter default does not cover null, so guard
  // explicitly — otherwise reading .intervals throws on a fresh install.
  const source = settings || {}
  const base = defaultRenewalReminderSettings()
  const seen = new Set()
  const intervals = (source.intervals?.length ? source.intervals : base.intervals)
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
    .sort((a, b) => b.days - a.days)

  return {
    enabled: source.enabled !== false,
    // Trim before falling back, so a whitespace-only prompt does not send an
    // empty line to clients.
    prompt: String(source.prompt || '').trim() || base.prompt,
    intervals,
  }
}

export function findPolicyClient(policy, clients = []) {
  return clients.find(c => c.id === policy.clientId)
    || clients.find(c => c.name?.toLowerCase().trim() === policy.clientName?.toLowerCase().trim())
    || null
}

/**
 * The facts a reminder is built from. Also the source of the WhatsApp template's
 * body variables, so the message a client receives and the preview stored in the
 * log are always describing the same policy.
 */
export function buildRenewalReminderDetail({ policy, client, daysBefore }) {
  return {
    clientName: client?.name || policy.clientName || 'Customer',
    policyNumber: policy.policyNumber || '-',
    policyType: policy.policyType || 'Insurance',
    insurer: policy.insurer || 'your insurer',
    planName: policy.planName || '',
    premium: fmtCurrency(policy.premium || 0),
    dueDate: fmtDate(getPolicyDueDate(policy)),
    days: daysBefore,
  }
}

export function buildRenewalReminderMessage({ policy, client, daysBefore, settings }) {
  const detail = buildRenewalReminderDetail({ policy, client, daysBefore })
  const custom = applyReminderTokens(settings?.prompt || DEFAULT_RENEWAL_REMINDER_PROMPT, detail)
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
  ].filter(line => line !== '').join('\n')
}

export async function runRenewalReminderSweep() {
  const settings = normaliseReminderSettings(await getRenewalReminderSettings())
  if (!settings.enabled) return { sent: 0, skipped: 0 }

  const [policies, clients] = await Promise.all([getAllPolicies(), getAllClients()])
  const enabledDays = new Set(settings.intervals.filter(i => i.enabled).map(i => i.days))
  let sent = 0
  let skipped = 0

  for (const policy of policies) {
    const daysBefore = daysUntilPolicyDue(policy)
    const dueDate = getPolicyDueDate(policy)
    const status = String(policy.status || 'Active').trim()
    if (!enabledDays.has(daysBefore) || !dueDate || STOP_STATUSES.has(status) || policy.is_renewed) {
      skipped += 1
      continue
    }

    const client = findPolicyClient(policy, clients)
    const mobile = policy.clientMobile || client?.mobile || ''
    const message = buildRenewalReminderMessage({ policy, client, daysBefore, settings })
    const key = reminderKey(policy.id, dueDate, daysBefore)
    const claim = await claimRenewalReminder({
      id: key,
      policy,
      client,
      dueDate,
      daysBefore,
      mobile,
      message,
    })
    if (!claim.claimed) {
      skipped += 1
      continue
    }

    const result = await sendWhatsApp({
      number: mobile,
      detail: buildRenewalReminderDetail({ policy, client, daysBefore }),
    })
    await finishRenewalReminderLog(key, {
      status: result.ok ? 'sent' : 'failed',
      messageId: result.messageId || '',
      error: result.error || '',
    })
    if (result.ok) sent += 1
  }

  return { sent, skipped }
}

export async function sendManualRenewalReminder(policy, clients, settings) {
  const safeSettings = normaliseReminderSettings(settings)
  const client = findPolicyClient(policy, clients)
  const mobile = policy.clientMobile || client?.mobile || ''
  const daysBefore = daysUntilPolicyDue(policy)
  const dueDate = getPolicyDueDate(policy)
  const message = buildRenewalReminderMessage({ policy, client, daysBefore, settings: safeSettings })
  const result = await sendWhatsApp({
    number: mobile,
    detail: buildRenewalReminderDetail({ policy, client, daysBefore }),
  })
  await addManualRenewalReminderLog({
    policy,
    client,
    dueDate,
    daysBefore,
    mobile,
    message,
    status: result.ok ? 'sent' : 'failed',
    messageId: result.messageId || '',
    error: result.error || '',
  })
  return result
}

export function startRenewalReminderAutomation() {
  let stopped = false
  let running = false
  const run = async () => {
    if (stopped || running) return
    running = true
    try {
      await runRenewalReminderSweep()
    } catch (error) {
      console.warn('Renewal reminder sweep failed:', error)
    } finally {
      running = false
    }
  }
  const first = window.setTimeout(run, 5000)
  const timer = window.setInterval(run, 60 * 60 * 1000)
  return () => {
    stopped = true
    window.clearTimeout(first)
    window.clearInterval(timer)
  }
}

function reminderKey(policyId, dueDate, daysBefore) {
  return `${policyId}_${dueDate}_${daysBefore}`.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function applyReminderTokens(prompt, detail) {
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
