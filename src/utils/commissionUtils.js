import * as XLSX from 'xlsx'

const HEADER_ALIASES = {
  clientName: ['client', 'client name', 'customer', 'customer name', 'insured', 'insured name', 'policy holder', 'policyholder', 'proposer name'],
  policyNumber: ['policy number', 'policy no', 'policy no.', 'policy', 'certificate number'],
  proposalNumber: ['proposal number', 'proposal no', 'application number'],
  planName: ['plan name', 'policy name', 'product', 'product name', 'scheme'],
  insurer: ['insurer', 'insurance company', 'company', 'carrier'],
  category: ['category', 'policy type', 'insurance type', 'lob', 'line of business'],
  premium: ['premium', 'net premium', 'gross premium', 'premium amount'],
  commission: ['commission', 'gross commission', 'brokerage', 'commission amount'],
  commissionRate: ['commission rate', 'commission %', 'commission percentage', 'brokerage %', 'rate'],
  reward: ['reward', 'bonus', 'incentive', 'reward commission'],
  gst: ['gst', 'gst amount'],
  tds: ['tds', 'tax deducted'],
  deduction: ['deduction', 'other deduction', 'adjustment'],
  netCommission: ['net paid', 'net amount', 'net commission', 'net brokerage'],
  commissionDate: ['commission date', 'payout date', 'payment date', 'date'],
  policyDate: ['policy date', 'start date', 'risk start date', 'renewal date'],
  mobile: ['mobile', 'mobile number', 'phone', 'contact number'],
  email: ['email', 'email id'],
  pan: ['pan', 'pan number'],
  agentCode: ['agent code', 'advisor code', 'posp code', 'broker code'],
  remarks: ['remarks', 'remark', 'notes', 'description'],
}

const AGENT_WORDS = ['agent name', 'advisor name', 'adviser name', 'broker name', 'sub broker', 'sales manager', 'relationship manager']

export const cleanCommissionText = value => String(value ?? '').trim()
export const normaliseCommissionKey = value => cleanCommissionText(value).toLowerCase().replace(/[^a-z0-9]/g, '')
export const normalisePolicyNumber = value => normaliseCommissionKey(value)
export const normalisePersonName = value => cleanCommissionText(value)
  .toLowerCase()
  .replace(/\b(mr|mrs|ms|miss|shri|smt|dr|late)\b/g, ' ')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

export function commissionNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const negative = /^\s*\(.*\)\s*$/.test(String(value || ''))
  const parsed = Number(String(value ?? '').replace(/[₹$,%\s,()]/g, ''))
  if (!Number.isFinite(parsed)) return 0
  return negative ? -parsed : parsed
}

function headerMatches(header, alias) {
  const key = normaliseCommissionKey(header)
  const wanted = normaliseCommissionKey(alias)
  return key === wanted || (wanted.length > 5 && key.includes(wanted))
}

function isAgentHeader(header) {
  const text = cleanCommissionText(header).toLowerCase()
  return AGENT_WORDS.some(word => text.includes(word))
}

function valueFor(row, aliases, { ignoreAgent = false } = {}) {
  const entry = Object.entries(row || {}).find(([header]) =>
    aliases.some(alias => headerMatches(header, alias)) && (!ignoreAgent || !isAgentHeader(header)))
  return entry?.[1] ?? ''
}

