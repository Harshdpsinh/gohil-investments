// src/utils/exportUtils.js
import * as XLSX      from 'xlsx'
import { saveAs }     from 'file-saver'
import jsPDF          from 'jspdf'
import autoTable      from 'jspdf-autotable'
import { fmtDate, normaliseFrequency } from './dateUtils'
import { format }     from 'date-fns'

const ts = () => format(new Date(), 'yyyy-MM-dd')

// ── Logo loaded from public folder (no base64 embedding) ────
// Place g1.jpg in your project's /public/ folder
const LOGO_URL = '/g1.jpg'
const LOGO_W   = 38   // mm width in PDF header
const LOGO_H   = 20   // mm height in PDF header

// Cache the loaded image data for reuse across exports
let _logoDataCache = null
async function getLogoData() {
  if (_logoDataCache) return _logoDataCache
  try {
    const res  = await fetch(LOGO_URL)
    const blob = await res.blob()
    return new Promise(resolve => {
      const reader = new FileReader()
      reader.onloadend = () => { _logoDataCache = reader.result; resolve(reader.result) }
      reader.readAsDataURL(blob)
    })
  } catch { return null }
}

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

// ── Excel export (with logo header rows) ─────────────────────
export function exportToExcel(rows, columns, sheetName, filename) {
  const generated = format(new Date(), 'dd/MM/yyyy HH:mm')
  // Logo row: merge cell A1 with company name text (image not supported in xlsx-js without paid lib)
  // We add 3 branded header rows instead
  const wsData = [
    ['GOHIL INVESTMENTS — Wealth Management & Insurance Advisory'],
    [`Report: ${sheetName}    |    Generated: ${generated}    |    Bhavnagar, Gujarat`],
    [],  // blank spacer
    columns.map(c => c.header),
    ...rows.map(r => columns.map(c => c.accessor(r) ?? ''))
  ]
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Column widths
  ws['!cols'] = columns.map(() => ({ wch: 22 }))

  // Merge header row across all columns
  const colCount = columns.length
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } },
  ]

  // Style header cells (blue background, white text)
  // Row 0 = company name
  const c0 = XLSX.utils.encode_cell({ r: 0, c: 0 })
  if (ws[c0]) ws[c0].s = { font: { bold: true, sz: 13, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E40AF' } }, alignment: { horizontal: 'left', vertical: 'center' } }
  const c1 = XLSX.utils.encode_cell({ r: 1, c: 0 })
  if (ws[c1]) ws[c1].s = { font: { sz: 9, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E3A8A' } } }
  // Row 3 = column headers
  columns.forEach((_, i) => {
    const cell = XLSX.utils.encode_cell({ r: 3, c: i })
    if (!ws[cell]) return
    ws[cell].s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E40AF' } } }
  })

  // Row heights
  ws['!rows'] = [{ hpt: 22 }, { hpt: 14 }, { hpt: 6 }, { hpt: 16 }]

  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  saveAs(new Blob([buf], { type: 'application/octet-stream' }), `${filename}_${ts()}.xlsx`)
}

// ── PDF header helper (async — loads logo from /public/g1.jpg) ─
async function addPdfHeader(doc, title) {
  const pageW = doc.internal.pageSize.getWidth()
  // Logo
  try {
    const logoData = await getLogoData()
    if (logoData) doc.addImage(logoData, 'JPEG', 6, 4, LOGO_W, LOGO_H)
  } catch(e) { /* logo unavailable, skip */ }
  // Company name
  doc.setFontSize(15); doc.setTextColor(30, 64, 175)
  doc.setFont(undefined, 'bold')
  doc.text('GOHIL INVESTMENTS', LOGO_W + 12, 12)
  doc.setFontSize(8); doc.setTextColor(80); doc.setFont(undefined, 'normal')
  doc.text('Wealth Management & Insurance Advisory', LOGO_W + 12, 18)
  doc.text('Bhavnagar, Gujarat', LOGO_W + 12, 23)
  // Divider
  doc.setDrawColor(30, 64, 175); doc.setLineWidth(0.4)
  doc.line(6, 26, pageW - 6, 26)
  // Title + date
  doc.setFontSize(11); doc.setTextColor(30); doc.setFont(undefined, 'bold')
  doc.text(title, 6, 33)
  doc.setFontSize(8); doc.setTextColor(120); doc.setFont(undefined, 'normal')
  doc.text(`Generated: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, pageW - 6, 33, { align: 'right' })
}

// ── PDF export ────────────────────────────────────────────────
export async function exportToPDF(rows, columns, title, filename) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  await addPdfHeader(doc, title)
  autoTable(doc, {
    startY: 37,
    head:   [columns.map(c => c.header)],
    body:   rows.map(r => columns.map(c => String(c.accessor(r) ?? ''))),
    styles:             { fontSize: 7, cellPadding: 2 },
    headStyles:         { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [239, 246, 255] },
    margin:             { left: 6, right: 6 },
    didDrawPage: async (data) => {
      if (data.pageNumber > 1) await addPdfHeader(doc, title)
    }
  })
  doc.save(`${filename}_${ts()}.pdf`)
}

// ── Download blank import template ────────────────────────────
export function downloadTemplate(headers, sheetName, filename, sampleRow = null) {
  const wb   = XLSX.utils.book_new()
  const data = sampleRow ? [headers, sampleRow] : [headers]
  const ws   = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = headers.map(() => ({ wch: 24 }))
  headers.forEach((_, i) => {
    const cell = XLSX.utils.encode_cell({ r: 0, c: i })
    if (!ws[cell]) return
    ws[cell].s = { font: { bold: true }, fill: { fgColor: { rgb: 'DBEAFE' } } }
  })
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  saveAs(new Blob([buf], { type: 'application/octet-stream' }), `${filename}_template.xlsx`)
}

// ── Parse uploaded Excel / CSV ────────────────────────────────
export function parseImportFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb   = XLSX.read(e.target.result, { type: 'array', cellDates: true })  // FIX #4: array not binary
        const ws   = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
        resolve(rows)
      } catch {
        reject(new Error('Could not read file. Use a valid .xlsx or .csv file.'))
      }
    }
    reader.onerror = () => reject(new Error('File read failed.'))
    reader.readAsArrayBuffer(file)   // FIX #4: replaces deprecated readAsBinaryString
  })
}

// ── Date normaliser ───────────────────────────────────────────
export function normaliseDate(val) {
  if (!val) return ''
  if (val instanceof Date) return format(val, 'yyyy-MM-dd')
  const s   = String(val).trim()
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!dmy) {
    throw new Error(`Date "${s}" must be in dd/mm/yyyy format.`)
  }
  const day = Number(dmy[1])
  const month = Number(dmy[2])
  const year = Number(dmy[3])
  const parsed = new Date(year, month - 1, day)
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    throw new Error(`Date "${s}" is not a valid calendar date.`)
  }
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
}

const yesNo = val => String(val||'').trim().toLowerCase() === 'yes'
const str   = val => String(val||'').trim()
const num   = val => str(val).replace(/[₹,\s]/g, '')

function normHeader(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[₹()]/g, '')
    .replace(/rs\.?|rupees?/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

function col(row, names) {
  const wanted = names.map(normHeader)
  for (const [key, value] of Object.entries(row || {})) {
    if (wanted.includes(normHeader(key))) return value
  }
  return ''
}

const premiumValue = row => col(row, [
  'Premium (₹)', 'Premium (Rs)', 'Premium Rs', 'Premium',
  'Annual Premium', 'Premium Amount', 'Amount'
])
const sumInsuredValue = row => col(row, [
  'Sum Insured (₹)', 'Sum Insured (Rs)', 'Sum Insured',
  'Sum Insured Amount', 'Coverage Amount'
])
const sumAssuredValue = row => col(row, [
  'Sum Assured (₹)', 'Sum Assured (Rs)', 'Sum Assured',
  'Sum Assured Amount', 'Cover Amount'
])
const idvValue = row => col(row, ['IDV (₹)', 'IDV (Rs)', 'IDV', 'Insured Declared Value'])
const frequencyValue = row => col(row, [
  'Frequency', 'Premium Frequency', 'Payment Frequency',
  'Payment Mode', 'Premium Mode', 'Mode', 'Renewal Frequency',
  'Installment Frequency', 'Instalment Frequency'
])

// ── Column definitions (for export tables) ───────────────────
export const CLIENT_COLS = [
  { header: 'Name',       accessor: r => r.name },
  { header: 'Mobile',     accessor: r => r.mobile },
  { header: 'Email',      accessor: r => r.email },
  { header: 'PAN',        accessor: r => r.pan },
  { header: 'Aadhar',     accessor: r => r.aadhar },
  { header: 'Occupation', accessor: r => r.occupation },
  { header: 'Address',    accessor: r => r.address },
  { header: 'KYC Status', accessor: r => r.kycStatus || 'Pending' },
]

export const POLICY_COLS = [
  { header: 'Policy No',       accessor: r => r.policyNumber },
  { header: 'Client',          accessor: r => r.clientName },
  { header: 'Type',            accessor: r => r.policyType },
  { header: 'Insurer',         accessor: r => r.insurer },
  { header: 'Plan',            accessor: r => r.planName },
  { header: 'Premium',         accessor: r => r.premium },
  { header: 'Start Date',      accessor: r => fmtDate(r.startDate) },
  { header: 'Policy End Date', accessor: r => fmtDate(r.expiryDate) },
  { header: 'Premium Due Date', accessor: r => fmtDate(r.nextPremiumDue) },
  { header: 'Status',          accessor: r => r.status || 'Active' },
  { header: 'Frequency',       accessor: r => r.frequency },
  { header: 'FY Commission %', accessor: r => r.fyCommission || '' },
  { header: 'RY Commission %', accessor: r => r.ryCommission || '' },
]

// ── CLIENT import template ────────────────────────────────────
export const CLIENT_IMPORT_HEADERS = [
  'Name', 'Mobile', 'Email', 'PAN', 'Aadhar',
  'Date of Birth', 'Occupation', 'Address', 'KYC Status'
]
export const CLIENT_IMPORT_SAMPLE = [
  'Ramesh Shah', '9876543210', 'ramesh@email.com',
  'ABCDE1234F', '123456789012', '15/06/1980',
  'Businessman', '12 MG Road, Bhavnagar', 'Complete'
]

// ─────────────────────────────────────────────────────────────
// HEALTH IMPORT
// ─────────────────────────────────────────────────────────────
export const HEALTH_IMPORT_HEADERS = [
  // Base
  'Policy Number', 'Client Name', 'Client Mobile', 'Client Email', 'Insurer', 'Plan Name',
  'Premium', 'Frequency', 'Start Date', 'Policy End Date', 'Premium Due Date', 'Status',
  // Health-specific
  'Sum Insured',
  'Nominee Name', 'Nominee Relation',
  'FY Commission %', 'RY Commission %',
  // Members
  'Member 1 Name', 'Member 1 Age', 'Member 1 Relation', 'Member 1 PED',
  'Member 2 Name', 'Member 2 Age', 'Member 2 Relation', 'Member 2 PED',
  'Member 3 Name', 'Member 3 Age', 'Member 3 Relation', 'Member 3 PED',
  'Member 4 Name', 'Member 4 Age', 'Member 4 Relation', 'Member 4 PED',
  'Notes',
]

export const HEALTH_IMPORT_SAMPLE = [
  'ICL-H-2024-001', 'Ramesh Shah', '9876543210', 'ramesh@email.com', 'ICICI Lombard', 'Health Shield Gold',
  '18500', 'Yearly', '01/04/2024', '31/03/2025', '31/03/2025', 'Active',
  '500000',
  'Sunita Shah', 'Spouse',
  '15', '7.5',
  'Ramesh Shah',  '45', 'Self',    'Diabetes',
  'Sunita Shah',  '41', 'Spouse',  '',
  'Arjun Shah',   '16', 'Son',     '',
  'Priya Shah',   '12', 'Daughter','',
  'First year policy',
]

/**
 * parseHealthRow(row) → policy object ready for addPolicy()
 */
export function parseHealthRow(r) {
  const clientMobile = str(r['Client Mobile'])
  const members = []
  for (let i = 1; i <= 4; i++) {
    const name = str(r[`Member ${i} Name`])
    if (name) members.push({
      name,
      age:          str(r[`Member ${i} Age`]),
      relationship: str(r[`Member ${i} Relation`]) || 'Other',
      ped:          str(r[`Member ${i} PED`]),
      dob:          '',
    })
  }
  return {
    policyType:      'Health',
    policyNumber:    str(r['Policy Number']),
    clientName:      str(r['Client Name']),
    clientMobile:    str(r['Client Mobile']),
    clientEmail:     str(r['Client Email']),
    insurer:         str(r['Insurer']),
    planName:        str(r['Plan Name']),
    premium:         num(premiumValue(r)),
    frequency:       normaliseFrequency(str(frequencyValue(r))) || 'Yearly',
    startDate:       normaliseDate(r['Start Date']),
    expiryDate:      normaliseDate(r['Policy End Date'] || r['Expiry Date']),
    nextPremiumDue:  normaliseDate(r['Premium Due Date'] || r['Renewal Date']),
    status:          str(r['Status']) || 'Active',
    sumInsured:      num(sumInsuredValue(r)),
    nominee:         str(r['Nominee Name']),
    nomineeRelation: str(r['Nominee Relation']),
    fyCommission:    num(r['FY Commission %']),
    ryCommission:    num(r['RY Commission %']),
    members,
    notes:           str(r['Notes']),
  }
}

// ─────────────────────────────────────────────────────────────
// LIFE IMPORT
// ─────────────────────────────────────────────────────────────
export const LIFE_IMPORT_HEADERS = [
  // Base
  'Policy Number', 'Client Name', 'Client Mobile', 'Client Email', 'Insurer', 'Plan Name',
  'Premium', 'Frequency', 'Start Date', 'Policy End Date', 'Premium Due Date', 'Status',
  // Life-specific
  'Sum Assured', 'Policy Sub-type',
  'PPT (years)', 'Policy Term (years)', 'Maturity Date',
  'Nominee Name', 'Nominee Relation',
  'FY Commission %', 'RY Commission %',
  'Notes',
]

export const LIFE_IMPORT_SAMPLE = [
  'LIC-T-2024-001', 'Ramesh Shah', '9876543210', 'ramesh@email.com', 'LIC of India', 'Tech Term',
  '12000', 'Yearly', '01/04/2024', '31/03/2054', '31/03/2025', 'Active',
  '10000000', 'Term',
  '30', '30', '31/03/2054',
  'Sunita Shah', 'Spouse',
  '35', '5',
  'Critical illness rider active',
]

/**
 * parseLifeRow(row) → policy object ready for addPolicy()
 */
export function parseLifeRow(r) {
  return {
    policyType:      'Life',
    policyNumber:    str(r['Policy Number']),
    clientName:      str(r['Client Name']),
    clientMobile:    str(r['Client Mobile']),
    clientEmail:     str(r['Client Email']),
    insurer:         str(r['Insurer']),
    planName:        str(r['Plan Name']),
    premium:         num(premiumValue(r)),
    frequency:       normaliseFrequency(str(frequencyValue(r))) || 'Yearly',
    startDate:       normaliseDate(r['Start Date']),
    expiryDate:      normaliseDate(r['Policy End Date'] || r['Expiry Date'] || r['Maturity Date']),
    nextPremiumDue:  normaliseDate(r['Premium Due Date'] || r['Renewal Date']),
    status:          str(r['Status']) || 'Active',
    sumAssured:      num(sumAssuredValue(r)),
    policySubType:   str(r['Policy Sub-type']) || 'Term',
    ppt:             num(r['PPT (years)']),
    policyTerm:      num(r['Policy Term (years)']),
    maturityDate:    normaliseDate(r['Maturity Date']),
    nominee:         str(r['Nominee Name']),
    nomineeRelation: str(r['Nominee Relation']),
    fyCommission:    num(r['FY Commission %']),
    ryCommission:    num(r['RY Commission %']),
    notes:           str(r['Notes']),
  }
}

// ─────────────────────────────────────────────────────────────
// MOTOR IMPORT
// ─────────────────────────────────────────────────────────────
export const MOTOR_IMPORT_HEADERS = [
  // Base
  'Policy Number', 'Client Name', 'Client Mobile', 'Client Email', 'Insurer', 'Plan Name',
  'Premium', 'Frequency', 'Start Date', 'Policy End Date', 'Premium Due Date', 'Status',
  // Motor-specific
  'Vehicle Type', 'Registration No', 'IDV', 'NCB %',
  'Nominee Name', 'Nominee Relation',
  'FY Commission %', 'RY Commission %',
  'Notes',
]

export const MOTOR_IMPORT_SAMPLE = [
  'HDFC-M-2024-001', 'Ramesh Shah', '9876543210', 'ramesh@email.com', 'HDFC ERGO', 'Comprehensive Motor',
  '8500', 'Yearly', '01/04/2024', '31/03/2025', '31/03/2025', 'Active',
  '4W', 'GJ-03-AA-1234', '650000', '20',
  'Sunita Shah', 'Spouse',
  '15', '5',
  'Zero dep add-on included',
]

/**
 * parseMotorRow(row) → policy object ready for addPolicy()
 */
export function parseMotorRow(r) {
  return {
    policyType:      'Motor',
    policyNumber:    str(r['Policy Number']),
    clientName:      str(r['Client Name']),
    clientMobile:    str(r['Client Mobile']),
    clientEmail:     str(r['Client Email']),
    insurer:         str(r['Insurer']),
    planName:        str(r['Plan Name']),
    premium:         num(premiumValue(r)),
    frequency:       normaliseFrequency(str(frequencyValue(r))) || 'Yearly',
    startDate:       normaliseDate(r['Start Date']),
    expiryDate:      normaliseDate(r['Policy End Date'] || r['Expiry Date']),
    nextPremiumDue:  normaliseDate(r['Premium Due Date'] || r['Renewal Date']),
    status:          str(r['Status']) || 'Active',
    vehicleType:     str(r['Vehicle Type']) || '4W',
    registrationNo:  str(r['Registration No']),
    idv:             num(idvValue(r)),
    ncbPct:          str(r['NCB %']) || '0',
    nominee:         str(r['Nominee Name']),
    nomineeRelation: str(r['Nominee Relation']),
    fyCommission:    num(r['FY Commission %']),
    ryCommission:    num(r['RY Commission %']),
    notes:           str(r['Notes']),
  }
}

// ─────────────────────────────────────────────────────────────
// Legacy generic import (kept for backwards compatibility)
// ─────────────────────────────────────────────────────────────
export const POLICY_IMPORT_HEADERS = HEALTH_IMPORT_HEADERS
export const POLICY_IMPORT_SAMPLE  = HEALTH_IMPORT_SAMPLE
