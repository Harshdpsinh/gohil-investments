// src/utils/exportUtils.js
import * as XLSX      from 'xlsx'
import { saveAs }     from 'file-saver'
import jsPDF          from 'jspdf'
import autoTable      from 'jspdf-autotable'
import { fmtDate, fmtCurrency } from './dateUtils'
import { format }     from 'date-fns'

const ts = () => format(new Date(), 'yyyy-MM-dd')

// ── CSV export ────────────────────────────────────────────────
export function exportToCSV(rows, columns, filename) {
  const header = columns.map(c => c.header).join(',')
  const body   = rows.map(r =>
    columns.map(c => {
      const val = String(c.accessor(r) ?? '')
      return val.includes(',') ? `"${val}"` : val
    }).join(',')
  ).join('\n')
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8;' })
  saveAs(blob, `${filename}_${ts()}.csv`)
}

// ── Excel export ──────────────────────────────────────────────
export function exportToExcel(rows, columns, sheetName, filename) {
  const wsData = [
    columns.map(c => c.header),
    ...rows.map(r => columns.map(c => c.accessor(r) ?? ''))
  ]
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(wsData)
  ws['!cols'] = columns.map(() => ({ wch: 22 }))
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  saveAs(new Blob([buf], { type: 'application/octet-stream' }),
         `${filename}_${ts()}.xlsx`)
}

// ── PDF export ────────────────────────────────────────────────
export function exportToPDF(rows, columns, title, filename) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  doc.setFontSize(14); doc.setTextColor(30, 64, 175)
  doc.text('GOHIL INVESTMENTS', 14, 14)
  doc.setFontSize(9); doc.setTextColor(100)
  doc.text('Wealth Management & Insurance Advisory', 14, 20)
  doc.setFontSize(11); doc.setTextColor(30)
  doc.text(title, 14, 28)
  doc.setFontSize(8); doc.setTextColor(120)
  doc.text(`Generated: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 33)
  autoTable(doc, {
    startY: 38,
    head:   [columns.map(c => c.header)],
    body:   rows.map(r => columns.map(c => String(c.accessor(r) ?? ''))),
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [239, 246, 255] },
    margin: { left: 14, right: 14 },
  })
  doc.save(`${filename}_${ts()}.pdf`)
}

// ── Download blank import template ────────────────────────────
export function downloadTemplate(headers, sheetName, filename, sampleRow = null) {
  const wb   = XLSX.utils.book_new()
  const data = sampleRow ? [headers, sampleRow] : [headers]
  const ws   = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = headers.map(() => ({ wch: 24 }))
  // Bold the header row
  headers.forEach((_, i) => {
    const cell = XLSX.utils.encode_cell({ r: 0, c: i })
    if (!ws[cell]) return
    ws[cell].s = { font: { bold: true }, fill: { fgColor: { rgb: 'DBEAFE' } } }
  })
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  saveAs(new Blob([buf], { type: 'application/octet-stream' }), `${filename}_template.xlsx`)
}

// ── Parse uploaded Excel / CSV into array of plain objects ───
export function parseImportFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb   = XLSX.read(e.target.result, { type: 'binary', cellDates: true })
        const ws   = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
        resolve(rows)
      } catch {
        reject(new Error('Could not read file. Use a valid .xlsx or .csv file.'))
      }
    }
    reader.onerror = () => reject(new Error('File read failed.'))
    reader.readAsBinaryString(file)
  })
}

// ── Date normaliser (handles Date objects, dd/MM/yyyy, yyyy-MM-dd) ──
export function normaliseDate(val) {
  if (!val) return ''
  if (val instanceof Date) return val.toISOString().split('T')[0]
  const s = String(val).trim()
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return s
}

// ── Column definitions ────────────────────────────────────────
export const CLIENT_COLS = [
  { header: 'Name',        accessor: r => r.name },
  { header: 'Mobile',      accessor: r => r.mobile },
  { header: 'Email',       accessor: r => r.email },
  { header: 'PAN',         accessor: r => r.pan },
  { header: 'Aadhar',      accessor: r => r.aadhar },
  { header: 'Occupation',  accessor: r => r.occupation },
  { header: 'Address',     accessor: r => r.address },
  { header: 'KYC Status',  accessor: r => r.kycStatus || 'Pending' },
]

export const POLICY_COLS = [
  { header: 'Policy No',         accessor: r => r.policyNumber },
  { header: 'Client',            accessor: r => r.clientName },
  { header: 'Type',              accessor: r => r.policyType },
  { header: 'Insurer',           accessor: r => r.insurer },
  { header: 'Plan',              accessor: r => r.planName },
  { header: 'Premium',           accessor: r => r.premium },
  { header: 'Sum Assured',       accessor: r => r.sumAssured },
  { header: 'Start Date',        accessor: r => fmtDate(r.startDate) },
  { header: 'Expiry Date',       accessor: r => fmtDate(r.expiryDate) },
  { header: 'Status',            accessor: r => r.status || 'Active' },
  { header: 'Frequency',         accessor: r => r.frequency },
  { header: 'FY Commission %',   accessor: r => r.fyCommission || '' },
  { header: 'RY Commission %',   accessor: r => r.ryCommission || '' },
]

// ── Import template definitions ───────────────────────────────
export const CLIENT_IMPORT_HEADERS = [
  'Name', 'Mobile', 'Email', 'PAN', 'Aadhar',
  'Date of Birth', 'Occupation', 'Address', 'KYC Status'
]
export const CLIENT_IMPORT_SAMPLE = [
  'Ramesh Shah', '9876543210', 'ramesh@email.com',
  'ABCDE1234F', '123456789012', '15/06/1980',
  'Businessman', '12 MG Road, Bhavnagar', 'Complete'
]

export const POLICY_IMPORT_HEADERS = [
  'Policy No', 'Client Name', 'Policy Type', 'Insurer', 'Plan Name',
  'Premium', 'Sum Assured', 'Frequency', 'Start Date', 'Expiry Date',
  'Status', 'Nominee', 'Nominee Relation',
  'FY Commission %', 'RY Commission %', 'Notes'
]
export const POLICY_IMPORT_SAMPLE = [
  'ICL-2024-001', 'Ramesh Shah', 'Health', 'ICICI Lombard', 'Health Shield',
  '15000', '500000', 'Yearly', '01/04/2024', '31/03/2025',
  'Active', 'Sunita Shah', 'Spouse', '15', '7.5', 'Annual renewal'
]
