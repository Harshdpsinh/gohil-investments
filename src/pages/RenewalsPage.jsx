// src/pages/RenewalsPage.jsx
// ✅ FIXED: R1 renewal creates new policy, R2 overdue filter, R3 WA date,
//           R4 status colors, R5 button reset, R6 all tabs, R7 premium col,
//           R8 PDF autoTable, R9 insurer col, R10 confirm dialog

import { useState, useMemo, useRef, useCallback } from 'react'
import { usePolicies }  from '../hooks/usePolicies'
import { useClients }   from '../hooks/useClients'
import { useAuth }      from '../hooks/useAuth'
import {
  saveRenewal,        // marks old as Renewed-Out AND creates new policy entry
  addPolicy,          // ✅ FIX R1: needed to create the new/successor policy
  updatePolicy,
} from '../firebase/firestore'
import { fmtDate, fmtCurrency, toInputDate } from '../utils/dateUtils'
import SearchBar from '../components/ui/SearchBar'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import toast from 'react-hot-toast'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'   // ✅ FIX R8: proper PDF table

// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────

/**
 * Returns days until the NEXT premium due date.
 * For yearly policies → uses expiryDate.
 * For monthly/quarterly/half-yearly → uses nextPremiumDue (preferred) else expiryDate.
 */
function getDays(p) {
  if (!p) return null

  const freq = (p.frequency || 'Yearly').toLowerCase()
  const isYearly = freq === 'yearly'

  // ✅ FIX R3: correct date source per frequency
  const dateStr = (!isYearly && p.nextPremiumDue)
    ? p.nextPremiumDue
    : p.expiryDate

  if (!dateStr) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const target = new Date(dateStr)
  if (isNaN(target.getTime())) return null
  target.setHours(0, 0, 0, 0)

  return Math.ceil((target - today) / (1000 * 60 * 60 * 24))
}

/** Returns the relevant due date string for display */
function getDueDate(p) {
  if (!p) return null
  const freq = (p.frequency || 'Yearly').toLowerCase()
  return (!freq.includes('yearly') && p.nextPremiumDue)
    ? p.nextPremiumDue
    : p.expiryDate
}