export function normaliseCommissionRow(source, context = {}) {
  const mapped = field => {
    const header = context.fieldMap?.[field]
    return header && Object.prototype.hasOwnProperty.call(source || {}, header) ? source[header] : undefined
  }
  const read = (field, options) => mapped(field) ?? valueFor(source, HEADER_ALIASES[field], options)
  const row = {
    uploadedClientName: cleanCommissionText(read('clientName', { ignoreAgent: true })),
    uploadedPolicyNumber: cleanCommissionText(read('policyNumber')),
    uploadedProposalNumber: cleanCommissionText(read('proposalNumber')),
    uploadedPlanName: cleanCommissionText(read('planName')),
    uploadedInsurer: cleanCommissionText(read('insurer')) || context.insurer || '',
    uploadedCategory: cleanCommissionText(read('category')),
    uploadedPremium: commissionNumber(read('premium')),
    uploadedCommission: commissionNumber(read('commission')),
    commissionRate: commissionNumber(read('commissionRate')),
    rewardCommission: commissionNumber(read('reward')),
    gst: commissionNumber(read('gst')),
    tds: commissionNumber(read('tds')),
    deduction: commissionNumber(read('deduction')),
    netPaid: commissionNumber(read('netCommission')),
    commissionDate: cleanCommissionText(read('commissionDate')),
    policyDate: cleanCommissionText(read('policyDate')),
    uploadedMobile: cleanCommissionText(read('mobile')),
    uploadedEmail: cleanCommissionText(read('email')).toLowerCase(),
    uploadedPan: cleanCommissionText(read('pan')).toUpperCase(),
    agentCode: cleanCommissionText(read('agentCode')),
    remarks: cleanCommissionText(read('remarks')),
    sourceSheet: context.sourceSheet || '',
    sourceRowNumber: Number(context.sourceRowNumber || 0),
    statementMonth: context.statementMonth || '',
  }
  const calculated = calculateCommission(row)
  return { ...row, ...calculated, sourceData: source }
}

export function calculateCommission(row) {
  const premium = Math.max(0, commissionNumber(row.uploadedPremium ?? row.premium))
  const rate = Math.max(0, commissionNumber(row.commissionRate))
  const direct = commissionNumber(row.uploadedCommission ?? row.grossCommission)
  const grossCommission = direct || (premium && rate ? (premium * rate) / 100 : 0)
  const rewardCommission = commissionNumber(row.rewardCommission)
  const gst = commissionNumber(row.gst)
  const tds = commissionNumber(row.tds)
  const deduction = commissionNumber(row.deduction)
  const computedNet = grossCommission + rewardCommission + gst - tds - deduction
  const suppliedNet = commissionNumber(row.netPaid ?? row.netReceived)
  return {
    grossCommission: roundMoney(grossCommission),
    rewardCommission: roundMoney(rewardCommission),
    gst: roundMoney(gst),
    tds: roundMoney(tds),
    deduction: roundMoney(deduction),
    netPaid: roundMoney(suppliedNet || computedNet),
    calculationNeedsReview: !suppliedNet && !direct && !(premium && rate),
  }
}

const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100

function nameSimilarity(a, b) {
  const left = new Set(normalisePersonName(a).split(' ').filter(Boolean))
  const right = new Set(normalisePersonName(b).split(' ').filter(Boolean))
  if (!left.size || !right.size) return 0
  const common = [...left].filter(token => right.has(token)).length
  return (2 * common) / (left.size + right.size)
}

function sameLoose(a, b) {
  const x = normaliseCommissionKey(a)
  const y = normaliseCommissionKey(b)
  return Boolean(x && y && (x === y || x.includes(y) || y.includes(x)))
}

