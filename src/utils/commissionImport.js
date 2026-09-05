// src/utils/commissionImport.js
// Maps a raw insurer commission statement (already read into rows by
// exportUtils.parseImportFile) onto existing policies. Pure — no Firebase, no
// React — so the matching rules can be tested directly.
import { fuzzyMatch } from './policyImport'
import { parseAnyDate, toInputDate } from './dateUtils'

// Insurers all name their columns differently. Lowercased, non-alphanumerics
// stripped, so "Policy No." and "policy_no" collapse to the same key.
// Order within each list is the preference order when a sheet has several
// candidates (HDFC ERGO ships both TOTAL_COMM and COMMISSION_OD_AMT).
const ALIASES = {
  policyNumber: ['policyno', 'policynumber', 'policynum', 'policy', 'certificateno', 'certificatenum', 'proposalno'],
  clientName: ['clientname', 'customername', 'insuredname', 'policyholder', 'policyholdername', 'investor', 'proposer', 'proposersname', 'name'],
  // companyamc: aggregator bills (WealthMaker, Probus) name the carrier per row.
  insurer: ['companyamc', 'insurer', 'insurancecompany', 'insurername', 'company', 'amc'],
  planName: ['planscheme', 'planname', 'plan', 'scheme', 'productname', 'proddescription', 'lob'],
  businessType: ['freshrenewal', 'businesstype', 'newrenewal', 'policystatus', 'renewedpolicy', 'fresh', 'renewal'],
  premium: ['premiumforcommission', 'gwpbeforetax', 'grosspremium', 'premium', 'netpremium', 'premiumamount', 'gwp', 'gwpfull', 'amount'],
  commissionPct: ['commissionpct', 'commissionperct', 'payoutpct', 'commissionpercent', 'commissionpercentage', 'commperct', 'commrate', 'brokeragepct', 'rate'],
  commissionAmount: ['totalcomm', 'commissionstructure', 'totalcommission', 'commissionamount', 'commissionamt', 'commamount', 'commissionodamt', 'brokerageamount', 'brokerage', 'expense', 'payout', 'commission'],
  // Net Payment / Net Payable is bank-landed cash, not the gross commission.
  // Keeping it off the commissionAmount aliases stops Niva Bupa from posting
  // Net Payment as the credited amount.
  netPayable: ['netpayable', 'netpayment', 'netreceived', 'amountcredited'],
  // Insurers deduct 5% TDS under s.194D. Capturing it turns the ledger into
  // something that can be checked against Form 26AS at year end instead of
  // being reconciled by hand.
  tds: ['tds', 'tdsamount', 'tdsdeducted', 'taxdeducted', 'incometax', 'tdsdeduction'],
  gst: ['gst', 'gstamount', 'igst', 'cgst', 'sgst', 'servicetax', 'gstonbrokerage'],
  payoutDate: ['payoutdate', 'paymentdate', 'transactiondate', 'date'],
  payoutMonth: ['month', 'payoutmonth', 'paymentmonth', 'cycle'],
}

/** Fresh / New / New Business -> 'Fresh'; Renewal / Renewed -> 'Renewal'. */
export function normaliseBusinessType(value) {
  const text = String(value ?? '').toLowerCase()
  if (!text.trim()) return ''
  if (/renew/.test(text)) return 'Renewal'
  if (/fresh|new/.test(text)) return 'Fresh'
  return ''
}

/** "202606" or 202606 -> "2026-06". Anything else -> ''. */
export function toPayoutMonth(value) {
  const s = String(value ?? '').trim()
  const m = s.match(/^(\d{4})-?(\d{2})$/)
  return m ? `${m[1]}-${m[2]}` : ''
}

const key = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '')

/** Number from "1,234.50", "12.5%", "₹1,234" or a real number. NaN-safe. */
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

/**
 * Which field a single header string represents, or '' if unrecognised.
 * Shared with the PDF banded-table parser so both read the same vocabulary.
 *
 * A header containing "%" can only be a rate. Without that rule "Payout %"
 * (Niva Bupa's rate) and "Payout" (an aggregator's amount) both reduce to
 * "payout" and the rate gets posted as the commission.
 */
