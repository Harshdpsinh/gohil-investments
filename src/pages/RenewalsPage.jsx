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
  saveRenewalReminderSettings,
  subscribeRenewalReminderLogs,
  subscribeRenewalReminderSettings,
} from '../firebase/firestore'
import { deletePolicyPdfAsset, uploadPolicyPdf } from '../firebase/storage'
import { addFrequencyInterval, addPolicyCoverageInterval, fmtDate, fmtCurrency, normaliseFrequency, parseAnyDate, toInputDate, daysUntilPolicyDue, getDueDate as getPolicyDueDate } from '../utils/dateUtils'
import { openWhatsAppLink } from '../services/whatsappService'
import {
  defaultRenewalReminderSettings,
  normaliseReminderSettings,
  sendManualRenewalReminder,
} from '../services/renewalReminderService'
import { shareGeneratedFile } from '../services/nativeShareService'
import SearchBar from '../components/ui/SearchBar'
import DateInput from '../components/ui/DateInput'
import AppIcon from '../components/ui/AppIcon'
import Modal from '../components/ui/Modal'
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
  const isLifePolicy = String(policy.policyType || '').trim().toLowerCase() === 'life'
  const [frequency, setFrequency] = useState(initialFrequency)
  const [premium, setPremium] = useState(String(policy.premium || ''))
  const [nextDue, setNextDue] = useState(() => toInputDate(addFrequencyInterval(currentDue, initialFrequency)))

  const setFrequencyAndDue = (value) => {
    const cleanFrequency = normaliseFrequency(value)
    setFrequency(cleanFrequency)
    setNextDue(toInputDate(addFrequencyInterval(currentDue, cleanFrequency)))
  }

  const handleSubmit = () => {
    if (isLifePolicy && !(Number(premium) > 0)) {
      toast.error('Renewed premium must be greater than 0.')
      return
    }
    const due = parseAnyDate(nextDue)
    if (!due) {
      toast.error('Please select a valid next premium due date.')
      return
    }

    const expiry = parseAnyDate(policy.expiryDate)
    if (!isLifePolicy && expiry && due > expiry) {
      toast.error('For non-life policies, next premium due cannot be after expiry. Please use Renew.')
      return
    }

    onConfirm(policy, {
      frequency,
      premium: isLifePolicy ? premium : undefined,
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

        {isLifePolicy && (
          <div>
            <label className="form-label">Renewed Premium (₹) *</label>
            <input
              type="number"
              min="1"
              step="0.01"
              value={premium}
              onChange={event => setPremium(event.target.value)}
              className="form-input"
              disabled={saving}
              required
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Update the installment premium together with its payment frequency.
            </p>
          </div>
        )}

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
            disabled={saving || !nextDue || (isLifePolicy && !(Number(premium) > 0))}
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

function ReminderSettingsModal({ open, onClose, draft, setDraft, logs, onSave, saving }) {
  const set = (key, value) => setDraft(prev => ({ ...prev, [key]: value }))
  const updateInterval = (index, patch) => setDraft(prev => ({
    ...prev,
    intervals: prev.intervals.map((item, i) => i === index ? { ...item, ...patch } : item),
  }))
  const addInterval = () => setDraft(prev => ({
    ...prev,
    intervals: [...prev.intervals, { id: `d${Date.now()}`, days: 45, enabled: true }]
      .sort((a, b) => b.days - a.days),
  }))
  const removeInterval = index => setDraft(prev => ({
    ...prev,
    intervals: prev.intervals.filter((_, i) => i !== index),
  }))

  return (
    <Modal open={open} onClose={onClose} title="Renewal Reminder Settings" size="xl">
      <div className="space-y-5">
        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={e => set('enabled', e.target.checked)}
            className="h-4 w-4"
          />
          Automatic reminders enabled
        </label>

        <div>
          <label className="form-label">Basic Message Prompt</label>
          <textarea
            value={draft.prompt}
            onChange={e => set('prompt', e.target.value)}
            rows={4}
            className="form-input"
            placeholder="Please renew your policy on time..."
          />
          <p className="mt-1 text-xs text-gray-500">
            Optional tokens: {'{clientName}'}, {'{policyNumber}'}, {'{insurer}'}, {'{dueDate}'}, {'{premium}'}, {'{days}'}.
          </p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Reminder Intervals</p>
            <button type="button" onClick={addInterval} className="btn-secondary text-xs">
              <AppIcon name="plus" size={15} /> Add
            </button>
          </div>
          <div className="space-y-2">
            {draft.intervals.map((item, index) => (
              <div key={item.id || index} className="grid grid-cols-12 items-center gap-2 rounded-xl border border-slate-200 p-2 dark:border-slate-700">
                <label className="col-span-2 flex items-center gap-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={e => updateInterval(index, { enabled: e.target.checked })}
                  />
                  On
                </label>
                <input
                  type="number"
                  min="0"
                  value={item.days}
                  onChange={e => updateInterval(index, { days: Math.max(0, Number(e.target.value) || 0) })}
                  className="form-input col-span-7 text-sm"
                />
                <span className="col-span-2 text-xs text-gray-500">{Number(item.days) === 0 ? 'due date' : 'days before'}</span>
                <button type="button" onClick={() => removeInterval(index)} className="col-span-1 text-red-500 hover:text-red-700">
                  <AppIcon name="trash" size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-bold text-slate-800 dark:text-slate-100">Reminder History</p>
          <div className="max-h-72 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="min-w-full text-xs">
              <thead>
                <tr>
                  {['Date', 'Client', 'Policy', 'Interval', 'Status'].map(h => <th key={h} className="table-header">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr><td colSpan={5} className="p-4 text-center text-gray-400">No reminders sent yet.</td></tr>
                ) : logs.map(log => (
                  <tr key={log.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="table-cell">{fmtDate(log.createdAt)}</td>
                    <td className="table-cell">{log.clientName || '-'}</td>
                    <td className="table-cell font-mono">{log.policyNumber || '-'}</td>
                    <td className="table-cell">{log.manual ? 'Manual' : `${log.daysBefore ?? '-'}d`}</td>
                    <td className="table-cell">
                      <span className={`rounded-full px-2 py-0.5 font-bold ${log.status === 'sent' ? 'bg-green-100 text-green-700' : log.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {log.status || 'sent'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Close</button>
          <button type="button" onClick={onSave} disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </Modal>
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
  const [statusFilter, setStatusFilter] = useState('all')

  // ✅ FIX R10: confirmation state instead of firing immediately
  const [renewModal,   setRenewModal]   = useState(null)  // holds policy being renewed
  const [premiumPaidModal, setPremiumPaidModal] = useState(null)
  const [reminderModal, setReminderModal] = useState(false)
  const [reminderSettings, setReminderSettings] = useState(defaultRenewalReminderSettings())
  const [reminderDraft, setReminderDraft] = useState(defaultRenewalReminderSettings())
  const [reminderLogs, setReminderLogs] = useState([])
  const [savingReminders, setSavingReminders] = useState(false)
  const [manualSendingId, setManualSendingId] = useState('')
  const [saving,       setSaving]       = useState(false)
  const submittingRef  = useRef(false)
  const topScrollRef = useRef(null)
  const tableScrollRef = useRef(null)

  useEffect(() => {
    const unsubSettings = subscribeRenewalReminderSettings(data => {
      const settings = normaliseReminderSettings(data || {})
      setReminderSettings(settings)
      setReminderDraft(settings)
    })
    const unsubLogs = subscribeRenewalReminderLogs(setReminderLogs)
    return () => {
      unsubSettings()
      unsubLogs()
    }
  }, [])

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

        const d = daysUntilPolicyDue(p)

        // Status cards are first-class filters and override date windows.
        if (statusFilter === 'overdue' && (d === null || d >= 0)) return false
        if (statusFilter === 'due' && d !== 0) return false
        if (statusFilter === 'critical' && (d === null || d <= 0 || d > 7)) return false

        // Date range filter
        const fromDate = parseAnyDate(dateFrom)
        const toDate = parseAnyDate(dateTo)
        if (statusFilter === 'all' && fromDate && dueDate < fromDate) return false
        if (statusFilter === 'all' && toDate && dueDate > toDate) return false

        // Day window filter
        // ✅ FIX R2: overdue is d < 0 (was incorrectly d >= 0)
        const hasManualDateRange = !!(fromDate || toDate)
        if (statusFilter !== 'all') {
          // Already handled by the selected summary card.
        } else if (!hasManualDateRange && dayWindow === -1) {
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
  }, [policies, search, dayWindow, dateFrom, dateTo, policyTab, statusFilter])

  // Row display data is computed once and shared by the desktop table and the
  // mobile card list, so the two views can never drift apart.
  const clientById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients])

  const renewalRows = useMemo(() => filtered.map(policy => {
    const days = daysUntilPolicyDue(policy)
    const { label: statusLabel, cls: statusCls } = getStatusInfo(days)
    return {
      policy,
      days,
      statusLabel,
      statusCls,
      dueStr: getPolicyDueDate(policy),
      termRenewalDue: isTermRenewalDue(policy),
      phone: policy.clientMobile || clientById.get(policy.clientId)?.mobile || '',
    }
  }), [filtered, clientById])

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
    const summaryPolicies = policies.filter(p => {
      if (['Renewed-Out', 'Cancelled', 'Matured'].includes((p.status || '').trim())) return false
      if (!getPolicyDueDate(p)) return false
      if (policyTab !== 'ALL' && (p.policyType || 'Health') !== policyTab) return false
      const q = search.toLowerCase().trim()
      return !q || [p.clientName, p.policyNumber, p.insurer].some(value => String(value || '').toLowerCase().includes(q))
    })
    const overdue  = summaryPolicies.filter(p => (daysUntilPolicyDue(p) ?? 1) < 0).length
    const dueToday = summaryPolicies.filter(p => daysUntilPolicyDue(p) === 0).length
    const critical = summaryPolicies.filter(p => { const d = daysUntilPolicyDue(p); return d !== null && d > 0 && d <= 7 }).length
    const totalPremium = summaryPolicies.reduce((s, p) => s + (parseFloat(p.premium) || 0), 0)
    return { overdue, dueToday, critical, totalPremium }
  }, [policies, policyTab, search])

  // ─── PDF Export ── ✅ FIX R8: uses autoTable ─────────────────
  async function exportPDF() {
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

    const blob = doc.output('blob')
    const shared = await shareGeneratedFile(blob, 'renewals.pdf', 'Renewal list')
    if (!shared) doc.save('renewals.pdf')
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

  const handleSaveReminderSettings = useCallback(async () => {
    setSavingReminders(true)
    try {
      const settings = normaliseReminderSettings(reminderDraft)
      await saveRenewalReminderSettings(settings)
      toast.success('Renewal reminder settings saved.')
      setReminderModal(false)
    } catch (error) {
      toast.error(error.message || 'Could not save reminder settings.')
    } finally {
      setSavingReminders(false)
    }
  }, [reminderDraft])

  const handleManualReminder = useCallback(async (policy) => {
    setManualSendingId(policy.id)
    try {
      const result = await sendManualRenewalReminder(policy, clients, reminderSettings)
      if (result.ok) toast.success('Reminder sent on WhatsApp.')
      else toast.error(result.error || 'Reminder send failed.')
    } finally {
      setManualSendingId('')
    }
  }, [clients, reminderSettings])

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
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><AppIcon name="renewals" size={24} /> Renewals</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {filtered.length} policies · Premium due: {fmtCurrency(stats.totalPremium)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setReminderModal(true)} className="btn-secondary text-sm">
            <AppIcon name="settings" size={17} /> Reminders
          </button>
          <button onClick={exportPDF} className="btn-secondary text-sm">
            <AppIcon name="download" size={17} /> Export PDF
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { key: 'overdue', label: 'Overdue', val: stats.overdue, valueClass: 'text-red-600 dark:text-red-400', icon: 'warning' },
          { key: 'due', label: 'Due Today', val: stats.dueToday, valueClass: 'text-orange-600 dark:text-orange-400', icon: 'clock' },
          { key: 'critical', label: 'Critical (≤7d)', val: stats.critical, valueClass: 'text-amber-600 dark:text-amber-400', icon: 'fileClock' },
          { key: 'all', label: 'Total Premium', val: fmtCurrency(stats.totalPremium), valueClass: 'text-blue-600 dark:text-blue-400', icon: 'rupee' },
        ].map(({ key, label, val, valueClass, icon }) => (
          <button
            type="button"
            key={key}
            aria-pressed={statusFilter === key}
            onClick={() => { setStatusFilter(key); setDateFrom(''); setDateTo('') }}
            className={`stat-card w-full text-left transition ${statusFilter === key ? 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-gray-900' : 'hover:border-blue-300'}`}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200"><AppIcon name={icon} size={20} /></span>
            <div>
              <p className={`text-xl font-bold ${valueClass}`}>{val}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
            </div>
          </button>
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
          { d: -1,  label: 'Overdue' },
        ].map(({ d, label }) => (
          <button key={d}
                  onClick={() => { setDayWindow(d); setStatusFilter('all'); setDateFrom(''); setDateTo('') }}
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
                 onChange={value => { setDateFrom(value); setStatusFilter('all') }}
                 className="form-input text-xs py-1 px-2 w-36" />
          <span className="text-xs text-gray-400">To:</span>
          <DateInput value={dateTo}
                 onChange={value => { setDateTo(value); setStatusFilter('all') }}
                 className="form-input text-xs py-1 px-2 w-36" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo('') }}
                    className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700"><AppIcon name="x" size={15} /> Clear</button>
          )}
        </div>
      </div>

      {/* Search */}
      <SearchBar value={search} onChange={setSearch} placeholder="Client name, policy no, insurer…" />

      {/* Mobile / tablet: stacked cards. Every action is reachable without any
          horizontal scrolling — the wide table below is desktop-only. */}
      <div className="lg:hidden space-y-3">
        {renewalRows.length === 0 ? (
          <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-10 text-center text-gray-400 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-gray-500">
            <p className="text-2xl mb-2">🎉</p>
            <p className="font-medium">No renewals in this window</p>
            <p className="text-xs mt-1">Try a different day window or tab</p>
          </div>
        ) : renewalRows.map(({ policy: p, days, statusLabel, statusCls, dueStr, termRenewalDue, phone }) => (
          <div
            key={p.id}
            className={`rounded-2xl border p-4 shadow-sm ${
              days !== null && days < 0
                ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30'
                : days !== null && days <= 7
                  ? 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30'
                  : 'border-slate-200/80 bg-white dark:border-slate-700/70 dark:bg-slate-900/80'
            }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 dark:text-white truncate">{p.clientName}</p>
                <p className="font-mono text-xs text-gray-500 dark:text-gray-400 truncate">{p.policyNumber}</p>
              </div>
              <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${statusCls}`}>
                {statusLabel}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <span className="text-gray-500 dark:text-gray-400">Due</span>
                <p className="font-medium text-gray-800 dark:text-gray-200">{fmtDate(dueStr)}</p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Days</span>
                <p className={`font-bold ${
                  days !== null && days <= 0 ? 'text-red-600 dark:text-red-400'
                    : days <= 7 ? 'text-orange-600 dark:text-orange-400'
                      : 'text-gray-700 dark:text-gray-300'}`}>
                  {days === null ? '—' : days < 0 ? `${Math.abs(days)}d ago` : `${days}d`}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Premium</span>
                <p className="font-semibold text-blue-700 dark:text-blue-400">{fmtCurrency(p.premium)}</p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Phone</span>
                <p className="font-medium text-gray-800 dark:text-gray-200">
                  {phone || <span className="text-orange-500">Missing</span>}
                </p>
              </div>
              <div className="col-span-2">
                <span className="text-gray-500 dark:text-gray-400">Insurer</span>
                <p className="font-medium text-gray-800 dark:text-gray-200 truncate">
                  <span className="badge-blue mr-2 text-xs">{p.policyType || 'Health'}</span>
                  {p.insurer || '—'}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => openWhatsApp(p)}
                      className="col-span-2 bg-green-500 hover:bg-green-600 active:bg-green-700 text-white text-sm px-3 py-2.5 rounded-xl font-semibold transition-colors">
                WhatsApp Reminder
              </button>
              <button onClick={() => handleManualReminder(p)}
                      disabled={manualSendingId === p.id}
                      className="bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white text-sm px-3 py-2.5 rounded-xl font-semibold transition-colors">
                {manualSendingId === p.id ? 'Sending…' : 'Resend'}
              </button>
              <button onClick={() => termRenewalDue ? setRenewModal(p) : setPremiumPaidModal(p)}
                      disabled={saving}
                      className={`${termRenewalDue ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'} disabled:opacity-50 text-white text-sm px-3 py-2.5 rounded-xl font-semibold transition-colors`}>
                {termRenewalDue ? 'Renew' : 'Mark Paid'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ✅ FIX R7, R9: Table with premium + insurer columns — desktop only */}
      <div ref={topScrollRef} className="table-scroll-top hidden lg:block overflow-x-auto rounded-t-2xl border border-b-0 border-slate-200/80 bg-white/80 dark:border-slate-700/70 dark:bg-slate-900/80">
        <div className="h-3 min-w-[1180px]" />
      </div>
      <div ref={tableScrollRef} className="table-container renewals-table-container hidden lg:block">
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
              renewalRows.map(({ policy: p, days, statusLabel, statusCls, dueStr, termRenewalDue, phone }, i) => {
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
                      <div className="flex gap-1">
                        <button onClick={() => openWhatsApp(p)}
                                className="bg-green-500 hover:bg-green-600 text-white text-xs px-3 py-1 rounded-lg font-medium transition-colors">
                          WA
                        </button>
                        <button onClick={() => handleManualReminder(p)}
                                disabled={manualSendingId === p.id}
                                className="bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white text-xs px-3 py-1 rounded-lg font-medium transition-colors">
                          {manualSendingId === p.id ? '...' : 'Resend'}
                        </button>
                      </div>
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
      <ReminderSettingsModal
        open={reminderModal}
        onClose={() => setReminderModal(false)}
        draft={reminderDraft}
        setDraft={setReminderDraft}
        logs={reminderLogs}
        onSave={handleSaveReminderSettings}
        saving={savingReminders}
      />
    </div>
  )
}
