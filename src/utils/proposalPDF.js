// src/utils/proposalPDF.js
// ─────────────────────────────────────────────────────────────
// Generates a professional Insurance Sales Proposal PDF
// using jsPDF + autoTable.
// ─────────────────────────────────────────────────────────────
import jsPDF     from 'jspdf'
import autoTable from 'jspdf-autotable'
import { format } from 'date-fns'
import { fmtDate } from './dateUtils'

const BRAND = [30, 64, 175]   // blue-800
const LIGHT = [239, 246, 255] // blue-50

// FIX #5: parseInt("10,000") → NaN → "₹NaN". Use parseFloat with fallback instead.
const safeCurrency = (val) => {
  const n = parseFloat(String(val || '').replace(/,/g, ''))
  return isNaN(n) ? '—' : `Rs. ${n.toLocaleString('en-IN')}`
}

export function generateProposalPDF(form) {
  const doc  = new jsPDF({ unit: 'mm', format: 'a4' })
  const W    = doc.internal.pageSize.getWidth()
  const ts   = format(new Date(), 'dd/MM/yyyy HH:mm')

  // ── Header band ────────────────────────────────────────────
  doc.setFillColor(...BRAND)
  doc.rect(0, 0, W, 28, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16); doc.setFont(undefined, 'bold')
  doc.text('GOHIL INVESTMENTS', 14, 11)
  doc.setFontSize(9);  doc.setFont(undefined, 'normal')
  doc.text('Wealth Management & Insurance Advisory  |  Bhavnagar, Gujarat', 14, 17)
  doc.text('Ph: 7698997894', 14, 23)

  // Proposal title
  doc.setFillColor(248, 250, 252)
  doc.rect(0, 28, W, 12, 'F')
  doc.setTextColor(...BRAND)
  doc.setFontSize(13); doc.setFont(undefined, 'bold')
  doc.text(`INSURANCE SALES PROPOSAL — ${(form.policyType || 'HEALTH').toUpperCase()}`, W / 2, 36, { align: 'center' })

  doc.setFontSize(8); doc.setTextColor(120); doc.setFont(undefined, 'normal')
  doc.text(`Date: ${ts}  |  Valid for 30 days`, W / 2, 44, { align: 'center' })

  let y = 50

  const sectionTitle = (title) => {
    doc.setFillColor(...BRAND)
    doc.rect(14, y, W - 28, 7, 'F')
    doc.setTextColor(255)
    doc.setFontSize(9); doc.setFont(undefined, 'bold')
    doc.text(`  ${title}`, 14, y + 5)
    y += 10
  }

  const kvTable = (rows) => {
    autoTable(doc, {
      startY: y,
      body: rows.map(([k, v]) => [k, v || '—']),
      styles: { fontSize: 9, cellPadding: 2.5 },
      columnStyles: {
        0: { fontStyle: 'bold', fillColor: LIGHT, cellWidth: 55 },
        1: { fillColor: [255, 255, 255] }
      },
      theme: 'grid',
      margin: { left: 14, right: 14 },
    })
    y = doc.lastAutoTable.finalY + 5
  }

  // ── Section 1: Client / KYC ──────────────────────────────────
  sectionTitle('1.  Client / KYC Details')
  kvTable([
    ['Proposer Name', form.proposerName],
    ['Date of Birth',  fmtDate(form.dob)],
    ['Mobile',         form.mobile],
    ['Email',          form.email],
    ['PAN',            form.pan],
    ['Aadhar',         form.aadhar],
    ['Address',        form.address],
    ['Occupation',     form.occupation],
    ['Annual Income',  safeCurrency(form.income)],
    ['Employment',     form.employment],
    ['Qualification',  form.qualification],
    ['Designation',    form.designation],
  ])

  // ── Section 2: Plan Summary ───────────────────────────────────
  sectionTitle('2.  Plan Summary')
  kvTable([
    ['Policy Type',         form.policyType],
    ['Insurance Company',   form.insurer],
    ['Plan Name',           form.planName],
    ['Sum Insured/Assured', safeCurrency(form.sumAssured)],
    ['Annual Premium',      safeCurrency(form.premium)],
    ['Payment Frequency',   form.frequency || 'Yearly'],
  ])

  // ── Section 3: Policy-Specific Details ────────────────────────
  if (form.policyType === 'Health') {
    sectionTitle('3.  Health-Specific Details')
    kvTable([
      ['Plan Type',          form.planType],
      ['Past Operation',     form.pastOperation],
      ['Existing Illness',   form.existingIllness],
      ['Bank Name',          form.bankName],
      ['Account Number',     form.bankAccount],
      ['IFSC Code',          form.ifsc],
    ])
    // Family members table
    if (form.members?.length > 0) {
      autoTable(doc, {
        startY: y,
        head: [['Member Name', 'Height(cm)', 'Weight(kg)', 'Birth Date', 'Diseases']],
        body: form.members.filter(m => m.name).map(m => [
          m.name, m.height, m.weight, fmtDate(m.dob), m.diseases || 'Nil'
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: BRAND, textColor: 255 },
        margin: { left: 14, right: 14 },
      })
      y = doc.lastAutoTable.finalY + 5
    }
  } else if (form.policyType === 'Life') {
    sectionTitle('3.  Life-Specific Details')
    kvTable([
      ['Sum Assured',       safeCurrency(form.sumAssured)],
      ['Policy Term',       form.policyTerm],
      ['Plan Type',         form.planType],
      ['Nominee Name',      form.nomineeName],
      ['Nominee Relation',  form.nomineeRelation],
      ['Nominee PAN/Aadhar',form.nomineePan],
      ['Height (cm)',        form.height],
      ['Weight (kg)',        form.weight],
      ['Mother\'s Name',    form.motherName],
      ['Family Illness',    form.familyIllness],
    ])
  }

  // ── Section 4: Documents Required ────────────────────────────
  sectionTitle('4.  Documents Required')
  const healthDocs = `1. Aadhar Card (all members)\n2. PAN Card\n3. Passport Photo\n4. Height & Weight\n5. Bank Details\n6. Income Proof`
  const lifeDocs   = `1. Aadhar Card\n2. PAN Card\n3. Passport Photo\n4. Income Proof\n5. Medical Reports (if any)`
  const docs = form.policyType === 'Life' ? lifeDocs : healthDocs
  doc.setFontSize(9); doc.setTextColor(40)
  doc.text(docs, 16, y + 2)
  y += docs.split('\n').length * 5 + 8

  // ── Footer ────────────────────────────────────────────────────
  doc.setFontSize(8); doc.setTextColor(100)
  const footerY = doc.internal.pageSize.getHeight() - 10
  doc.line(14, footerY - 4, W - 14, footerY - 4)
  doc.text(`Authorized Signatory: Harshdipsinh Gohil  |  7698997894  |  Generated: ${ts}`,
           W / 2, footerY, { align: 'center' })

  doc.save(`Proposal_${form.proposerName?.replace(/\s/g,'_') || 'Client'}_${format(new Date(),'yyyyMMdd')}.pdf`)
}
