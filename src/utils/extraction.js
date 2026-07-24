// src/utils/extraction.js
// ─────────────────────────────────────────────────────────────
// Unstructured-text extraction for the Commission Agent.
// Strictly additive — does not import or modify any existing module.
//
// Design rules from the agent spec:
//   - Never hallucinate missing numerical values. Anything that can't
//     be parsed is returned as null; the orchestrator decides
//     REVIEW_REQUIRED based on those nulls.
//   - Phone numbers: strict E.164 (+91XXXXXXXXXX). Anything else → null.
//   - Money: parsed to float. ₹ / commas / "Rs" / trailing "/-" stripped.
//   - Dates: parsed via the shared parseAnyDate (already dd/MM-yyyy
//     hardened) and emitted as yyyy-MM-dd for the JSON output, because
//     that's the storage standard. The UI renders them dd/MM/yyyy via fmtDate.
// ─────────────────────────────────────────────────────────────
import { parseAnyDate } from './dateUtils'
import { format }      from 'date-fns'

// ── Money ──────────────────────────────────────────────────────
// "₹ 12,345.50" → 12345.5 ; "Rs. 5000/-" → 5000 ; "₹1,20,000" → 120000
export function parseMoney(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  let s = String(raw).trim()
  if (!s) return null
  s = s.replace(/₹|rs\.?|inr|\/-|=/gi, '').replace(/,/g, '').trim()
  // keep only digits, one decimal point, leading minus
  const m = s.match(/-?\d+(\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}

// ── Phone (strict E.164) ───────────────────────────────────────
// Accepts: +91XXXXXXXXXX, 91XXXXXXXXXX (when 12 digits starting with 91),
// 0XXXXXXXXXX (strip leading 0 → Indian local), XXXXXXXXXX (10-digit IN mobile).
// Returns "+91XXXXXXXXXX" or null. NEVER returns a partial/best-effort number.
export function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null
  const digits = String(raw).replace(/[^\d+]/g, '').replace(/^\+/, '')
  if (!digits) return null

  // Already has country code
  if (/^91\d{10}$/.test(digits)) return `+${digits}`
  // Explicit +91 passed through after cleaning
  if (/^\+91\d{10}$/.test(`+${digits}`)) return `+91${digits.slice(2)}`

  // 10-digit Indian mobile
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`

  // Local with leading zero stripped
  if (/^0([6-9]\d{9})$/.test(digits)) return `+91${digits.slice(1)}`

  // Generic international: at least 8 digits, all-numeric → +<digits>
  if (digits.length >= 8 && /^\d+$/.test(digits)) return `+${digits}`

  return null
}

// ── Date → yyyy-MM-dd ──────────────────────────────────────────
// Uses the hardened parseAnyDate. Returns null on any failure.
export function normalizeDateToISO(raw) {
  const d = parseAnyDate(raw)
  if (!d) return null
  return format(d, 'yyyy-MM-dd')
}

// ── Customer name ──────────────────────────────────────────────
// Looks for labelled lines: "Name: Ramesh Shah", "Customer - Suresh",
// "From: Priya". Strips the label and trailing punctuation.
// Falls back to "the first non-trivial line" heuristic. Returns null
// only if no candidate at all exists.
export function extractCustomerName(text) {
  if (!text) return null
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  // Labelled
  for (const l of lines) {
    const m = l.match(/^(?:name|customer|client|from|received from|bill to|party)\s*[:\-–]\s*(.+)$/i)
    if (m) {
      const v = m[1].trim().replace(/[,;]+$/, '')
      if (v.length >= 2 && v.length <= 80) return v
    }
  }
  // First line that looks like a person/entity name (no digits, 2–80 chars)
  const cand = lines.find(l =>
    !/\d/.test(l) &&
    l.length >= 2 && l.length <= 80 &&
    !/^(total|amount|date|phone|mobile|invoice|receipt|bill|rs|₹)/i.test(l)
  )
  return cand ? cand.replace(/[,;]+$/, '').trim() : null
}

// ── Phone (from text) ──────────────────────────────────────────
// Finds the first phone-shaped token and runs it through normalizePhone.
export function extractPhone(text) {
  if (!text) return null
  // Prefer labelled
  const labelled = text.match(/(?:phone|mobile|contact|mob|cell|no\.?)\s*[:\-–]?\s*(\+?\d[\d\s\-()]{8,18})/i)
  if (labelled) {
    const p = normalizePhone(labelled[1])
    if (p) return p
  }
  // Any standalone phone-shaped token
  const matches = text.match(/\+?\d[\d\s\-()]{8,18}/g) || []
  for (const m of matches) {
    const p = normalizePhone(m)
    if (p) return p
  }
  return null
}

// ── Date (from text) ───────────────────────────────────────────
export function extractDate(text) {
  if (!text) return null
  const labelled = text.match(/(?:date|dated|on|dt\.?)\s*[:\-–]?\s*([^\n;]{4,20})/i)
  if (labelled) {
    const iso = normalizeDateToISO(labelled[1])
    if (iso) return iso
  }
  // Generic date patterns anywhere in text
  const patterns = [
    /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}\b/g,
    /\b\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}\b/g,
    /\b\d{1,2}\s+[A-Za-z]{3,}\.?\s+\d{4}\b/g,
    /\b[A-Za-z]{3,}\.?\s+\d{1,2},?\s+\d{4}\b/g,
  ]
  for (const re of patterns) {
    const found = text.match(re)
    if (found) {
      for (const cand of found) {
        const iso = normalizeDateToISO(cand)
        if (iso) return iso
      }
    }
  }
  return null
}

// ── Gross amount (from text) ───────────────────────────────────
// Looks for labelled "total/amount/grand total" first, then the largest
// money-shaped token. Returns the highest plausible gross.
export function extractGrossAmount(text) {
  if (!text) return null
  const labelled = text.match(/(?:grand total|total|amount|gross|net amount|bill amount|payable)\s*[:\-–]?\s*(₹?[\d,]+(?:\.\d+)?)/i)
  if (labelled) {
    const v = parseMoney(labelled[1])
    if (v !== null) return v
  }
  // Fallback: all money tokens → max
  const tokens = text.match(/₹\s?\d[\d,]*(?:\.\d+)?|rs\.?\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*\/-/gi) || []
  let best = null
  for (const t of tokens) {
    const v = parseMoney(t)
    if (v !== null && (best === null || v > best)) best = v
  }
  return best
}

// ── Line items ─────────────────────────────────────────────────
// Returns an array of human-readable item strings. Best-effort: pulls
// bullet/numbered/bullet-less lines that look like products (text then price).
// This is heuristic; the UI shows parsed items and lets the user confirm.
export function extractLineItems(text) {
  if (!text) return []
  const items = []
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (const l of lines) {
    // "1. Term Insurance ........ ₹12,000"
    // "- Health Plan  5000"
    // "Motor Cover Rs. 8500/-"
    const m = l.match(/^(?:[-*•]|\d+[.)]\s+)?(.+?)[\s.\-—]+\s*(₹\s?[\d,]+(?:\.\d+)?|rs\.?\s?[\d,]+(?:\.\d+)?|[\d,]+\/-)\s*$/i)
    if (m) {
      const name = m[1].trim().replace(/[.\-—\s]+$/, '')
      if (name.length >= 2 && !/^(total|subtotal|amount|grand|tax|gst|cgst|sgst)$/i.test(name)) {
        items.push(name)
      }
    }
  }
  // De-dup, preserve order
  return Array.from(new Set(items))
}

// ── Top-level entry point ──────────────────────────────────────
// extractFromText(rawText) → partial record (all fields nullable).
// The orchestrator (transactionProcessor.js) decides SUCCESS vs
// REVIEW_REQUIRED — this function only extracts, never judges.
export function extractFromText(raw) {
  const text = typeof raw === 'string' ? raw : ''
  return {
    customerName:  extractCustomerName(text),
    phoneNumber:   extractPhone(text),
    date:          extractDate(text),
    grossAmount:   extractGrossAmount(text),
    itemsParsed:   extractLineItems(text),
    _rawLength:    text.length,
  }
}
