import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { rowsFromWorkbook } from './workbookRows'

function sheet(rows) {
  return XLSX.utils.aoa_to_sheet(rows)
}

function book(sheets) {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, sheet(rows), name)
  }
  return wb
}

describe('rowsFromWorkbook', () => {
  it('merges later sheets that share the same headers', () => {
    const rows = rowsFromWorkbook(book({
      June: [
        ['Policy Number', 'Premium', 'Commission'],
        ['P-1', 1000, 100],
      ],
      July: [
        ['Policy Number', 'Premium', 'Commission'],
        ['P-2', 2000, 200],
      ],
    }))
    expect(rows).toEqual([
      { 'Policy Number': 'P-1', Premium: 1000, Commission: 100 },
      { 'Policy Number': 'P-2', Premium: 2000, Commission: 200 },
    ])
  })

  it('skips an instructions tab with unrelated headers', () => {
    const rows = rowsFromWorkbook(book({
      Data: [
        ['Policy Number', 'Premium'],
        ['P-1', 1000],
      ],
      Instructions: [
        ['How to fill', 'Notes'],
        ['Type the policy number', 'Do not change headers'],
      ],
    }))
    expect(rows).toEqual([{ 'Policy Number': 'P-1', Premium: 1000 }])
  })

  it('does not double-count an identical copied sheet', () => {
    const rows = rowsFromWorkbook(book({
      One: [
        ['Policy Number', 'Premium'],
        ['P-1', 1000],
      ],
      Copy: [
        ['Policy Number', 'Premium'],
        ['P-1', 1000],
      ],
    }))
    expect(rows).toHaveLength(1)
  })
})