export function scoreCommissionMatch(row, policy, client = null) {
  let score = 0
  const reasons = []
  const conflicts = []
  const exactPolicy = normalisePolicyNumber(row.uploadedPolicyNumber) && normalisePolicyNumber(row.uploadedPolicyNumber) === normalisePolicyNumber(policy.policyNumber)
  if (exactPolicy) { score += 58; reasons.push('exact policy number') }

  if (row.uploadedInsurer) {
    if (sameLoose(row.uploadedInsurer, policy.insurer)) { score += 14; reasons.push('insurer') }
    else if (exactPolicy) conflicts.push('insurer differs')
  }
  if (row.uploadedPlanName) {
    if (sameLoose(row.uploadedPlanName, policy.planName)) { score += 10; reasons.push('plan') }
    else if (exactPolicy) conflicts.push('plan differs')
  }
  const nameScore = nameSimilarity(row.uploadedClientName, policy.clientName || client?.name)
  if (nameScore >= 0.99) { score += 12; reasons.push('client name') }
  else if (nameScore >= 0.6) { score += 7; reasons.push('similar client name') }
  else if (row.uploadedClientName && exactPolicy) conflicts.push('client differs')

  const importedPremium = commissionNumber(row.uploadedPremium)
  const policyPremium = commissionNumber(policy.premium)
  if (importedPremium && policyPremium) {
    const delta = Math.abs(importedPremium - policyPremium)
    if (delta <= Math.max(5, importedPremium * 0.01)) { score += 6; reasons.push('premium') }
    else if (exactPolicy) conflicts.push('premium differs')
  }

  const cleanPhone = value => cleanCommissionText(value).replace(/\D/g, '').slice(-10)
  if (row.uploadedMobile && cleanPhone(row.uploadedMobile) === cleanPhone(client?.mobile)) { score += 8; reasons.push('mobile') }
  if (row.uploadedEmail && row.uploadedEmail === cleanCommissionText(client?.email).toLowerCase()) { score += 8; reasons.push('email') }
  if (row.uploadedPan && row.uploadedPan === cleanCommissionText(client?.pan).toUpperCase()) { score += 10; reasons.push('PAN') }

  score = Math.min(100, score)
  if (conflicts.length) score = Math.min(score, 79)
  return {
    policy,
    score,
    reason: reasons.length ? `Matched on ${reasons.join(' + ')}` : 'No reliable identity match',
    conflicts,
    autoConfirmable: score >= 90 && conflicts.length === 0 && exactPolicy,
  }
}

export function bestCommissionMatches(row, policies, clients = []) {
  const byClientId = new Map(clients.map(client => [client.id, client]))
  return policies
    .map(policy => scoreCommissionMatch(row, policy, byClientId.get(policy.clientId)))
    .filter(match => match.score >= 30)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}

export async function sha256(value) {
  const bytes = value instanceof ArrayBuffer ? value : new TextEncoder().encode(String(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function hashCommissionFile(file) {
  return sha256(await file.arrayBuffer())
}

export async function hashCommissionRow(row) {
  return sha256([
    normalisePolicyNumber(row.uploadedPolicyNumber),
    normaliseCommissionKey(row.uploadedInsurer),
    normalisePersonName(row.uploadedClientName),
    normaliseCommissionKey(row.uploadedPlanName),
    commissionNumber(row.uploadedCommission),
    commissionNumber(row.netPaid),
    row.commissionDate || row.statementMonth || '',
  ].join('|'))
}

function bestHeaderIndex(matrix) {
  let best = { index: 0, score: -1 }
  matrix.slice(0, 25).forEach((cells, index) => {
    const score = cells.reduce((sum, cell) => sum + Object.values(HEADER_ALIASES).some(aliases => aliases.some(alias => headerMatches(cell, alias))) * 1, 0)
    if (score > best.score) best = { index, score }
  })
  return best
}

function rowsFromMatrix(matrix, sourceSheet) {
  if (!matrix.length) return []
  const { index: headerIndex, score } = bestHeaderIndex(matrix)
  if (score < 2) return []
  const headers = matrix[headerIndex].map((header, index) => cleanCommissionText(header) || `Column ${index + 1}`)
  return matrix.slice(headerIndex + 1).map((cells, offset) => ({
    source: Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])),
    sourceSheet,
    sourceRowNumber: headerIndex + offset + 2,
  })).filter(item => Object.values(item.source).some(value => cleanCommissionText(value)))
}

