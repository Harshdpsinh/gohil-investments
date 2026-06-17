// src/pages/RenewalsPage.jsx
// ✅ FIXED: R1 renewal creates new policy, R2 overdue filter, R3 WA date,
//           R4 status colors, R5 button reset, R6 all tabs, R7 premium col,
//           R8 PDF autoTable, R9 insurer col, R10 confirm dialog

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { usePolicies }  from '../hooks/usePolicies'
import { useClients }   from '../hooks/useClients'
import { useAuth }      from '../hooks/useAuth'
import {
  saveRenewal,        // atomic batch: marks old as Renewed-Out AND creates new policy
  markPremiumPaid,
} from '../firebase/firestore'
import { deletePolicyPdfAsset, uploadPolicyPdf } from '../firebase/storage'
import { addFrequencyInterval, addPolicyCoverageInterval, fmtDate, fmtCurrency, normaliseFrequency, parseAnyDate, toInputDate, daysUntilPolicyDue, getDueDate as getPolicyDueDate } from '../utils/dateUtils'
import { openWhatsAppLink } from '../services/whatsappService'
import SearchBar from '../components/ui/SearchBar'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import DateInput from '../components/ui/DateInput'
import toast from 'react-hot-toast'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'   // ✅ FIX R8: proper PDF table

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────

// getDays(p)    → daysUntilPolicyDue(p) from dateUtils
// getDueDate(p) → getPolicyDueDate(p) from dateUtils
// Both use parseAnyDate internally — handles malformed date strings from imports.