// ✅ FIX R4: status with label + Tailwind color classes
function getStatusInfo(days) {
  if (days === null)  return { label: 'Unknown',  cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' }
  if (days < 0)       return { label: 'Overdue',   cls: 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300' }
  if (days === 0)     return { label: 'Due Today', cls: 'bg-red-600 text-white' }
  if (days <= 7)      return { label: 'Critical',  cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-orange-300' }
  if (days <= 15)     return { label: 'Warning',   cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/60 dark:text-yellow-200' }
  return               { label: 'Active',    cls: 'bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300' }
}

/**
 * Computes nextPremiumDue for the NEW policy after renewal.
 * For yearly policies → null (expiry date drives the calendar).
 * For monthly/quarterly/half-yearly → next due date based on new startDate.
 */
function computeNextPremiumDue(startDate, frequency) {
  if (!startDate) return null
  const freq = (frequency || 'Yearly').toLowerCase()
  if (freq === 'yearly') return null

  const start = new Date(startDate)
  if (isNaN(start.getTime())) return null

  const FREQ_DAYS = {
    monthly:      30,
    quarterly:    91,
    'half-yearly': 182,
    'half yearly': 182,
  }
  const days = FREQ_DAYS[freq]
  if (!days) return null

  return new Date(start.getTime() + days * 86400000).toISOString()
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
  const oldExpiry = getDueDate(policy) || ''
  const defaultStart = oldExpiry
    ? toInputDate(new Date(new Date(oldExpiry).getTime() + 86400000))
    : toInputDate(new Date())
  const defaultExpiry = defaultStart
    ? toInputDate(new Date(new Date(defaultStart).getTime() + 365 * 86400000))
    : ''

  // ── "Same company" or "Switch company" — explicit toggle ──
  const [companySame, setCompanySame] = useState(true)

  const [form, setForm] = useState({
    policyNumber: '',
    insurer:      policy.insurer || '',
    planName:     policy.planName || '',
    premium:      policy.premium || '',
    startDate:    defaultStart,
    expiryDate:   defaultExpiry,
    fyCommission: policy.fyCommission || '',
    ryCommission: policy.ryCommission || '',
    notes:        '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

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
    if (!form.startDate)  { toast.error('Start date required'); return }
    if (!form.expiryDate) { toast.error('Expiry date required'); return }
    if (!companySame && !form.insurer.trim()) {
      toast.error('Please select the new insurance company'); return
    }
    setSaving(true)
    try { await onConfirm({ ...form, companySame }) }
    finally { setSaving(false) }
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
            {policy.insurer} · {policy.policyType} · {policy.planName || '—'} · Old expiry: {fmtDate(getDueDate(policy))}
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
            <label className="form-label">New Start Date *</label>
            <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)}
                   className="form-input" required />
          </div>
          <div>
            <label className="form-label">New Expiry Date *</label>
            <input type="date" value={form.expiryDate} onChange={e => set('expiryDate', e.target.value)}
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
  const [saving,       setSaving]       = useState(false)
  const submittingRef  = useRef(false)

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

    // ✅ FIX R3: use correct due date per frequency
    const dueStr = getDueDate(policy)
    const days   = getDays(policy)

    const msg = encodeURIComponent(
      `Dear ${policy.clientName},\n\n` +
      `Your *${policy.policyType}* policy (${policy.policyNumber}) with *${policy.insurer}* ` +
      `is due for renewal${dueStr ? ` on *${fmtDate(dueStr)}*` : ''}` +
      `${days !== null && days >= 0 ? ` (*${days} days remaining*)` : ' — please renew urgently'}.\n\n` +
      `Premium: *₹${Number(policy.premium || 0).toLocaleString('en-IN')}*\n\n` +
      `Please contact us to renew.\n\n` +
      `*Gohil Investments*\nWealth Management & Insurance Advisory\n` +
      `📞 *Harshdipsinh Gohil* — 7698997894\n` +
      `📞 Pradipsinh Gohil — 9426204547\n📍 Bhavnagar, Gujarat`
    )

    window.open(`https://wa.me/91${mobile}?text=${msg}`, '_blank')
  }, [clients])

  // ─── Filter logic ────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()

    return policies
      .filter(p => {
        // Exclude already-renewed policies
        if ((p.status || '').trim() === 'Renewed-Out') return false

        const dueStr = getDueDate(p)
        if (!dueStr) return false

        const dueDate = new Date(dueStr)
        if (isNaN(dueDate.getTime())) return false

        // Date range filter
        if (dateFrom && dueDate < new Date(dateFrom)) return false
        if (dateTo   && dueDate > new Date(dateTo))   return false

        // Day window filter
        const d = getDays(p)
        // ✅ FIX R2: overdue is d < 0 (was incorrectly d >= 0)
        if (dayWindow === -1) {
          if (d === null || d >= 0) return false
        } else {
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
      .sort((a, b) => (getDays(a) ?? 9999) - (getDays(b) ?? 9999))
  }, [policies, search, dayWindow, dateFrom, dateTo, policyTab])

  // ─── Summary stats ────────────────────────────────────────────
  const stats = useMemo(() => {
    const overdue  = filtered.filter(p => (getDays(p) ?? 1) < 0).length
    const dueToday = filtered.filter(p => getDays(p) === 0).length
    const critical = filtered.filter(p => { const d = getDays(p); return d !== null && d > 0 && d <= 7 }).length
    const totalPremium = filtered.reduce((s, p) => s + (parseFloat(p.premium) || 0), 0)
    return { overdue, dueToday, critical, totalPremium }
  }, [filtered])

  // ─── PDF Export ── ✅ FIX R8: uses autoTable ─────────────────
  function exportPDF() {
    const doc = new jsPDF()
    doc.setFontSize(16)
    doc.text('Renewal List', 14, 16)
    doc.setFontSize(10)
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}  |  ${filtered.length} policies`, 14, 24)

    autoTable(doc, {
      startY: 30,
      head: [['#', 'Client', 'Policy No', 'Type', 'Insurer', 'Due Date', 'Days', 'Premium ₹', 'Status']],
      body: filtered.map((p, i) => [
        i + 1,
        p.clientName,
        p.policyNumber,
        p.policyType || 'Health',
        p.insurer || '—',
        fmtDate(getDueDate(p)),
        getDays(p) ?? '—',
        Number(p.premium || 0).toLocaleString('en-IN'),
        getStatusInfo(getDays(p)).label,
      ]),
      styles:     { fontSize: 8 },
      headStyles: { fillColor: [37, 99, 235] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    })

    doc.save('renewals.pdf')
  }

  // ─── RENEW ACTION ─────────────────────────────────────────────
  const handleRenewConfirm = useCallback(async (renewForm) => {
    if (submittingRef.current || !renewModal) return
    submittingRef.current = true
    setSaving(true)

    const policy = renewModal

    try {
      // ── Step 1: Mark OLD policy as Renewed-Out ─────────────────
      await updatePolicy(policy.id, {
        status:     'Renewed-Out',
        is_renewed: true,
        renewedAt:  new Date().toISOString(),
      })

      // ── Step 2: Build new policy — spread ALL old fields first,
      //    then override only what changed on renewal.
      //    This ensures Motor/Life/Health type-specific fields are
      //    all carried across without manually listing every one.
      const newPolicyData = {
        ...policy,                            // ← carry EVERY field from old policy

        // ── Fields that always change on renewal ──
        status:       'Active',
        policyNumber: renewForm.policyNumber?.trim() || policy.policyNumber,
        premium:      renewForm.premium,
        startDate:    renewForm.startDate,
        expiryDate:   renewForm.expiryDate,
        fyCommission: renewForm.fyCommission,
        ryCommission: renewForm.ryCommission,
        notes:        renewForm.notes || '',

        // ── Company / plan — controlled by Same / Switch toggle ──
        insurer:  renewForm.companySame
          ? policy.insurer
          : (renewForm.insurer?.trim()  || policy.insurer),
        planName: renewForm.companySame
          ? (renewForm.planName?.trim() || policy.planName || '')
          : (renewForm.planName?.trim() || ''),

        // ── Renewal chain metadata ──
        prevPolicyId: policy.id,
        policyYear:   (policy.policyYear || 1) + 1,
        is_renewed:   false,         // new policy is not yet renewed
        renewedAt:    null,

        // ── Reset computed/runtime fields ──
        // ✅ FIX BUG#1: compute correct nextPremiumDue for non-yearly policies.
        // Leaving this null causes renewed policies to vanish from Renewals,
        // Calendar, and Dashboard until manually edited.
        nextPremiumDue: computeNextPremiumDue(renewForm.startDate, policy.frequency),
        policyPdfUrl:   null,        // new policy — no PDF yet
        policyPdfName:  null,

        // ── Timestamps ──
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      // ── CRITICAL: remove the old Firestore doc ID —
      //    addPolicy must create a NEW document, not overwrite the old one
      delete newPolicyData.id

      // ── Sanitize: Firestore rejects `undefined` values.
      //    Strip every key whose value is undefined or null
      //    (null is allowed by Firestore; we strip it too for cleanliness).
      const clean = Object.fromEntries(
        Object.entries(newPolicyData).filter(([, v]) => v !== undefined && v !== null)
      )

      try {
        await addPolicy(clean)
      } catch (addErr) {
        // ── ROLLBACK: if new policy creation fails, restore old policy
        //    so it doesn't get permanently stuck as Renewed-Out
        console.error('addPolicy failed, rolling back:', addErr)
        await updatePolicy(policy.id, {
          status:     policy.status || 'Active',
          is_renewed: false,
          renewedAt:  null,
        })
        throw addErr   // re-throw so the outer catch shows the toast
      }

      toast.success(`✅ Renewed! New policy created for ${policy.clientName}`)
      setRenewModal(null)
    } catch (e) {
      toast.error('Renewal failed: ' + e.message)
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }, [renewModal])

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
          <input type="date" value={dateFrom}
                 onChange={e => setDateFrom(e.target.value)}
                 className="form-input text-xs py-1 px-2 w-36" />
          <span className="text-xs text-gray-400">To:</span>
          <input type="date" value={dateTo}
                 onChange={e => setDateTo(e.target.value)}
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
      <div className="table-container">
        <table className="min-w-full">
          <thead>
            <tr>
              {['#', 'Client', 'Policy No', 'Type', 'Insurer', 'Due Date', 'Days', 'Premium ₹', 'Status', 'WhatsApp', 'Action'].map(h => (
                <th key={h} className="table-header">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-12 text-gray-400 dark:text-gray-500">
                  <p className="text-2xl mb-2">🎉</p>
                  <p className="font-medium">No renewals in this window</p>
                  <p className="text-xs mt-1">Try a different day window or tab</p>
                </td>
              </tr>
            ) : (
              filtered.map((p, i) => {
                const days = getDays(p)
                const { label: statusLabel, cls: statusCls } = getStatusInfo(days)
                const dueStr = getDueDate(p)

                return (
                  <tr key={p.id} className="table-row">
                    <td className="table-cell text-gray-400 text-xs">{i + 1}</td>
                    <td className="table-cell font-semibold">{p.clientName}</td>
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
                        📱 WA
                      </button>
                    </td>
                    <td className="table-cell">
                      {/* ✅ FIX R10: opens modal instead of firing immediately */}
                      <button onClick={() => setRenewModal(p)}
                              disabled={saving}
                              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs px-3 py-1 rounded-lg font-medium transition-colors">
                        Renew →
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
    </div>
  )
}
