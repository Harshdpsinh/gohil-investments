// Reads every sheet that looks like the same table. Insurer statements often
// split June / July (or "Sheet1" + "Sheet2") — taking only SheetNames[0] dropped
// the rest. Instruction tabs with different headers are skipped so policy
// templates stay clean.
import * as XLSX from 'xlsx'

export function clampSheetRange(ws) {
  const cells = Object.keys(ws || {}).filter(key => !key.startsWith('!'))
  if (!cells.length) return ws
  let maxRow = 0
  let maxCol = 0
  for (const address of cells) {
    const { r, c } = XLSX.utils.decode_cell(address)
    if (r > maxRow) maxRow = r
    if (c > maxCol) maxCol = c
  }
  return {
    ...ws,
    '!ref': XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } }),
  }
}

function headerSet(row) {
  return new Set(Object.keys(row || {}).map(key => String(key).toLowerCase().replace(/[^a-z0-9]/g, '')))
}

function sheetsOverlap(primary, candidate) {
  if (!primary.size || !candidate.size) return false
  let hits = 0
  for (const key of candidate) {
    if (primary.has(key)) hits += 1
  }
  return hits >= Math.min(2, primary.size)
}

export function rowsFromWorkbook(wb) {
  const names = Array.isArray(wb?.SheetNames) ? wb.SheetNames : []
  const chunks = []
  for (const name of names) {
    const sheet = wb?.Sheets?.[name]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json(clampSheetRange(sheet), { defval: '', blankrows: false })
    if (rows.length) chunks.push(rows)
  }
  if (!chunks.length) return []

  const primary = headerSet(chunks[0][0])
  const out = [...chunks[0]]
  const seen = new Set(out.map(row => JSON.stringify(row)))
  for (const chunk of chunks.slice(1)) {
    if (!sheetsOverlap(primary, headerSet(chunk[0]))) continue
    for (const row of chunk) {
      const key = JSON.stringify(row)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(row)
    }
  }
  return out
}
