// src/utils/pdfStatement.js
// Extracts per-policy commission rows from insurer PDF statements.
//
// Every insurer lays these out differently, and two of them do not use rows at
// all: Aditya Birla wraps one record over three stacked text lines, and Star
// Health rotates the whole table so policies become columns. Each profile below
// was written against a real statement, not a guess.
//
// Returning [] means the PDF genuinely holds no policy-level detail (some
// insurers publish only totals) — the caller must say so rather than reporting
// a parse failure.
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

// ── Aditya Birla Health: "Annexure 1 : Policies Issued" ─────────────────
// One record spans three stacked text lines at the same x, e.g. the policy id
// arrives as "31-26-" / "0164666-" / "00". Anchor on the line carrying the
// numbers, then sweep a y-window and bucket every fragment by x column.
const ABH_BANDS = {
  policyNumber: [28, 66], clientName: [66, 108], businessType: [108, 145],
  productName: [145, 200], premium: [248, 312], commissionPct: [312, 356],
  commissionAmount: [356, 420],
}

function bucket(items, bands) {
  const out = {}
  for (const [field, [lo, hi]] of Object.entries(bands)) {
    out[field] = items
      .filter(i => i.x >= lo && i.x < hi)
      .sort((a, b) => (b.y - a.y) || (a.x - b.x))
      .map(i => i.text)
      .join(' ')
      .replace(/\s*-\s*(?=\d)/g, '-')  // rejoin "31-26- 0164666- 00"
      .replace(/\s+/g, ' ')
      .trim()
  }
  return out
}

function parseAdityaBirla(pages) {
  const rows = []
  for (const lines of pages) {
    if (!lines.some(l => /annexure\s*1\s*:\s*policies issued/i.test(joined(l)))) continue
    const flat = lines.flatMap(l => l.cells.map(c => ({ ...c, y: l.y })))

    for (const line of lines) {
      const amount = line.cells.find(c => c.x >= 356 && c.x < 420 && /^-?[\d,.]+$/.test(c.text))
      const finalAmt = line.cells.find(c => c.x >= 505 && c.x < 570 && /^-?[\d,.]+$/.test(c.text))
      if (!amount || !finalAmt) continue
      const near = flat.filter(i => Math.abs(i.y - line.y) <= 13)
      if (near.some(i => /^total$/i.test(i.text))) continue
      const r = bucket(near, ABH_BANDS)
      // A policy id always carries digits; this rejects the GST summary block.
      if (!/\d/.test(r.policyNumber) || !toNumber(r.commissionAmount)) continue
      rows.push({
        policyNumber: r.policyNumber.replace(/\s/g, ''),
        clientName: r.clientName,
        insurer: 'Aditya Birla Health Insurance',
        premium: toNumber(r.premium),
        commissionPct: toNumber(r.commissionPct),
        commissionAmount: toNumber(r.commissionAmount),
        businessType: /retail new|new/i.test(r.businessType) ? 'New' : r.businessType || '',
      })
    }
  }
  return rows
}

// ── Star Health: agent provisional statement ────────────────────────────
// The table is rotated: each policy is an x-column, each field a y-row. Read
// the label positions, then take the values sitting on those y bands.
function parseStarHealth(pages) {
  const rows = []
  for (const lines of pages) {
    const flat = lines.flatMap(l => l.cells.map(c => ({ ...c, y: l.y })))
    if (!flat.some(i => /STAR HEALTH AND ALLIED/i.test(i.text))) continue

    // Label column sits left of the data columns.
    const labelY = re => {
      const hit = flat.find(i => i.x > 300 && i.x < 375 && re.test(i.text))
      return hit ? hit.y : null
    }
    const yPolicy = labelY(/^Policy No$/i)
    const yName = labelY(/^Proposer's$/i)
    const yPrem = labelY(/^Premium\/Ref$/i)
    const yPay = labelY(/^Payable$/i)
    if (yPolicy === null || yPrem === null) continue

    // Data columns: the x positions of the policy-number values.
    const anchors = flat
      .filter(i => i.x > 375 && Math.abs(i.y - yPolicy) <= 14 && /^\d{6,}$/.test(i.text))
      .sort((a, b) => a.x - b.x)

    for (let n = 0; n < anchors.length; n++) {
      const lo = anchors[n].x - 4
      const hi = n + 1 < anchors.length ? anchors[n + 1].x - 4 : anchors[n].x + 34
      const col = (yc, tol = 14) =>
        flat.filter(i => i.x >= lo && i.x < hi && Math.abs(i.y - yc) <= tol)
          // Rotated table: reading order runs along x, not y.
          .sort((a, b) => (a.x - b.x) || (b.y - a.y)).map(i => i.text)

      const policyNumber = col(yPolicy).join('')
      const premium = toNumber(col(yPrem + 25, 14).find(t => /^[\d,.]+$/.test(t)))
      const payable = yPay === null ? 0 : toNumber(col(yPay + 5, 14).find(t => /^[\d,.]+$/.test(t)))
      if (!policyNumber || !payable) continue
      rows.push({
        policyNumber,
        clientName: yName === null ? '' : col(yName + 8, 16).join(' ').replace(/\s+/g, ' ').trim(),
        insurer: 'Star Health & Allied Insurance',
        premium,
        commissionPct: premium ? Number(((payable / premium) * 100).toFixed(2)) : 0,
        commissionAmount: payable,
        businessType: '',
      })
    }
  }
  return rows
}

const PARSERS = [
  ['Aditya Birla Health', parseAdityaBirla],
  ['Star Health', parseStarHealth],
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
