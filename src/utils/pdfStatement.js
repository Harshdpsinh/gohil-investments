// src/utils/pdfStatement.js
// Extracts per-policy commission rows from insurer PDF statements.
//
// Reality check from real files: only some statements contain policy-level rows
// at all. Niva Bupa and Aditya Birla ship totals only, so there is nothing to
// extract and this returns []. The caller must surface that rather than
// pretending the parse failed.
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { toNumber } from './commissionImport'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

/** Every page as an array of visual lines: { y, cells: [{x, text}] }. */
export async function extractLines(arrayBuffer) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
  const pages = []
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent()
    const byY = new Map()
    for (const item of content.items) {
      if (!item.str.trim()) continue
      const y = Math.round(item.transform[5])
      if (!byY.has(y)) byY.set(y, [])
      byY.get(y).push({ x: item.transform[4], text: item.str.trim() })
    }
    const lines = [...byY.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, cells]) => ({ y, cells: cells.sort((a, b) => a.x - b.x) }))
    pages.push(lines)
  }
  return pages
}

const cellsOf = line => line.cells.map(c => c.text)
const joined = line => cellsOf(line).join(' ')

// ── ICICI Lombard: "EAnnexure" ──────────────────────────────────────────
// Header: Intermediary Name | IRDA Code | MO Name | Insured Name | System
// Policy No | GWP | %TDS | Gross Amt | TDS | Net Amt | ... | Renewed Policy
function parseIciciLombard(pages) {
  const rows = []
  for (const lines of pages) {
    const header = lines.find(l => /insured name/i.test(joined(l)) && /system policy no/i.test(joined(l)))
    if (!header) continue
    const cols = cellsOf(header)
    const at = re => cols.findIndex(c => re.test(c))
    const iName = at(/insured name/i), iPolicy = at(/policy no/i)
    const iGwp = at(/^gwp$/i), iGross = at(/gross amt/i), iType = at(/renewed policy/i)

    for (const line of lines) {
      if (line === header) continue
      const cells = cellsOf(line)
      if (cells.length < cols.length - 2) continue
      if (/grand total|professional tax/i.test(joined(line))) continue
      const policyNumber = cells[iPolicy]
      if (!policyNumber || !/\d/.test(policyNumber)) continue
      const gross = toNumber(cells[iGross])
      const premium = toNumber(cells[iGwp])
      if (!gross) continue
      rows.push({
        policyNumber: policyNumber.replace(/\/+$/, ''),
        clientName: cells[iName] || '',
        insurer: 'ICICI Lombard',
        premium,
        commissionAmount: gross,
        commissionPct: premium ? Number(((gross / premium) * 100).toFixed(2)) : 0,
        businessType: /renew/i.test(cells[iType] || '') ? 'Renewal' : 'New',
      })
    }
  }
  return rows
}

// ── Tata AIA: "Income Statement" → Cycle Wise Earning Breakup ───────────
// Row: date | policyNo | insured | ... | modalPremium | rate% | debit | credit
const TATA_ROW = /^(\d{2}\/\d{2}\/\d{4})\s+([A-Z]?\d{6,})\s+(.+?)\s+([\d,]+)\s+([\d.]+)\s*%\s+([\d,.]+)\s+([\d,.]+)$/

function parseTataAia(pages) {
  const rows = []
  for (const lines of pages) {
    if (!lines.some(l => /cycle wise earning breakup/i.test(joined(l)))) continue
    for (const line of lines) {
      const m = joined(line).replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim().match(TATA_ROW)
      if (!m) continue
      const [, , policyNumber, rest, premium, rate, , credit] = m
      rows.push({
        policyNumber,
        // Strip the status/term codes and PT/PPT numbers sitting between the
        // name and the premium column.
        clientName: rest
          .replace(/\b(N|Y|FYC|RYC|Inforce|Lapsed|Surrendered)\b/gi, ' ')
          .replace(/\b\d+\b/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
        insurer: 'Tata AIA',
        premium: toNumber(premium),
        commissionPct: toNumber(rate),
        commissionAmount: toNumber(credit),
        businessType: /RYC/i.test(rest) ? 'Renewal' : 'New',
      })
    }
  }
  return rows
}

// ── Generic: any page with a single-line header naming the fields ───────
const HEAD = {
  policyNumber: /policy\s*(no|num|number)/i,
  clientName: /(insured|customer|client|policy\s*holder)\s*name/i,
  premium: /premium|gwp/i,
  commissionAmount: /(commission|brokerage|gross)\s*(amt|amount)?/i,
}

function parseGeneric(pages) {
  const rows = []
  for (const lines of pages) {
    const header = lines.find(l => {
      const text = joined(l)
      return HEAD.policyNumber.test(text) && (HEAD.clientName.test(text) || HEAD.commissionAmount.test(text))
    })
    if (!header) continue
    const cols = cellsOf(header)
    const idx = {}
    for (const [field, re] of Object.entries(HEAD)) idx[field] = cols.findIndex(c => re.test(c))

    for (const line of lines) {
      if (line === header) continue
      const cells = cellsOf(line)
      const policyNumber = cells[idx.policyNumber]
      const amount = toNumber(cells[idx.commissionAmount])
      if (!policyNumber || !/\d{4,}/.test(policyNumber) || !amount) continue
      if (/total/i.test(joined(line))) continue
      const premium = toNumber(cells[idx.premium])
      rows.push({
        policyNumber: String(policyNumber).replace(/\/+$/, ''),
        clientName: cells[idx.clientName] || '',
        insurer: '',
        premium,
        commissionAmount: amount,
        commissionPct: premium ? Number(((amount / premium) * 100).toFixed(2)) : 0,
        businessType: '',
      })
    }
  }
  return rows
}

const PARSERS = [
  ['ICICI Lombard', parseIciciLombard],
  ['Tata AIA', parseTataAia],
  ['generic table', parseGeneric],
]

/**
 * Returns { rows, format }. rows === [] means the PDF holds no policy-level
 * detail — several insurers publish totals only, which is not a parse failure.
 */
export async function parsePdfStatement(arrayBuffer) {
  const pages = await extractLines(arrayBuffer)
  for (const [format, parser] of PARSERS) {
    const rows = parser(pages)
    if (rows.length) {
      return {
        format,
        rows: rows.map((row, i) => ({ ...row, sourceRow: i + 1, payoutDate: '', payoutMonth: '' })),
      }
    }
  }
  return { format: 'unrecognised', rows: [] }
}
