// src/utils/policyPdfExtract.js
// Reads policy details off an insurer's policy schedule PDF by looking for
// labels ("Policy No", "Sum Insured", "Period of Insurance") and taking the
// value sitting next to them. Input is the same page/line/cell shape that
// pdfStatement.extractLines produces, so this file stays pure — no pdfjs, no
// Firebase, no React — and every rule below is directly testable.
//
// This is deliberately label-driven rather than coordinate-driven. The
// commission parsers in pdfProfiles.js pin absolute x-bands because those
// statements are dense tables; policy schedules are labelled key/value blocks
// that move around between insurers but keep their wording. Labels survive a
// template reprint. Coordinates do not.
//
// It will not fill every field. Anything it cannot find comes back as
// 'missing', anything it found but could not validate comes back as
// 'uncertain', and the review screen asks a human. That is the design, not a
// shortfall: a wrong auto-filled premium is worse than a blank one.
import { parseAnyDate, toInputDate } from './dateUtils'
import { KNOWN_INSURERS } from './policySchemas'
import { fuzzyMatch } from './policyImport'

// Ordered: the first label that matches wins, so put the most specific first.
// "Total Premium" must beat a bare "Premium", which appears in fine print all
// over these documents.
const LABELS = {
  policyNumber: [/\bpolicy\s*(?:no|number|#)\b/i, /\bcertificate\s*(?:no|number)\b/i],
  clientName: [
    /\b(?:insured|proposer|policy\s*holder|policyholder|life\s*assured)(?:'s)?\s*name\b/i,
    /\bname\s+of\s+(?:the\s+)?(?:insured|proposer|policy\s*holder|life\s*assured)\b/i,
    /\bcustomer\s*name\b/i,
  ],
  planName: [/\b(?:plan|product|scheme)\s*(?:name|description)?\b/i],
  premium: [
    /\btotal\s*premium\b/i, /\bgross\s*premium\b/i, /\bpremium\s*paid\b/i,
    /\bpremium\s*(?:amount|payable)\b/i, /\bfinal\s*premium\b/i,
  ],
  sumInsured: [/\bsum\s*(?:insured|assured)\b/i, /\bcoverage\s*amount\b/i, /\bbasic\s*sum\b/i],
  startDate: [
    /\b(?:policy\s*)?(?:start|commencement|inception|issue)\s*date\b/i,
    /\bdate\s*of\s*(?:commencement|inception|issue)\b/i,
    /\bperiod\s*of\s*insurance\b/i, /\bvalid\s*from\b/i,
  ],
  // Deliberately excludes "maturity date". On a life policy that is decades
  // out (2046 on a 2026 policy) while cover still renews annually — reading it
  // as the expiry would silently switch off the renewal reminder for 20 years.
  // It is captured separately below.
  expiryDate: [
    /\b(?:policy\s*)?(?:expiry|end)\s*date\b/i,
    /\bvalid\s*(?:up\s*to|till|until)\b/i, /\bexpires\s*on\b/i,
  ],
  maturityDate: [/\bmaturity\s*date\b/i, /\bdate\s*of\s*maturity\b/i],
  nominee: [/\bnominee(?:'s)?\s*name\b/i, /\bnominee\b/i],
  registrationNo: [/\bregistration\s*(?:no|number)\b/i, /\bvehicle\s*(?:no|number)\b/i],
  // ── Client fields ──────────────────────────────────────────────────────
  // Kept in the same pass because a schedule prints them alongside the policy
  // details, but routed to the client record, never onto the policy — see
  // CLIENT_FIELD_NAMES below.
  mobile: [
    /\b(?:mobile|contact|phone)\s*(?:no|number)\b/i,
    /\bmobile\b/i, /\bcontact\s*details\b/i,
  ],
  email: [/\be-?mail\s*(?:id|address)?\b/i],
  dob: [/\bdate\s*of\s*birth\b/i, /\bd\.?\s?o\.?\s?b\.?\b/i, /\bbirth\s*date\b/i],
  pan: [/\bpan\s*(?:no|number|card)?\b/i],
  address: [
    /\b(?:communication|correspondence|residential|mailing)\s*address\b/i,
    /\baddress\b/i,
  ],
}

/**
 * Which extracted fields describe the person rather than the policy. The policy
 * payload is NOT allow-listed on the way into Firestore, so letting a mobile
 * number through would silently write it onto the policy document.
 */
export const CLIENT_FIELD_NAMES = ['clientName', 'mobile', 'email', 'dob', 'pan', 'address']

/** Splits one extraction into the two records it actually feeds. */
export function splitExtractedFields(fields = {}) {
  const client = {}
  const policy = {}
  for (const [field, value] of Object.entries(fields)) {
    if (!String(value ?? '').trim()) continue
    if (CLIENT_FIELD_NAMES.includes(field)) {
      // The client record calls it `name`; the policy denormalises `clientName`.
      client[field === 'clientName' ? 'name' : field] = value
    }
    // clientName is also kept on the policy, which stores its own copy.
    if (!CLIENT_FIELD_NAMES.includes(field) || field === 'clientName') policy[field] = value
  }
  return { client, policy }
}

const ALL_LABELS = Object.values(LABELS).flat()

// How each field's raw text is cleaned, and what makes it trustworthy.
const MONEY = raw => {
  const m = String(raw).replace(/[,\s]/g, '').match(/-?\d+(?:\.\d+)?/)
  return m ? String(Number(m[0])) : ''
}
const DATE = raw => {
  // A "Period of Insurance" line carries both dates; take the first here and
  // let expiryDate's own label pick up the second.
  const m = String(raw).match(/\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}|\d{1,2}\s+\w{3,9}\s+\d{4}/)
  if (!m) return ''
  const parsed = parseAnyDate(m[0])
  return parsed && !Number.isNaN(parsed.getTime()) ? toInputDate(parsed) : ''
}
const TEXT = raw => String(raw).replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim()

// Schedules print +91, 0-prefixes and spaces; the client record stores ten
// digits, so normalise here rather than making the user retype it.
const MOBILE = raw => {
  const digits = String(raw).replace(/\D/g, '')
  const national = digits.length > 10 ? digits.slice(-10) : digits
  return /^[6-9]\d{9}$/.test(national) ? national : ''
}

const CLEAN = {
  policyNumber: raw => TEXT(raw).replace(/\s+/g, '').replace(/^[:#-]+/, ''),
  premium: MONEY, sumInsured: MONEY,
  startDate: DATE, expiryDate: DATE, maturityDate: DATE,
  dob: DATE,
  mobile: MOBILE,
  email: raw => (String(raw).match(/[^\s<>()[\]]+@[^\s<>()[\]]+\.[a-z]{2,}/i) || [''])[0].toLowerCase(),
  pan: raw => (String(raw).toUpperCase().match(/[A-Z]{5}\d{4}[A-Z]/) || [''])[0],
}

const VALID = {
  policyNumber: v => /^[A-Za-z0-9/-]{6,}$/.test(v),
  premium: v => Number(v) > 0,
  sumInsured: v => Number(v) > 0,
  startDate: v => !!v,
  expiryDate: v => !!v,
  maturityDate: v => !!v,
  clientName: v => /^[A-Za-z][A-Za-z\s.'-]{2,}$/.test(v) && v.split(/\s+/).length <= 6,
  registrationNo: v => /^[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{0,3}[\s-]?\d{1,4}$/i.test(v.replace(/\s/g, ' ')),
  mobile: v => /^[6-9]\d{9}$/.test(v),
  email: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  // Firestore rejects a malformed PAN outright, so a half-read one must not
  // reach the save — better to show it yellow and let the user finish it.
  pan: v => /^[A-Z]{5}\d{4}[A-Z]$/.test(v),
  dob: v => !!v,
  address: v => v.length >= 8,
}

const isLabel = text => ALL_LABELS.some(re => re.test(text))

/**
 * The value belonging to a label on one line.
 * Handles both "Policy No: 12345" in a single text run and ["Policy No", "12345"]
 * split across runs. Stops collecting at the next label so a two-column schedule
 * does not bleed the neighbouring field's value into this one.
 */
function valueOnLine(line, labelRe) {
  const cells = line.cells
  for (let i = 0; i < cells.length; i++) {
    const m = cells[i].text.match(labelRe)
    if (!m) continue
    const tail = cells[i].text.slice(m.index + m[0].length).replace(/^[\s:.\-–—#]+/, '').trim()
    if (tail) return { value: tail, x: cells[i].x, sure: true }

    const parts = []
    for (const cell of cells.slice(i + 1)) {
      if (isLabel(cell.text)) break
      parts.push(cell.text)
    }
    const rest = parts.join(' ').replace(/^[\s:.\-–—#]+/, '').trim()
    if (rest) return { value: rest, x: cells[i + 1]?.x ?? cells[i].x, sure: true }
    return { value: '', x: cells[i].x, sure: false }   // label with nothing after it
  }
  return null
}

/** Value stacked under its label — common in boxed schedule layouts. */
function valueBelow(lines, index, x) {
  for (const line of lines.slice(index + 1, index + 3)) {
    const near = line.cells.filter(c => Math.abs(c.x - x) < 60 && !isLabel(c.text))
    const text = near.map(c => c.text).join(' ').trim()
    if (text) return text
  }
  return ''
}

/** Insurer is almost never labelled — it is the letterhead. Longest name wins. */
export function detectInsurer(text) {
  const hay = text.toLowerCase()
  return KNOWN_INSURERS
    .filter(name => hay.includes(name.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0] || ''
}

/** Health / Life / Motor from the vocabulary the document uses. */
export function detectPolicyType(text) {
  const hay = text.toLowerCase()
  if (/registration\s*(no|number)|chassis|engine\s*no|idv|insured'?s declared value/.test(hay)) return 'Motor'
  if (/sum\s*assured|maturity|term\s*plan|life\s*assured|annuit/.test(hay)) return 'Life'
  if (/sum\s*insured|mediclaim|health|hospitali[sz]ation|room\s*rent/.test(hay)) return 'Health'
  return ''
}

/**
 * Pull policy fields out of already-extracted PDF lines.
 *
 * Returns every field it looked for, each tagged:
 *   found     — value passed its validator, safe to prefill
 *   uncertain — something was read but it does not look right; ask the user
 *   missing   — no label matched anywhere in the document
 *
 * The review screen colours these yellow and red respectively. Nothing here
 * decides to save anything.
 */
export function extractPolicyFields(pages = []) {
  const lines = pages.flat()
  const fullText = lines.map(l => l.cells.map(c => c.text).join(' ')).join('\n')

  const fields = {}
  const status = {}

  for (const [field, patterns] of Object.entries(LABELS)) {
    let raw = '', hit = null
    outer:
    for (const re of patterns) {
      for (let i = 0; i < lines.length; i++) {
        const found = valueOnLine(lines[i], re)
        if (!found) continue
        hit = found
        raw = found.value || valueBelow(lines, i, found.x)
        if (raw) break outer
      }
    }

    if (!hit) { fields[field] = ''; status[field] = 'missing'; continue }

    const value = (CLEAN[field] || TEXT)(raw)
    const check = VALID[field]
    fields[field] = value
    status[field] = !value ? 'uncertain' : check && !check(value) ? 'uncertain' : 'found'
  }

  // Expiry sometimes only exists as the second date on a "Period of Insurance"
  // line — 01/04/2026 to 31/03/2027. Recover it rather than calling it missing.
  if (status.expiryDate !== 'found') {
    const period = lines.find(l => /period\s*of\s*insurance/i.test(l.cells.map(c => c.text).join(' ')))
    const dates = period && period.cells.map(c => c.text).join(' ')
      .match(/\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}/g)
    if (dates?.length >= 2) {
      const value = DATE(dates[1])
      if (value) { fields.expiryDate = value; status.expiryDate = 'found' }
    }
  }

  const insurer = detectInsurer(fullText)
  fields.insurer = insurer
  status.insurer = insurer ? 'found' : 'missing'

  const policyType = detectPolicyType(fullText)
  fields.policyType = policyType
  status.policyType = policyType ? 'found' : 'missing'

  return {
    fields,
    status,
    found: Object.keys(status).filter(k => status[k] === 'found'),
    uncertain: Object.keys(status).filter(k => status[k] === 'uncertain'),
    missing: Object.keys(status).filter(k => status[k] === 'missing'),
  }
}

const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Does this PDF describe a policy already on the books?
 *
 * Mirrors the commission importer's rule, and for the same reason: an exact
 * policy-number hit is the only thing allowed to resolve on its own. A name
 * match alone goes to a human, because two family members on similar plans
 * look almost identical to a fuzzy matcher.
 *
 *   update  — same policy number; offer to fill in what the record is missing
 *   review  — looks like an existing client's policy, but not provably so
 *   create  — nothing resembles it; offer to add it as a new policy
 */
export function matchExtractedPolicy(fields = {}, policies = []) {
  const num = key(fields.policyNumber)
  const exact = num ? policies.filter(p => key(p.policyNumber) === num) : []

  if (exact.length === 1) {
    return { policy: exact[0], action: 'update', reason: 'Policy number already on file' }
  }
  if (exact.length > 1) {
    return { policy: null, action: 'review', reason: `${exact.length} policies share this number` }
  }

  const near = fields.clientName
    ? fuzzyMatch(fields.clientName, policies.map(p => ({ ...p, name: p.clientName })), 0.8)
    : []
  if (near.length) {
    return {
      policy: near[0],
      action: 'review',
      reason: near.length === 1
        ? `Same client name as policy ${near[0].policyNumber}, different number`
        : `${near.length} policies match this client name`,
    }
  }
  return { policy: null, action: 'create', reason: 'No matching policy found' }
}

/**
 * What the review screen shows: one row per field, with the PDF value beside
 * the value already on record.
 *
 *   agree    — both sides match, nothing to do
 *   fill     — the record is blank and the PDF has a value (the useful case)
 *   conflict — both have values and they differ; the user picks
 *   missing  — the PDF has nothing (red)
 *   uncertain— read something unusable (yellow)
 */
// A schedule prints the carrier's full legal name while the record usually
// holds the short one — "Niva Bupa Health Insurance" vs "Niva Bupa". Treating
// that as a conflict would flag the insurer on virtually every document, so
// containment counts as agreement here, as it does in the commission importer.
const sameValue = (a, b, field) => {
  const x = key(a), y = key(b)
  if (!x || !y) return false
  if (x === y) return true
  return field === 'insurer' && (x.includes(y) || y.includes(x))
}

/**
 * Which client on file this schedule belongs to.
 *
 *   link    — a mobile or PAN matched exactly; safe to attach without asking
 *   confirm — the name matches closely but nothing unique does; ask first
 *   choose  — several clients could be it; the user must pick
 *   create  — nobody resembles it; offer to add the client
 *
 * Mobile and PAN are treated as identifiers and a name never is: two brothers
 * at one address routinely share a surname, and silently filing a policy under
 * the wrong sibling is far worse than asking one extra question.
 */
export function matchExtractedClient(fields = {}, clients = []) {
  const mobile = String(fields.mobile || '').replace(/\D/g, '').slice(-10)
  const pan = String(fields.pan || '').toUpperCase()

  if (mobile) {
    const hits = clients.filter(c => String(c.mobile || '').replace(/\D/g, '').slice(-10) === mobile)
    if (hits.length === 1) return { client: hits[0], action: 'link', reason: 'Mobile number already on file' }
    if (hits.length > 1) return { client: null, action: 'choose', reason: `${hits.length} clients share this mobile number` }
  }
  if (pan) {
    const hits = clients.filter(c => String(c.pan || '').toUpperCase() === pan)
    if (hits.length === 1) return { client: hits[0], action: 'link', reason: 'PAN already on file' }
  }

  const name = String(fields.clientName || '').trim()
  if (!name) return { client: null, action: 'create', reason: 'No client name found in the PDF' }

  const near = fuzzyMatch(name, clients, 0.85)
  if (near.length === 1) {
    return { client: near[0], action: 'confirm', reason: 'Name matches a client on file — confirm it is the same person' }
  }
  if (near.length > 1) {
    return { client: null, action: 'choose', reason: `${near.length} clients have a similar name`, candidates: near }
  }
  return { client: null, action: 'create', reason: 'No client on file with this name' }
}

/**
 * SHA-256 of the file's own bytes, via the browser's built-in Web Crypto — no
 * dependency, no upload. Two files with the same hash are the same document,
 * whatever they were renamed to.
 */
export async function fileFingerprint(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** The policy this exact file is already attached to, if any. */
export function findPdfDuplicate(hash, policies = []) {
  if (!hash) return null
  return policies.find(p => p.policyPdfHash === hash) || null
}

/**
 * Everything OCR read is downgraded to 'uncertain', so the whole review comes
 * up yellow. OCR confuses 8/B, 0/O and 1/7, and a misread premium that looked
 * confidently green would go straight onto the record.
 */
export function markAllUncertain(result) {
  const status = Object.fromEntries(
    Object.entries(result.status).map(([field, state]) => [field, state === 'missing' ? 'missing' : 'uncertain'])
  )
  return { ...result, status, source: 'ocr' }
}

export function buildFieldReview(extracted, policy = null) {
  const { fields, status } = extracted
  return Object.keys(fields).map(field => {
    const pdfValue = fields[field]
    const dbValue = policy ? String(policy[field] ?? '') : ''
    const state =
      status[field] === 'missing' ? 'missing'
        : status[field] === 'uncertain' ? 'uncertain'
          : !dbValue ? 'fill'
            : sameValue(dbValue, pdfValue, field) ? 'agree'
              : 'conflict'
    return { field, pdfValue, dbValue, state }
  })
}
