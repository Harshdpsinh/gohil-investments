// src/utils/commissionImport.js
// Maps a raw insurer commission statement (already read into rows by
// exportUtils.parseImportFile) onto existing policies. Pure — no Firebase, no
// React — so the matching rules can be tested directly.
import { fuzzyMatch } from './policyImport'

const ALIASES = {
  policyNumber: ['policyno', 'policynumber', 'policynum', 'policy', 'certificateno', 'certificatenum', 'proposalno'],
  clientName: ['clientname', 'customername', 'insuredname', 'policyholder', 'policyholdername', 'investor', 'proposer', 'proposersname', 'name'],
  insurer: ['companyamc', 'insurer', 'insurancecompany', 'insurername', 'company', 'amc'],
  planName: ['planscheme', 'planname', 'plan', 'scheme', 'productname', 'proddescription', 'lob'],
  businessType: ['freshrenewal', 'businesstype', 'newrenewal', 'policystatus', 'renewedpolicy', 'fresh', 'renewal'],
  premium: ['premiumforcommission', 'gwpbeforetax', 'grosspremium', 'premium', 'netpremium', 'premiumamount', 'gwp', 'gwpfull', 'amount'],
  commissionPct: ['commissionpct', 'commissionperct', 'payoutpct', 'commissionpercent', 'commissionpercentage', 'commperct', 'commrate', 'brokeragepct', 'rate'],
  commissionAmount: ['totalcomm', 'commissionstructure', 'totalcommission', 'commissionamount', 'commissionamt', 'commamount', 'commissionodamt', 'brokerageamount', 'brokerage', 'expense', 'payout', 'commission'],
  netPayable: ['netpayable', 'netpayment', 'netreceived', 'amountcredited'],
  tds: ['tds', 'tdsamount', 'tdsdeducted', 'taxdeducted', 'incometax', 'tdsdeduction'],
  gst: ['gst', 'gstamount', 'igst', 'cgst', 'sgst', 'servicetax', 'gstonbrokerage'],
  payoutDate: ['payoutdate', 'paymentdate', 'transactiondate', 'date'],
  payoutMonth: ['month', 'payoutmonth', 'paymentmonth', 'cycle'],
}

export function normaliseBusinessType(value) {
  const text = String(value ?? '').toLowerCase()
  if (!text.trim()) return ''
  if (/renew/.test(text)) return 'Renewal'
  if (/fresh|new/.test(text)) return 'Fresh'
  return ''
}

export function toPayoutMonth(value) {
  const s = String(value ?? '').trim()
  const m = s.match(/^(\d{4})-?(\d{2})$/)
  return m ? `${m[1]}-${m[2]}` : ''
}

const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

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

export function normaliseStatement(rows = []) {
  if (!rows.length) return []
  const cols = mapColumns(rows[0])
  return rows
    .map((row, index) => {
      const payoutDate = String(row[cols.payoutDate] ?? '').trim()
      return {
        sourceRow: index + 2,
        policyNumber: String(row[cols.policyNumber] ?? '').replace(/^'/, '').trim(),
        clientName: String(row[cols.clientName] ?? '').trim(),
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
  const pool = live.length ? live : matches
  if (pool.length === 1) return pool[0]
  return null
}

const withIdentity = (row, policy, status, reason) => {
  const nameOk = !row.clientName || fuzzyMatch(row.clientName, [{ name: policy.clientName }], 0.7).length > 0
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

export function matchRow(row, policies = []) {
  const num = key(row.policyNumber)
  const exact = num ? policies.filter(p => key(p.policyNumber) === num) : []

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

  const near = row.clientName
    ? fuzzyMatch(row.clientName, policies.map(p => ({ ...p, name: p.clientName })), 0.8)
        .filter(p => !row.insurer || sameInsurer(row.insurer, p.insurer))
    : []
  if (near.length === 1) return { ...row, policy: near[0], status: 'review', reason: 'Matched on name only' }
  if (near.length > 1) return { ...row, policy: null, status: 'review', reason: `${near.length} possible clients` }
  return { ...row, policy: null, status: 'unmatched', reason: 'No matching policy found' }
}

export function matchStatement(rows, policies, defaultInsurer = '') {
  return rows.map(row =>
    matchRow(defaultInsurer && !row.insurer ? { ...row, insurer: defaultInsurer } : row, policies)
  )
}

const safeId = s => String(s).replace(/[^a-zA-Z0-9_-]/g, '_')
const keyMonth = row => row.payoutMonth || (row.payoutDate || '').slice(0, 7) || 'nodate'

export function postingKey(row) {
  return safeId(`${row.policyNumber}_${keyMonth(row)}_${Math.round(row.commissionAmount)}_r${row.sourceRow ?? 0}`)
}

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