// ✅ FIX R4: status with label + Tailwind color classes
function getStatusInfo(days) {
  if (days === null)  return { label: 'Unknown',  cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' }
  if (days < 0)       return { label: 'Overdue',   cls: 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300' }
  if (days === 0)     return { label: 'Due Today', cls: 'bg-red-600 text-white' }
  if (days <= 7)      return { label: 'Critical',  cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-orange-300' }
  if (days <= 15)     return { label: 'Warning',   cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/60 dark:text-yellow-200' }
  return               { label: 'Active',    cls: 'bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300' }
}

function renewalErrorMessage(error) {
  const message = error?.message || ''
  if (message.includes('already been renewed') || message.includes('already exists')) return message
  if (message.includes('permission-denied')) return 'You do not have permission to renew policies. Please contact an admin.'
  if (message.includes('unavailable') || message.includes('network')) return 'Network problem while saving renewal. Please check your connection and try again.'
  if (message.includes('date')) return message
  return 'Renewal could not be saved. Please refresh and try again.'
}

function isTermRenewalDue(policy) {
  if (String(policy?.policyType || '').trim().toLowerCase() === 'life') return false
  const due = parseAnyDate(getPolicyDueDate(policy))
  const expiry = parseAnyDate(policy?.expiryDate)
  if (!due || !expiry) return true
  return due >= expiry
}

// ─────────────────────────────────────────────────────────────
// RENEW MODAL — collects new policy details before creating
// ─────────────────────────────────────────────────────────────
// Full Indian insurer list reused in RenewModal
const RENEW_INSURERS = [
  'Star Health and Allied Insurance','New India Assurance','National Insurance',
  'United India Insurance','Oriental Insurance','HDFC ERGO General Insurance',
  'ICICI Lombard General Insurance','Bajaj Allianz General Insurance',
  'Reliance General Insurance','Royal Sundaram General Insurance',
  'Niva Bupa Health Insurance','Aditya Birla Health Insurance',
  'Care Health Insurance','ManipalCigna Health Insurance',
  'SBI General Insurance','Tata AIG General Insurance',
  'Cholamandalam MS General Insurance','Future Generali India Insurance',
  'Iffco Tokio General Insurance','Kotak Mahindra General Insurance',
  'Liberty General Insurance','Universal Sompo General Insurance',
  'LIC of India','HDFC Life Insurance','ICICI Prudential Life Insurance',
  'SBI Life Insurance','Max Life Insurance','Bajaj Allianz Life Insurance',
  'Tata AIA Life Insurance','Canara HSBC Life Insurance',
  'PNB MetLife India Insurance','IndiaFirst Life Insurance',
]

function RenewModal({ policy, onConfirm, onClose }) {
  const originalFrequency = normaliseFrequency(policy.frequency || 'Yearly')
  const originalCoverageTermYears = Number(policy.coverageTermYears || 1)
  const isLifePolicy = String(policy.policyType || '').trim().toLowerCase() === 'life'
  const oldExpiry = getPolicyDueDate(policy) || ''
  const defaultStart = oldExpiry
    ? toInputDate(new Date(new Date(oldExpiry).getTime() + 86400000))
    : toInputDate(new Date())
  const defaultCoverageTermYears = !isLifePolicy && originalCoverageTermYears > 1 ? originalCoverageTermYears : 1
  const defaultExpiry = defaultStart
    ? toInputDate(defaultCoverageTermYears > 1
      ? addPolicyCoverageInterval(defaultStart, { coverageTermYears: defaultCoverageTermYears })
      : addFrequencyInterval(defaultStart, originalFrequency))
    : ''

  // ── "Same company" or "Switch company" — explicit toggle ──
  const [companySame, setCompanySame] = useState(true)

  const [form, setForm] = useState({
    policyNumber: '',
    insurer:      policy.insurer || '',
    planName:     policy.planName || '',
    premium:      policy.premium || '',
    frequency:    originalFrequency,
    coverageTermYears: defaultCoverageTermYears,
    isMultiYearPolicy: defaultCoverageTermYears > 1,
    startDate:    defaultStart,
    expiryDate:   defaultExpiry,
    fyCommission: policy.fyCommission || '',
    ryCommission: policy.ryCommission || '',
    notes:        '',
  })
  const [saving, setSaving] = useState(false)
  const pdfRef = useRef()
  const [pdfUploading, setPdfUploading] = useState(false)
  const [pdfProgress, setPdfProgress] = useState(null)
  const [pdfMeta, setPdfMeta] = useState({
    policyPdfUrl: '',
    policyPdfName: '',
    policyPdfYear: '',
    policyPdfStoragePath: '',
    policyPdfStorageBucket: '',
    policyPdfStorageProvider: '',
    policyPdfPublicId: '',
    policyPdfResourceType: '',
    policyPdfDeleteToken: '',
  })
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const recalcExpiry = (startDate, frequency, coverageTermYears = 1) =>
    toInputDate(Number(coverageTermYears) > 1
      ? addPolicyCoverageInterval(startDate, { coverageTermYears })
      : addFrequencyInterval(startDate, normaliseFrequency(frequency || 'Yearly')))

  const setFrequencyAndExpiry = (value) => {
    const cleanFrequency = normaliseFrequency(value)
    setForm(p => ({
      ...p,
      frequency: cleanFrequency,
      expiryDate: recalcExpiry(p.startDate, cleanFrequency, p.coverageTermYears) || p.expiryDate,
    }))
  }

  const setCoverageTermAndExpiry = (value) => {
    const years = Number(value || 1)
    setForm(p => ({
      ...p,
      coverageTermYears: years,
      isMultiYearPolicy: years > 1,
      frequency: years > 1 ? 'Yearly' : p.frequency,
      expiryDate: recalcExpiry(p.startDate, years > 1 ? 'Yearly' : p.frequency, years) || p.expiryDate,
    }))
  }

  const setStartAndExpiry = (value) => {
    setForm(p => ({
      ...p,
      startDate: value,
      expiryDate: recalcExpiry(value, p.frequency, p.coverageTermYears) || p.expiryDate,
    }))
  }

  // When user clicks "Same Company" reset insurer/plan back to original
  const handleCompanyToggle = (same) => {
    setCompanySame(same)
    if (same) {
      set('insurer',  policy.insurer  || '')
      set('planName', policy.planName || '')
    } else {
      // Clear so user is forced to consciously pick the new insurer
      set('insurer',  '')
      set('planName', '')
    }
  }

  const handleSubmit = async () => {
    if (pdfUploading) { toast.error('Please wait for the PDF upload to finish'); return }
    if (!form.startDate)  { toast.error('Start date required'); return }
    if (!form.expiryDate) { toast.error('Expiry date required'); return }
    if (new Date(form.expiryDate) <= new Date(form.startDate)) {
      toast.error('Expiry date must be after start date'); return
    }
    if (!(Number(form.premium) > 0)) {
      toast.error('Premium must be greater than 0'); return
    }
    if (form.policyNumber && form.policyNumber.trim().length < 3) {
      toast.error('Policy number must be at least 3 characters'); return
    }
    const fy = form.fyCommission === '' ? null : Number(form.fyCommission)
    const ry = form.ryCommission === '' ? null : Number(form.ryCommission)
    if ((fy !== null && (fy < 0 || fy > 100)) || (ry !== null && (ry < 0 || ry > 100))) {
      toast.error('Commission percentages must be between 0 and 100'); return
    }
    if (!companySame && !form.insurer.trim()) {
      toast.error('Please select the new insurance company'); return
    }
    if (!isLifePolicy && form.isMultiYearPolicy) {
      const years = Number(form.coverageTermYears || 1)
      if (!Number.isInteger(years) || years < 2 || years > 5) {
        toast.error('Multi-year renewal term must be between 2 and 5 years'); return
      }
    }
    setSaving(true)
    try { await onConfirm({ ...form, companySame, ...pdfMeta }) }
    finally { setSaving(false) }
  }

  const uploadRenewalPdf = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (isLifePolicy) return
    setPdfUploading(true)
    setPdfProgress(0)
    try {
      const yearDate = parseAnyDate(form.expiryDate || form.startDate)
      const documentYear = yearDate ? String(yearDate.getFullYear()) : String(new Date().getFullYear())
      const uploaded = await uploadPolicyPdf(`${policy.id}_renewal`, file, setPdfProgress, documentYear)
      setPdfMeta({
        policyPdfUrl: uploaded.url,
        policyPdfName: uploaded.name,
        policyPdfYear: uploaded.documentYear || documentYear,
        policyPdfStoragePath: uploaded.storagePath || '',
        policyPdfStorageBucket: uploaded.storageBucket || '',
        policyPdfStorageProvider: uploaded.storageProvider || '',
        policyPdfPublicId: uploaded.publicId || '',
        policyPdfResourceType: uploaded.resourceType || '',
        policyPdfDeleteToken: uploaded.deleteToken || '',
      })
      toast.success('Renewal PDF uploaded for the new policy term')
    } catch (err) {
      toast.error(err?.message || 'Renewal PDF upload failed')
    } finally {
      setPdfUploading(false)
      setPdfProgress(null)
      if (pdfRef.current) pdfRef.current.value = ''
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">🔄 Renew Policy</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {/* Old policy summary */}
        <div className="bg-blue-50 dark:bg-blue-900/30 rounded-xl p-3 text-sm">
          <p className="font-semibold text-blue-800 dark:text-blue-200">{policy.clientName} — {policy.policyNumber}</p>
          <p className="text-blue-600 dark:text-blue-400 text-xs mt-0.5">
            {policy.insurer} · {policy.policyType} · {policy.planName || '—'} · Old expiry: {fmtDate(getPolicyDueDate(policy))}
          </p>
        </div>

        {/* ── STEP 1: Company choice — prominent two-button toggle ── */}
        <div>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Step 1 — Is the client renewing with the <em>same company</em> or <em>switching?</em>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleCompanyToggle(true)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border-2 py-4 px-3 transition-all
                ${companySame
                  ? 'border-green-500 bg-green-50 dark:bg-green-900/30'
                  : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:border-gray-300'}`}
            >
              <span className="text-2xl">🏢</span>
              <span className={`text-sm font-bold ${companySame ? 'text-green-700 dark:text-green-300' : 'text-gray-600 dark:text-gray-400'}`}>
                Same Company
              </span>
              {companySame && (
                <span className="text-xs font-semibold text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/50 px-2 py-0.5 rounded-full">
                  ✓ Selected
                </span>
              )}
              <span className="text-xs text-gray-400 dark:text-gray-500 text-center leading-tight">
                Renewing with<br /><strong className="text-gray-600 dark:text-gray-400">{policy.insurer}</strong>
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleCompanyToggle(false)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border-2 py-4 px-3 transition-all
                ${!companySame
                  ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/30'
                  : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:border-gray-300'}`}
            >
              <span className="text-2xl">🔀</span>
              <span className={`text-sm font-bold ${!companySame ? 'text-amber-700 dark:text-amber-300' : 'text-gray-600 dark:text-gray-400'}`}>
                Switch Company
              </span>
              {!companySame && (
                <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 rounded-full">
                  ✓ Selected
                </span>
              )}
              <span className="text-xs text-gray-400 dark:text-gray-500 text-center leading-tight">
                Porting to a<br />different insurer
              </span>
            </button>
          </div>
        </div>

        {/* ── If switching: show insurer picker + plan ── */}
        {!companySame && (
          <div className="space-y-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wider">
              🔀 New Company Details
            </p>
            <div>
              <label className="form-label">New Insurance Company *</label>
              <input
                list="renew-insurer-datalist"
                value={form.insurer}
                onChange={e => set('insurer', e.target.value)}
                className="form-input"
                placeholder="Type to search or select…"
                autoComplete="off"
                autoFocus
              />
              <datalist id="renew-insurer-datalist">
                {RENEW_INSURERS.map(ins => <option key={ins} value={ins} />)}
              </datalist>
              {form.insurer && (
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 font-medium">
                  Switching: <span className="line-through text-gray-400">{policy.insurer}</span> → <strong>{form.insurer}</strong>
                </p>
              )}
            </div>
            <div>
              <label className="form-label">New Plan Name</label>
              <input
                value={form.planName}
                onChange={e => set('planName', e.target.value)}
                className="form-input"
                placeholder="e.g. Optima Secure, Smart Select…"
              />
            </div>
          </div>
        )}

        {companySame && (
          <div className="space-y-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4">
            <p className="text-xs font-semibold text-green-700 dark:text-green-300 uppercase tracking-wider">
              Same Company Plan Details
            </p>
            <div>
              <label className="form-label">Renewed Plan Name</label>
              <input
                value={form.planName}
                onChange={e => set('planName', e.target.value)}
                className="form-input"
                placeholder="Update plan name if changed"
              />
              <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                Company remains {policy.insurer || 'same insurer'}; only the renewed plan name changes.
              </p>
            </div>
          </div>
        )}

        <p className="text-xs text-gray-400 dark:text-gray-500">
          Step 2 — Fill renewal details below. Old policy → <strong>Renewed-Out</strong>. New policy entry created automatically.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">New Policy Number</label>
            <input value={form.policyNumber} onChange={e => set('policyNumber', e.target.value)}
                   placeholder="Leave blank to keep same"
                   className="form-input" />
          </div>
          <div>
            <label className="form-label">Renewed Premium (₹) *</label>
            <input type="number" value={form.premium} onChange={e => set('premium', e.target.value)}
                   className="form-input" required />
          </div>
          <div>
            <label className="form-label">Premium Frequency</label>
            <select value={form.frequency} onChange={e => setFrequencyAndExpiry(e.target.value)} className="form-input">
              <option value="Yearly">Yearly</option>
              <option value="Half-Yearly">Half-Yearly</option>
              <option value="Quarterly">Quarterly</option>
              <option value="Monthly">Monthly</option>
            </select>
          </div>
          {!isLifePolicy && (
            <div>
              <label className="form-label">Renewal Coverage Term</label>
              <select value={String(form.coverageTermYears || 1)} onChange={e => setCoverageTermAndExpiry(e.target.value)} className="form-input">
                <option value="1">Single year</option>
                <option value="2">Multi-year - 2 years</option>
                <option value="3">Multi-year - 3 years</option>
                <option value="4">Multi-year - 4 years</option>
                <option value="5">Multi-year - 5 years</option>
              </select>
            </div>
          )}
          <div>
            <label className="form-label">New Start Date *</label>
            <DateInput value={form.startDate} onChange={setStartAndExpiry}
                   className="form-input" required />
          </div>
          <div>
            <label className="form-label">New Expiry Date *</label>
            <DateInput value={form.expiryDate} onChange={v => set('expiryDate', v)}
                   className="form-input" required />
          </div>
          <div>
            <label className="form-label">FY Commission %</label>
            <input type="number" value={form.fyCommission} onChange={e => set('fyCommission', e.target.value)}
                   className="form-input" placeholder="e.g. 15" />
          </div>
          <div>
            <label className="form-label">RY Commission %</label>
            <input type="number" value={form.ryCommission} onChange={e => set('ryCommission', e.target.value)}
                   className="form-input" placeholder="e.g. 7.5" />
          </div>
        </div>

        <div>
          <label className="form-label">Notes</label>
          <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
                    className="form-input" placeholder="e.g. Sum insured increased to 10L" />
        </div>

        {!isLifePolicy && (
          <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/20 p-4">
            <label className="form-label">Renewed Policy PDF</label>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <input
                ref={pdfRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={uploadRenewalPdf}
                disabled={pdfUploading || saving}
                className="form-input"
              />
              {pdfMeta.policyPdfUrl && (
                <span className="text-xs font-semibold text-green-700 dark:text-green-300">
                  Uploaded: {pdfMeta.policyPdfName}
                </span>
              )}
            </div>
            {pdfUploading && (
              <div className="mt-3 h-2 rounded-full bg-blue-100 overflow-hidden">
                <div className="h-full bg-blue-600 transition-all" style={{ width: `${pdfProgress || 5}%` }} />
              </div>
            )}
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
              Old PDF remains in history. This file is attached only to the new renewed policy.
            </p>
          </div>
        )}

        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-3 text-xs">
          <p className="font-semibold text-emerald-800 dark:text-emerald-200">Renewal change request</p>
          <p className="text-emerald-700 dark:text-emerald-300 mt-1">
            Frequency: {originalFrequency} -&gt; {form.frequency} · New term: {fmtDate(form.startDate)} to {fmtDate(form.expiryDate)}
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={handleSubmit} disabled={saving}
                  className="btn-primary flex-1">
            {saving ? '⏳ Processing…' : '✅ Confirm Renewal'}
          </button>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// POLICY TYPE TABS — ✅ FIX R6: all types included
// ─────────────────────────────────────────────────────────────
function PremiumPaidModal({ policy, onConfirm, onClose, saving }) {
  const currentDue = getPolicyDueDate(policy)
  const initialFrequency = normaliseFrequency(policy.frequency || 'Yearly')
  const [frequency, setFrequency] = useState(initialFrequency)
  const [nextDue, setNextDue] = useState(() => toInputDate(addFrequencyInterval(currentDue, initialFrequency)))

  const setFrequencyAndDue = (value) => {
    const cleanFrequency = normaliseFrequency(value)
    setFrequency(cleanFrequency)
    setNextDue(toInputDate(addFrequencyInterval(currentDue, cleanFrequency)))
  }

  const handleSubmit = () => {
    const due = parseAnyDate(nextDue)
    if (!due) {
      toast.error('Please select a valid next premium due date.')
      return
    }

    const expiry = parseAnyDate(policy.expiryDate)
    const isLifePolicy = String(policy.policyType || '').trim().toLowerCase() === 'life'
    if (!isLifePolicy && expiry && due > expiry) {
      toast.error('For non-life policies, next premium due cannot be after expiry. Please use Renew.')
      return
    }

    onConfirm(policy, {
      frequency,
      currentDue,
      nextPremiumDue: toInputDate(due),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={saving ? undefined : onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Verify Premium Due</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Confirm the next due date before saving.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50 text-2xl leading-none"
          >
            x
          </button>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/30 rounded-xl p-3 text-sm">
          <p className="font-semibold text-blue-800 dark:text-blue-200">{policy.clientName}</p>
          <p className="text-blue-600 dark:text-blue-400 text-xs mt-0.5">
            {policy.policyNumber || '-'} · {policy.policyType || 'Policy'} · Current due: {fmtDate(currentDue)}
          </p>
        </div>

        <div>
          <label className="form-label">Premium Frequency</label>
          <select
            value={frequency}
            onChange={e => setFrequencyAndDue(e.target.value)}
            className="form-input"
            disabled={saving}
          >
            <option value="Yearly">Yearly</option>
            <option value="Half-Yearly">Half-Yearly</option>
            <option value="Quarterly">Quarterly</option>
            <option value="Monthly">Monthly</option>
          </select>
        </div>

        <div>
          <label className="form-label">Next Premium Due / Renewal Date</label>
          <DateInput value={nextDue} onChange={setNextDue} className="form-input" disabled={saving} />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Auto-calculated from frequency. You can manually correct it before saving.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="btn-secondary text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !nextDue}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors inline-flex items-center gap-2"
          >
            {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Save Premium Paid
          </button>
        </div>
      </div>
    </div>
  )
}

const POLICY_TABS = ['ALL', 'Health', 'Life', 'Motor', 'Home', 'Travel', 'Other']

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────
export default function RenewalsPage() {
  const { policies, loading } = usePolicies()
  const { clients }           = useClients()
  const { isAdmin }           = useAuth()

  const [search,    setSearch]    = useState('')
  const [dayWindow, setDayWindow] = useState(30)
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const [policyTab, setPolicyTab] = useState('ALL')

  // ✅ FIX R10: confirmation state instead of firing immediately
  const [renewModal,   setRenewModal]   = useState(null)  // holds policy being renewed
  const [premiumPaidModal, setPremiumPaidModal] = useState(null)
  const [saving,       setSaving]       = useState(false)
  const submittingRef  = useRef(false)
  const topScrollRef = useRef(null)
  const tableScrollRef = useRef(null)

  // ─── WhatsApp ───────────────────────────────────────────────
  const openWhatsApp = useCallback((policy) => {
    let client = clients.find(c => c.id === policy.clientId)

    if (!client?.mobile && policy.clientName) {
      client = clients.find(
        c => c.name?.toLowerCase().trim() === policy.clientName?.toLowerCase().trim()
      )
    }

    const mobile = client?.mobile?.replace(/\D/g, '')
    if (!mobile) { toast.error('No mobile number found for this client'); return }

    {
      const dueStr = getPolicyDueDate(policy)
      const days = daysUntilPolicyDue(policy)
      const urgency = days !== null && days >= 0 ? ` (${days} days remaining)` : ' - please renew urgently'
      const msg =
        `Dear ${policy.clientName},\n\n` +
        `Your ${policy.policyType || 'Insurance'} policy (${policy.policyNumber}) with ${policy.insurer || 'your insurer'} ` +
        `is due for renewal${dueStr ? ` on ${fmtDate(dueStr)}` : ''}${urgency}.\n\n` +
        `Premium: ${fmtCurrency(policy.premium || 0)}\n\n` +
        `Please contact us to renew.\n\n` +
        `Gohil Investments\nWealth Management & Insurance Advisory\n` +
        `Harshdipsinh Gohil - 7698997894\n` +
        `Pradipsinh Gohil - 9426204547\nBhavnagar, Gujarat`
      try {
        openWhatsAppLink({ mobile: client?.mobile, message: msg })
      } catch (err) {
        toast.error(err.message)
      }
      return
    }
  }, [clients])

  // ─── Filter logic ────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()

    return policies
      .filter(p => {
        // Exclude policies that should not be actionable in the renewal queue.
        if (['Renewed-Out', 'Cancelled', 'Matured'].includes((p.status || '').trim())) return false

        const dueStr = getPolicyDueDate(p)
        if (!dueStr) return false

        const dueDate = parseAnyDate(dueStr)
        if (isNaN(dueDate.getTime())) return false

        // Date range filter
        const fromDate = parseAnyDate(dateFrom)
        const toDate = parseAnyDate(dateTo)
        if (fromDate && dueDate < fromDate) return false
        if (toDate && dueDate > toDate) return false

        // Day window filter
        const d = daysUntilPolicyDue(p)
        // ✅ FIX R2: overdue is d < 0 (was incorrectly d >= 0)
        const hasManualDateRange = !!(fromDate || toDate)
        if (!hasManualDateRange && dayWindow === -1) {
          if (d === null || d >= 0) return false
        } else if (!hasManualDateRange) {
          if (d === null || d < 0 || d > dayWindow) return false
        }

        // Type tab filter
        if (policyTab !== 'ALL' && (p.policyType || 'Health') !== policyTab) return false

        // Search
        if (q) {
          return (
            p.clientName?.toLowerCase().includes(q) ||
            p.policyNumber?.toLowerCase().includes(q) ||
            p.insurer?.toLowerCase().includes(q)
          )
        }

        return true
      })
      .sort((a, b) => (daysUntilPolicyDue(a) ?? 9999) - (daysUntilPolicyDue(b) ?? 9999))
  }, [policies, search, dayWindow, dateFrom, dateTo, policyTab])

  // ─── Summary stats ────────────────────────────────────────────
  useEffect(() => {
    const top = topScrollRef.current
    const table = tableScrollRef.current
    if (!top || !table) return undefined
    let syncing = false
    const syncTop = () => {
      if (syncing) return
      syncing = true
      table.scrollLeft = top.scrollLeft
      syncing = false
    }
    const syncTable = () => {
      if (syncing) return
      syncing = true
      top.scrollLeft = table.scrollLeft
      syncing = false
    }
    top.addEventListener('scroll', syncTop)
    table.addEventListener('scroll', syncTable)
    return () => {
      top.removeEventListener('scroll', syncTop)
      table.removeEventListener('scroll', syncTable)
    }
  }, [filtered.length])

  const stats = useMemo(() => {
    const overdue  = filtered.filter(p => (daysUntilPolicyDue(p) ?? 1) < 0).length
    const dueToday = filtered.filter(p => daysUntilPolicyDue(p) === 0).length
    const critical = filtered.filter(p => { const d = daysUntilPolicyDue(p); return d !== null && d > 0 && d <= 7 }).length
    const totalPremium = filtered.reduce((s, p) => s + (parseFloat(p.premium) || 0), 0)
    return { overdue, dueToday, critical, totalPremium }
  }, [filtered])

  // ─── PDF Export ── ✅ FIX R8: uses autoTable ─────────────────
  function exportPDF() {
    const doc = new jsPDF()
    doc.setFontSize(16)
    doc.text('Renewal List', 14, 16)
    doc.setFontSize(10)
    doc.text(`Generated: ${fmtDate(new Date())}  |  ${filtered.length} policies`, 14, 24)

    autoTable(doc, {
      startY: 30,
      head: [['#', 'Client', 'Phone', 'Policy No', 'Type', 'Insurer', 'Due Date', 'Days', 'Premium ₹', 'Status']],
      body: filtered.map((p, i) => {
        const cl = clients.find(c => c.id === p.clientId)
        return [
          i + 1,
          p.clientName,
          p.clientMobile || cl?.mobile || '—',
          p.policyNumber,
          p.policyType || 'Health',
          p.insurer || '—',
          fmtDate(getPolicyDueDate(p)),
          daysUntilPolicyDue(p) ?? '—',
          Number(p.premium || 0).toLocaleString('en-IN'),
          getStatusInfo(daysUntilPolicyDue(p)).label,
        ]
      }),
      styles:     { fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    })

    doc.save('renewals.pdf')
  }

  // ─── RENEW ACTION — uses atomic writeBatch via saveRenewal ───
  const handleRenewConfirm = useCallback(async (renewForm) => {
    if (submittingRef.current || !renewModal) return
    submittingRef.current = true
    setSaving(true)

    const policy = renewModal

    try {
      // Build new policy payload.
      // saveRenewal handles automatically and transactionally: parentPolicyId, policyYear,
      // nextPremiumDue (from startDate + frequency), status, is_renewed,
      // renewedAt, createdAt, updatedAt — all in a single atomic writeBatch.
      const newData = {
        ...policy,                                   // carry every field forward

        // UI-only key: saveRenewal extracts this for the new policyNumber
        newPolicyNumber: renewForm.policyNumber?.trim() || '',

        // Renewal-form overrides
        premium:      renewForm.premium,
        frequency:    renewForm.frequency || policy.frequency || 'Yearly',
        coverageTermYears: Number(renewForm.coverageTermYears || 1),
        isMultiYearPolicy: Boolean(renewForm.isMultiYearPolicy),
        startDate:    renewForm.startDate,
        expiryDate:   renewForm.expiryDate,
        fyCommission: renewForm.fyCommission,
        ryCommission: renewForm.ryCommission,
        notes:        renewForm.notes || '',

        // Company / plan controlled by Same / Switch toggle
        insurer: renewForm.companySame
          ? policy.insurer
          : (renewForm.insurer?.trim() || policy.insurer),
        planName: renewForm.companySame
          ? (renewForm.planName?.trim() || policy.planName || '')
          : (renewForm.planName?.trim() || ''),

        // Reset PDF — new term has no document yet
        policyPdfUrl:  renewForm.policyPdfUrl || null,
        policyPdfName: renewForm.policyPdfName || null,
        policyPdfYear: renewForm.policyPdfYear || null,
        policyPdfStoragePath: renewForm.policyPdfStoragePath || null,
        policyPdfStorageBucket: renewForm.policyPdfStorageBucket || null,
        policyPdfStorageProvider: renewForm.policyPdfStorageProvider || null,
        policyPdfPublicId: renewForm.policyPdfPublicId || null,
        policyPdfResourceType: renewForm.policyPdfResourceType || null,
        policyPdfDeleteToken: renewForm.policyPdfDeleteToken || null,
      }

      // Remove old Firestore doc ID — saveRenewal creates a new document
      delete newData.id

      // Strip undefined values — Firestore rejects them (null is fine)
      const clean = Object.fromEntries(
        Object.entries(newData).filter(([, v]) => v !== undefined)
      )

      await saveRenewal(policy.id, clean)

      toast.success(`✅ Renewed! New policy created for ${policy.clientName}`)
      setRenewModal(null)
    } catch (e) {
      if (renewForm.policyPdfUrl) {
        try {
          await deletePolicyPdfAsset({
            storagePath: renewForm.policyPdfStoragePath,
            storageBucket: renewForm.policyPdfStorageBucket,
            storageProvider: renewForm.policyPdfStorageProvider,
            publicId: renewForm.policyPdfPublicId,
            resourceType: renewForm.policyPdfResourceType,
            deleteToken: renewForm.policyPdfDeleteToken,
          })
        } catch {}
      }
      toast.error(renewalErrorMessage(e))
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }, [renewModal])

  const handlePremiumPaid = useCallback(async (policy, options = {}) => {
    if (submittingRef.current || !policy?.id) return
    submittingRef.current = true
    setSaving(true)

    try {
      await markPremiumPaid(policy.id, options)
      toast.success(`Premium marked paid for ${policy.clientName}. Next due date updated.`)
      setPremiumPaidModal(null)
    } catch (e) {
      toast.error(renewalErrorMessage(e))
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }, [])

  // ─── UI ───────────────────────────────────────────────────────
  if (loading) return (
    <div className="p-8 text-gray-400 dark:text-gray-500 flex items-center gap-2">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      Loading renewals…
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 bg-gray-50 dark:bg-gray-900 min-h-screen">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🔄 Renewals</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {filtered.length} policies · Premium due: {fmtCurrency(stats.totalPremium)}
          </p>
        </div>
        <button onClick={exportPDF}
                className="btn-secondary text-sm">
          ⬇ Export PDF
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Overdue',    val: stats.overdue,   color: 'red',    icon: '⏰' },
          { label: 'Due Today',  val: stats.dueToday,  color: 'orange', icon: '🔴' },
          { label: 'Critical (≤7d)', val: stats.critical, color: 'yellow', icon: '⚡' },
          { label: 'Total Premium',  val: fmtCurrency(stats.totalPremium), color: 'blue', icon: '💰' },
        ].map(({ label, val, color, icon }) => (
          <div key={label} className="stat-card">
            <span className="text-2xl">{icon}</span>
            <div>
              <p className={`text-xl font-bold text-${color}-600 dark:text-${color}-400`}>{val}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ✅ FIX R6: All policy type tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {POLICY_TABS.map(tab => (
          <button key={tab}
                  onClick={() => setPolicyTab(tab)}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors
                    ${policyTab === tab
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
            {tab}
          </button>
        ))}
      </div>

      {/* Day window filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Window:</span>
        {[
          { d: 7,   label: '7 days' },
          { d: 15,  label: '15 days' },
          { d: 30,  label: '30 days' },
          { d: 60,  label: '60 days' },
          { d: -1,  label: '⏰ Overdue' },
        ].map(({ d, label }) => (
          <button key={d}
                  onClick={() => setDayWindow(d)}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors
                    ${dayWindow === d
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50'}`}>
            {label}
          </button>
        ))}

        {/* Date range */}
        <div className="flex items-center gap-2 ml-2">
          <span className="text-xs text-gray-400">From:</span>
          <DateInput value={dateFrom}
                 onChange={setDateFrom}
                 className="form-input text-xs py-1 px-2 w-36" />
          <span className="text-xs text-gray-400">To:</span>
          <DateInput value={dateTo}
                 onChange={setDateTo}
                 className="form-input text-xs py-1 px-2 w-36" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo('') }}
                    className="text-xs text-red-500 hover:text-red-700">✕ Clear</button>
          )}
        </div>
      </div>

      {/* Search */}
      <SearchBar value={search} onChange={setSearch} placeholder="Client name, policy no, insurer…" />

      {/* ✅ FIX R7, R9: Table with premium + insurer columns */}
      <div ref={topScrollRef} className="table-scroll-top overflow-x-auto rounded-t-2xl border border-b-0 border-slate-200/80 bg-white/80 dark:border-slate-700/70 dark:bg-slate-900/80">
        <div className="h-3 min-w-[1180px]" />
      </div>
      <div ref={tableScrollRef} className="table-container renewals-table-container">
        <table className="min-w-[1180px]">
          <thead>
            <tr>
              {['#', 'Client', 'Phone', 'Policy No', 'Type', 'Insurer', 'Due Date', 'Days', 'Premium', 'Status', 'WhatsApp', 'Action'].map(h => (
                <th key={h} className="table-header">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={12} className="text-center py-12 text-gray-400 dark:text-gray-500">
                  <p className="text-2xl mb-2">🎉</p>
                  <p className="font-medium">No renewals in this window</p>
                  <p className="text-xs mt-1">Try a different day window or tab</p>
                </td>
              </tr>
            ) : (
              filtered.map((p, i) => {
                const days = daysUntilPolicyDue(p)
                const { label: statusLabel, cls: statusCls } = getStatusInfo(days)
                const dueStr = getPolicyDueDate(p)
                const termRenewalDue = isTermRenewalDue(p)
                const client = clients.find(c => c.id === p.clientId)
                const phone = p.clientMobile || client?.mobile || ''

                return (
                  <tr
                    key={p.id}
                    style={days !== null && days < 0 ? { backgroundColor: '#fff1f2' } : days !== null && days <= 7 ? { backgroundColor: '#fefce8' } : undefined}
                    className="table-row">
                    <td className="table-cell text-gray-400 text-xs">{i + 1}</td>
                    <td className="table-cell font-semibold">{p.clientName}</td>
                    <td className="table-cell text-xs font-medium">
                      {phone || <span className="text-orange-500">Missing</span>}
                    </td>
                    <td className="table-cell font-mono text-xs font-semibold">{p.policyNumber}</td>
                    <td className="table-cell">
                      <span className="badge-blue text-xs">{p.policyType || 'Health'}</span>
                    </td>
                    <td className="table-cell text-xs text-gray-600 dark:text-gray-400">
                      {p.insurer || '—'}
                    </td>
                    <td className="table-cell text-xs">{fmtDate(dueStr)}</td>
                    <td className={`table-cell text-sm font-bold
                      ${days !== null && days < 0 ? 'text-red-600 dark:text-red-400' :
                        days === 0 ? 'text-red-600 dark:text-red-400' :
                        days <= 7 ? 'text-orange-600 dark:text-orange-400' :
                        'text-gray-700 dark:text-gray-300'}`}>
                      {days === null ? '—' : days < 0 ? `${Math.abs(days)}d ago` : `${days}d`}
                    </td>
                    <td className="table-cell font-semibold text-blue-700 dark:text-blue-400">
                      {fmtCurrency(p.premium)}
                    </td>
                    <td className="table-cell">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusCls}`}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="table-cell">
                      <button onClick={() => openWhatsApp(p)}
                              className="bg-green-500 hover:bg-green-600 text-white text-xs px-3 py-1 rounded-lg font-medium transition-colors">
                        WA
                      </button>
                    </td>
                    <td className="table-cell">
                      <button onClick={() => termRenewalDue ? setRenewModal(p) : setPremiumPaidModal(p)}
                              disabled={saving}
                              className={`${termRenewalDue ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'} disabled:opacity-50 text-white text-xs px-3 py-1 rounded-lg font-medium transition-colors`}>
                        {termRenewalDue ? 'Renew' : 'Mark Paid'}
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ✅ FIX R1 + R10: Renew modal */}
      {renewModal && (
        <RenewModal
          policy={renewModal}
          onConfirm={handleRenewConfirm}
          onClose={() => { if (!saving) setRenewModal(null) }}
        />
      )}
      {premiumPaidModal && (
        <PremiumPaidModal
          policy={premiumPaidModal}
          saving={saving}
          onConfirm={handlePremiumPaid}
          onClose={() => { if (!saving) setPremiumPaidModal(null) }}
        />
      )}
    </div>
  )
}