export function fieldForHeader(header) {
  if (/%|percent/i.test(header)) return 'commissionPct'
  const k = key(header)
  for (const [field, names] of Object.entries(ALIASES)) {
    if (names.includes(k)) return field
  }
  return ''
}

export function mapColumns(row = {}) {
  const found = {}
  for (const header of Object.keys(row)) {
    const k = key(header)
    if (/%|percent/i.test(header)) {
      if (!found.commissionPct) found.commissionPct = header
      continue
    }
    for (const [field, names] of Object.entries(ALIASES)) {
      if (!found[field] && names.includes(k)) found[field] = header
    }
  }
  return found
}

/** Raw sheet rows -> normalised statement rows. Blank rows are dropped. */
export function normaliseStatement(rows = []) {
  if (!rows.length) return []
  const cols = mapColumns(rows[0])
  return rows
    .map((row, index) => {
      const payoutDate = String(row[cols.payoutDate] ?? '').trim()
      return {
        sourceRow: index + 2, // +2: 1-indexed, and row 1 is the header
        // Insurers export policy numbers as text with a leading apostrophe.
        policyNumber: String(row[cols.policyNumber] ?? '').replace(/^'/, '').trim(),
        clientName: String(row[cols.clientName] ?? '').trim(),
        // On an aggregator bill this differs per row; on a single-carrier
        // statement it is usually absent and the user declares it.
        insurer: String(row[cols.insurer] ?? '').trim(),
        planName: String(row[cols.planName] ?? '').trim(),
        businessType: normaliseBusinessType(row[cols.businessType]),
        premium: toNumber(row[cols.premium]),
        commissionPct: toNumber(row[cols.commissionPct]),
        commissionAmount: toNumber(row[cols.commissionAmount]),
        netPayable: toNumber(row[cols.netPayable]),
        tds: toNumber(row[cols.tds]),
        gst: toNumber(row[cols.gst]),
        payoutDate,
        payoutMonth: toPayoutMonth(row[cols.payoutMonth]) || payoutDate.slice(0, 7),
      }
    })
    // All-zero policy numbers are Niva Bupa's balance adjustments, not policies.
    .filter(r => (r.policyNumber || r.clientName) && !/^0+$/.test(r.policyNumber))
}

export function postedAmounts(row = {}) {
  const tds = Number(row.tds) || 0
  const grossCol = Number(row.commissionAmount) || 0
  const netCol = Number(row.netPayable) || 0
  const receivedCommission = grossCol || netCol
  let netReceived
  if (netCol) netReceived = netCol
  else if (tds) netReceived = Math.round((receivedCommission - tds) * 100) / 100
  else netReceived = receivedCommission
  return { receivedCommission, netReceived, tds }
}

/** Which policy rate field a statement row should write — renewals must not overwrite fyCommission. */
export function commissionRateField(policy = {}, businessType = '') {
  if (businessType === 'Renewal') return 'ryCommission'
  if (businessType === 'Fresh') return 'fyCommission'
  return (Number(policy.policyYear) || 1) > 1 ? 'ryCommission' : 'fyCommission'
}

const sameInsurer = (a, b) => {
  const x = key(a), y = key(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

const isClosedTerm = policy => {
  const status = String(policy?.status || '').trim()
  return status === 'Cancelled' || status === 'Renewed-Out' || Boolean(policy?.is_renewed)
}

export function pickCurrentTerm(matches = []) {
  if (!matches.length) return null
  if (matches.length === 1) return matches[0]
  const live = matches.filter(policy => !isClosedTerm(policy))
  if (live.length === 1) return live[0]
  return null
}

/** Star Health July statements print ************2955 (last 4 only). */
export function isMaskedPolicyNumber(value) {
  return /^\*{3,}\d{4}$/.test(String(value || '').replace(/\s/g, ''))
}

export function last4(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : ''
}

function nameTokens(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/^(MRS|MR|MS|MISS|SMT|SHRI|DR)(?=[A-Z])/i, '')
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .map(t => t.replace(/^(MRS|MR|MS|MISS|SMT|SHRI|DR)$/i, ''))
    .filter(t => t.length > 1)
}

function namesAgree(a, b) {
  if (!a || !b) return true
  if (fuzzyMatch(a, [{ name: b }], 0.7).length) return true
  const ta = nameTokens(a)
  const tb = nameTokens(b)
  if (!ta.length || !tb.length) return false
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  if (shorter.every(t => longer.includes(t))) return true
  return ta.filter(t => tb.includes(t)).length >= 2
}

function premiumsAgree(a, b) {
  const x = Number(a) || 0
  const y = Number(b) || 0
  if (!x || !y) return false
  return Math.abs(x - y) < 2
}

const withIdentity = (row, policy, status, reason) => {
  const nameOk = namesAgree(row.clientName, policy.clientName)
  const insurerOk = !row.insurer || sameInsurer(row.insurer, policy.insurer)
  if (nameOk && insurerOk) {
    return { ...row, policy, status: status || 'matched', reason }
  }
  return {
    ...row,
    policy,
    status: 'review',
    reason: [!nameOk && 'name differs', !insurerOk && 'insurer differs'].filter(Boolean).join(', '),
  }
}

/**
 * Match one statement row against the policy book.
 * status: 'matched' needs an exact policy number AND a corroborating
 * name or insurer. Masked last-4 numbers (Star Health July) never
 * auto-post unless last-4, name, AND premium all agree on a unique Star
 * policy. Date agreement is not enough. Anything weaker goes to 'review'.
 * A name hit without a number is never attached — that is a new policy
 * under an existing client, not commission on their old number.
 * Nothing here writes a ledger row.
 */
export function matchRow(row, policies = []) {
  const masked = isMaskedPolicyNumber(row.policyNumber)
  const num = key(row.policyNumber)
  const exact = !masked && num ? policies.filter(p => key(p.policyNumber) === num) : []

  if (exact.length === 1) {
    return withIdentity(row, exact[0], 'matched', 'Policy number, name and insurer agree')
  }
  if (exact.length > 1) {
    const policy = pickCurrentTerm(exact)
    if (policy) {
      return withIdentity(
        row,
        policy,
        'matched',
        'Same number on a prior term; posted against the live policy',
      )
    }
    return { ...row, policy: null, status: 'review', reason: `${exact.length} policies share this number` }
  }

  // Star Health July: ************2955. Last-4 alone is never enough to
  // issue a commission — only a unique last-4 plus name plus premium
  // becomes 'matched'. Collisions stay in review with no policy attached.
  if (masked) {
    const tail = last4(row.policyNumber)
    const hits = tail
      ? policies.filter(p => {
          const digits = String(p.policyNumber || '').replace(/\D/g, '')
          // A 4-digit policy id of 2955 is not Star's ************2955.
          return digits.length >= 8 && digits.slice(-4) === tail
            && (!row.insurer || sameInsurer(row.insurer, p.insurer))
        })
      : []
    if (hits.length > 1) {
      const policy = pickCurrentTerm(hits)
      if (!policy) {
        return { ...row, policy: null, status: 'review', reason: `${hits.length} policies share last-4` }
      }
      return matchLast4(row, policy)
    }
    if (hits.length === 1) return matchLast4(row, hits[0])
  }

  // Name without a number is an existing client, not their old policy.
  // Never attach a policy here — the review panel offers "add as new".
  const near = row.clientName
    ? fuzzyMatch(row.clientName, policies.map(p => ({ ...p, name: p.clientName })), 0.8)
        .filter(p => !row.insurer || sameInsurer(row.insurer, p.insurer))
    : []
  if (near.length === 1) {
    return { ...row, policy: null, status: 'review', reason: 'Existing client — new policy?' }
  }
  if (near.length > 1) {
    return { ...row, policy: null, status: 'review', reason: `${near.length} clients share this name — new policy?` }
  }
  return { ...row, policy: null, status: 'unmatched', reason: 'No matching policy found' }
}

/**
 * Policies that could be THE SAME policy (number/last-4 hit). Name-only
 * hits are not commission targets — those belong on matchClientCandidates.
 */
export function matchCandidates(row, policies = []) {
  if (!row) return []
  const seen = new Set()
  const out = []
  const add = list => {
    for (const policy of list) {
      if (!policy?.id || seen.has(policy.id)) continue
      seen.add(policy.id)
      out.push(policy)
    }
  }
  const masked = isMaskedPolicyNumber(row.policyNumber)
  const tail = last4(row.policyNumber)
  const num = key(row.policyNumber)
  if (masked && tail) {
    add(policies.filter(p => {
      const digits = String(p.policyNumber || '').replace(/\D/g, '')
      return digits.length >= 8 && digits.slice(-4) === tail
        && (!row.insurer || sameInsurer(row.insurer, p.insurer))
    }))
  } else if (num) {
    add(policies.filter(p => key(p.policyNumber) === num))
  }
  return out.slice(0, 8)
}

/**
 * Existing people this statement row might belong to, for "add as a new
 * policy under this client". Never used to post commission on an old number.
 */
export function matchClientCandidates(row, policies = [], clients = []) {
  if (!row?.clientName) return []
  const seen = new Set()
  const out = []
  const take = (id, entry) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push(entry)
  }
  const near = fuzzyMatch(row.clientName, policies.map(p => ({ ...p, name: p.clientName })), 0.7)
    .filter(p => !row.insurer || sameInsurer(row.insurer, p.insurer))
  for (const policy of near) {
    take(policy.clientId || `policy:${policy.id}`, {
      clientId: policy.clientId || '',
      clientName: policy.clientName,
      samplePolicyNumber: policy.policyNumber,
      insurer: policy.insurer,
      premium: policy.premium,
    })
  }
  if (clients.length) {
    const hits = fuzzyMatch(row.clientName, clients.map(c => ({ ...c, name: c.name })), 0.7)
    for (const client of hits) {
      take(client.id, {
        clientId: client.id,
        clientName: client.name,
        samplePolicyNumber: '',
        insurer: '',
        premium: 0,
      })
    }
  }
  return out.slice(0, 8)
}

export function candidateMismatches(row, policy) {
  if (!row || !policy) return ['no policy']
  const issues = []
  if (isMaskedPolicyNumber(row.policyNumber)) {
    const want = last4(row.policyNumber)
    const got = last4(policy.policyNumber)
    if (want && got && want !== got) issues.push(`last-4 ${got} ≠ ${want}`)
  } else if (key(row.policyNumber) && key(policy.policyNumber)
    && key(row.policyNumber) !== key(policy.policyNumber)) {
    issues.push('policy number differs')
  }
  if (row.clientName && policy.clientName && !namesAgree(row.clientName, policy.clientName)) {
    issues.push('name differs')
  }
  if (row.insurer && policy.insurer && !sameInsurer(row.insurer, policy.insurer)) {
    issues.push('insurer differs')
  }
  if (row.premium && policy.premium && !premiumsAgree(row.premium, policy.premium)) {
    issues.push('premium differs')
  }
  return issues
}

/** True when OK may post this statement row against this book policy. */
export function canPostAgainstPolicy(row, policy) {
  const issues = candidateMismatches(row, policy)
  if (!issues.length) return true
  if (!isMaskedPolicyNumber(row.policyNumber) && key(row.policyNumber) === key(policy.policyNumber)) {
    return !issues.some(i => i === 'name differs' || i === 'insurer differs' || i === 'policy number differs')
  }
  return false
}

export function assertTypedPolicyNumber(typed, statementNumber) {
  const clean = String(typed || '').replace(/\s/g, '')
  if (!clean) throw new Error('Type the full policy number from the policy copy.')
  if (isMaskedPolicyNumber(clean)) {
    throw new Error('Star prints last-4 only. Type the full policy number from the policy copy.')
  }
  const digits = clean.replace(/\D/g, '')
  if (digits.length < 8) throw new Error('That does not look like a full policy number.')
  if (isMaskedPolicyNumber(statementNumber)) {
    const want = last4(statementNumber)
    if (want && last4(clean) !== want) {
      throw new Error(`Last-4 must be ${want} to match this statement row.`)
    }
  }
  return clean
}

function defaultExpiryIso(start) {
  const d = parseAnyDate(start)
  if (!d) return ''
  const next = new Date(d)
  next.setFullYear(next.getFullYear() + 1)
  return toInputDate(next)
}

/** Policy payload for "add as new" from a statement row. Does not write. */
export function newPolicyDraft(row, {
  clientId, clientName, insurer, startDate, expiryDate, policyNumber,
} = {}) {
  const start = toInputDate(startDate || row.startDate)
  const expiry = toInputDate(expiryDate) || defaultExpiryIso(start)
  const pct = row.commissionPct > 0 && row.commissionPct <= 100
    ? row.commissionPct
    : (row.premium ? Number(((Number(row.commissionAmount) / Number(row.premium)) * 100).toFixed(2)) : 0)
  const renewal = row.businessType === 'Renewal'
  return {
    policyNumber,
    clientId,
    clientName: clientName || row.clientName || '',
    insurer: insurer || row.insurer || '',
    policyType: 'Health',
    planName: row.planName || '',
    premium: Number(row.premium) || 0,
    startDate: start,
    expiryDate: expiry,
    status: 'Active',
    frequency: 'Yearly',
    fyCommission: renewal ? 0 : pct,
    ryCommission: renewal ? pct : 0,
    notes: `Added from commission statement${row.sourceRow ? ` row ${row.sourceRow}` : ''}`,
  }
}

function matchLast4(row, policy) {
  const nameOk = namesAgree(row.clientName, policy.clientName)
  const premiumOk = premiumsAgree(row.premium, policy.premium)
  if (nameOk && premiumOk) {
    return {
      ...row,
      policy,
      status: 'matched',
      reason: 'Last-4, name and premium agree (masked Star number)',
    }
  }
  if (nameOk) {
    return { ...row, policy, status: 'review', reason: 'Last-4 and name agree; premium differs — confirm or add as new' }
  }
  return {
    ...row,
    policy: null,
    status: 'review',
    reason: 'Last-4 hits a different name — add as new policy',
  }
}


/**
 * defaultInsurer fills rows whose sheet has no insurer column (HDFC ERGO's
 * export omits it entirely), so the name+insurer check still has something
 * to verify against.
 */
export function matchStatement(rows, policies, defaultInsurer = '') {
  return rows.map(row =>
    matchRow(defaultInsurer && !row.insurer ? { ...row, insurer: defaultInsurer } : row, policies)
  )
}

const safeId = s => String(s).replace(/[^a-zA-Z0-9_-]/g, '_')
const keyMonth = row => row.payoutMonth || (row.payoutDate || '').slice(0, 7) || 'nodate'

/**
 * Stable id for a posted row so re-uploading the same statement cannot
 * double-post. Firestore doc ids may not contain '/'.
 *
 * sourceRow is part of the key because policy + month + amount is not unique:
 * Aditya Birla emits a Booster line and a Retail New Business line for the same
 * policy in the same month, and if those two ever carry the same amount the
 * second would be rejected as a duplicate. sourceRow is the row's position in
 * the file, so it is identical on every re-upload of that file.
 */
export function postingKey(row) {
  return safeId(`${row.policyNumber}_${keyMonth(row)}_${Math.round(row.commissionAmount)}_r${row.sourceRow ?? 0}`)
}

/**
 * The pre-sourceRow key shape. Passed alongside postingKey so a statement
 * posted before that change is still recognised as already posted.
 * ponytail: delete once no statement from before Aug 2026 will be re-uploaded.
 */
export function legacyPostingKey(row) {
  return safeId(`${row.policyNumber}_${keyMonth(row)}_${Math.round(row.commissionAmount)}`)
}

export function summarise(matched = []) {
  return {
    total: matched.length,
    matched: matched.filter(r => r.status === 'matched').length,
    review: matched.filter(r => r.status === 'review').length,
    unmatched: matched.filter(r => r.status === 'unmatched').length,
    amount: matched.reduce((s, r) => s + r.commissionAmount, 0),
  }
}