async function parseWorkbook(file) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  return workbook.SheetNames.flatMap(sourceSheet => {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sourceSheet], { header: 1, defval: '', raw: false })
    return rowsFromMatrix(matrix, sourceSheet)
  })
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`)
    if (existing) { existing.addEventListener('load', resolve, { once: true }); resolve(); return }
    const script = document.createElement('script')
    script.src = src
    script.onload = resolve
    script.onerror = () => reject(new Error('OCR engine could not be loaded. Check internet and retry.'))
    document.head.appendChild(script)
  })
}

async function parsePdfWithOpenSourceEngines(file, onProgress) {
  onProgress?.('Loading PDF reader...')
  const pdfModuleUrl = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs'
  const pdfjs = await import(/* @vite-ignore */ pdfModuleUrl)
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const lines = []
  const tableRows = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress?.(`Reading PDF page ${pageNumber}/${pdf.numPages}...`)
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const grouped = new Map()
    content.items.forEach(item => {
      const y = Math.round(Number(item.transform?.[5] || 0) / 3) * 3
      if (!grouped.has(y)) grouped.set(y, [])
      grouped.get(y).push(item)
    })
    const matrix = [...grouped.entries()].sort((a, b) => b[0] - a[0]).map(([, items]) => {
      const ordered = items.sort((a, b) => Number(a.transform?.[4] || 0) - Number(b.transform?.[4] || 0))
      const cells = []
      let current = ''
      let previousEnd = null
      ordered.forEach(item => {
        const x = Number(item.transform?.[4] || 0)
        const gap = previousEnd === null ? 0 : x - previousEnd
        if (current && gap > 18) { cells.push(current.trim()); current = '' }
        current += `${current ? ' ' : ''}${item.str}`
        previousEnd = x + Number(item.width || 0)
      })
      if (current.trim()) cells.push(current.trim())
      return cells
    }).filter(cells => cells.some(Boolean))
    lines.push(...matrix.map(cells => cells.join(' | ')))
    tableRows.push(...rowsFromMatrix(matrix, `PDF page ${pageNumber}`))
  }
  if (tableRows.length) return { text: lines.join('\n'), rows: tableRows }
  if (lines.length) return { text: lines.join('\n'), rows: [] }

  onProgress?.('No text found. Running local OCR...')
  await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js')
  const ocrLines = []
  for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 20); pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1.6 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    const result = await window.Tesseract.recognize(canvas, 'eng', {
      logger: message => message.status === 'recognizing text' && onProgress?.(`OCR page ${pageNumber}: ${Math.round((message.progress || 0) * 100)}%`),
    })
    ocrLines.push(result.data.text)
  }
  const ocrMatrix = ocrLines.join('\n').split(/\r?\n/).map(line => line.trim().split(/\s{2,}|\t|\|/).filter(Boolean)).filter(cells => cells.length)
  return { text: ocrLines.join('\n'), rows: rowsFromMatrix(ocrMatrix, 'OCR') }
}

export async function parseCommissionFile(file, context = {}, onProgress) {
  const lowerName = file.name.toLowerCase()
  if (/\.(csv|xlsx?|xls)$/.test(lowerName)) {
    onProgress?.('Reading workbook sheets...')
    const rawRows = await parseWorkbook(file)
    return {
      rows: rawRows.map(item => normaliseCommissionRow(item.source, { ...context, sourceSheet: item.sourceSheet, sourceRowNumber: item.sourceRowNumber })),
      extractedText: '',
      parser: 'sheetjs',
    }
  }
  if (/\.pdf$/.test(lowerName)) {
    const parsed = await parsePdfWithOpenSourceEngines(file, onProgress)
    return {
      rows: parsed.rows.map(item => normaliseCommissionRow(item.source, { ...context, sourceSheet: item.sourceSheet, sourceRowNumber: item.sourceRowNumber })),
      extractedText: parsed.text,
      parser: 'pdfjs+tesseract',
    }
  }
  throw new Error('Use a PDF, CSV, XLS, or XLSX commission statement.')
}

export function validateCommissionRow(row) {
  const errors = []
  for (const [label, value] of [
    ['Premium', row.uploadedPremium], ['Commission', row.uploadedCommission], ['Rate', row.commissionRate],
    ['Reward', row.rewardCommission], ['GST', row.gst], ['TDS', row.tds], ['Deduction', row.deduction], ['Net commission', row.netPaid],
  ]) {
    const number = Number(value || 0)
    if (!Number.isFinite(number)) errors.push(`${label} must be a number`)
    if (number < 0) errors.push(`${label} cannot be negative`)
    if (number > 1_000_000_000) errors.push(`${label} is above the allowed limit`)
  }
  if (Number(row.commissionRate || 0) > 100) errors.push('Commission rate cannot exceed 100%')
  if (!row.uploadedPolicyNumber && !row.uploadedClientName) errors.push('Policy number or client name is required')
  return errors
}
