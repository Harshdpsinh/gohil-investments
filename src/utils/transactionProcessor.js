// src/utils/transactionProcessor.js
// ─────────────────────────────────────────────────────────────
// THE ORCHESTRATOR — wires extraction + tiered commission into
// the exact JSON schema from the agent spec.
//
// processTransaction({sourceType, rawData, tiers})
//   → { status, transaction_details, commission_breakdown, whatsapp_reply_draft }
//
// sourceType: 'text' | 'excel' | 'pdf' | 'image'
// rawData:    { text: string }  or  { rows: object[] }  or  { text: string }
// tiers:      array of { id?, label?, min, max, rate }
//
// For excel/CSV, rawData.rows is an array of row-objects.
// The processor extracts from the FIRST row and falls back to
// the text fallback if the row is empty.
// ─────────────────────────────────────────────────────────────
import { extractFromText, extractPhone, normalizePhone, parseMoney, extractLineItems } from './extraction'
import { calcTieredCommission, formatCalculationNote, describeTierApplied } from './commissionTiers'
import { normalizeDateToISO } from './extraction'

/**
 * processTransaction
 * Returns the exact JSON schema from the spec. Never throws.
 */
export function processTransaction({ sourceType, rawData, tiers }) {
  let extracted

  // ── Step 1: Extract based on source ──
  if (sourceType === 'excel' || sourceType === 'csv') {
    extracted = extractFromRow(rawData?.rows?.[0], rawData)
  } else {
    // text, pdf, image — all arrive as extracted text at this point
    const text = rawData?.text || ''
    extracted = extractFromText(text)
  }

  // ── Step 2: Validate (REVIEW_REQUIRED triggers) ──
  const flags = []
  if (!extracted.customerName || extracted.customerName.trim().length < 2) flags.push('customer_name')
  if (!extracted.phoneNumber)   flags.push('phone_number')
  if (!extracted.date)           flags.push('date')
  if (extracted.grossAmount === null || extracted.grossAmount <= 0) flags.push('gross_amount')

  const status = flags.length === 0 ? 'SUCCESS' : 'REVIEW_REQUIRED'

  // ── Step 3: Tiered commission ──
  const commissionResult = calcTieredCommission(extracted.grossAmount || 0, tiers)

  // ── Step 4: WhatsApp reply draft ──
  const name  = extracted.customerName || 'Customer'
  const amt   = extracted.grossAmount !== null
    ? `₹${extracted.grossAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
    : 'Amount pending'
  const comm  = commissionResult.total > 0
    ? `₹${commissionResult.total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
    : 'To be calculated'

  const reviewNote = status === 'REVIEW_REQUIRED'
    ? `\n\n⚠️ Some details could not be verified (${flags.join(', ')}). Please confirm.`
    : ''

  const whatsapp_reply_draft =
    `Dear ${name},\n\n` +
    `Thank you for your transaction of ${amt}.\n` +
    `Commission: ${comm}.\n\n` +
    `We'll share the detailed statement shortly.\n\n` +
    `*Gohil Investments*\nWealth Management & Insurance Advisory\n` +
    `📞 Harshdipsinh Gohil — 7698997894\n` +
    `📍 Bhavnagar, Gujarat` +
    reviewNote

  // ── Assemble final output ──
  return {
    status,
    transaction_details: {
      customer_name: extracted.customerName || null,
      phone_number: extracted.phoneNumber  || null,
      date:          extracted.date          || null,
      gross_amount:  extracted.grossAmount  ?? null,
      items_parsed:  extracted.itemsParsed  || [],
    },
    commission_breakdown: {
      tier_applied:       describeTierApplied(commissionResult),
      calculation_steps:  formatCalculationNote(commissionResult),
      total_commission:   Math.round(commissionResult.total * 100) / 100,
      _raw_steps:         commissionResult.steps,
    },
    whatsapp_reply_draft,
    _flags:  flags,
    _source: sourceType,
  }
}

// ── Row extraction (for Excel/CSV) ───────────────────────────
function extractFromRow(row, rawData) {
  if (!row) return extractFromText(rawData?.text || '')

  const name  = row['Customer Name'] || row['Client Name'] || row['Name'] || row['name'] || null
  const phone = row['Phone'] || row['Mobile'] || row['Contact'] || row['phone'] || row['mobile'] || null
  const date  = row['Date'] || row['Transaction Date'] || row['date'] || null
  const amt   = row['Amount'] || row['Gross Amount'] || row['Total'] || row['Premium (₹)'] ||
                row['Premium'] || row['amount'] || row['total'] || null

  // Try to extract line items from "Item" / "Description" / "Plan" columns
  const itemFields = ['Items', 'Item', 'Description', 'Plan Name', 'Plan', 'product']
  const items = []
  for (const f of itemFields) {
    if (row[f]) items.push(String(row[f]).trim())
  }

  // Fall back to text extraction if row fields look empty
  if (!name && !phone && !amt) return extractFromText(rawData?.text || '')

  return {
    customerName: name || null,
    phoneNumber:  normalizePhone(phone),
    date:         normalizeDateToISO(date),
    grossAmount:  parseMoney(amt),
    itemsParsed:  items,
    _rawLength:   0,
  }
}
