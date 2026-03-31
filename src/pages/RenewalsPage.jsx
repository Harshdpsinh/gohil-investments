// src/pages/RenewalsPage.jsx
import { useState, useMemo, useRef } from 'react'           // FIX Bug #1: added useRef
import { usePolicies } from '../hooks/usePolicies'
import { saveRenewal } from '../firebase/firestore'          // FIX Bug #2: use saveRenewal (atomic batch) from firestore.js

// ==============================
// ✅ UTILS (unchanged)
// ==============================
function getDays(p) {
  if (!p?.expiryDate) return null

  const today = new Date()
  const expiry = new Date(p.expiryDate)

  return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24))
}

function getStatus(days) {
  if (days === null) return 'Unknown'
  if (days < 0) return 'Expired'
  if (days === 0) return 'Due Today'
  if (days <= 7) return 'Critical'
  if (days <= 15) return 'Warning'
  return 'Active'
}

function statusBadge(days) {
  const status = getStatus(days)

  const styles = {
    Expired: 'bg-red-100 text-red-600',
    'Due Today': 'bg-red-100 text-red-600',
    Critical: 'bg-red-100 text-red-600',
    Warning: 'bg-yellow-100 text-yellow-600',
    Active: 'bg-blue-100 text-blue-600',
    Unknown: 'bg-gray-100 text-gray-600'
  }

  return (
    <span className={`px-2 py-1 rounded text-xs ${styles[status]}`}>
      {status}
    </span>
  )
}

// ==============================
// ✅ DATE GENERATOR (unchanged)
// ==============================
function generateRenewalDates(policy, frequency = 'Yearly') {
  const baseDate = new Date(policy.expiryDate)

  const startDate = new Date(baseDate)

  const expiryDate = new Date(baseDate)
  expiryDate.setFullYear(expiryDate.getFullYear() + 1)

  let nextPremiumDue = null

  if (frequency !== 'Yearly') {
    const map = {
      Monthly: 30,
      Quarterly: 90,
      'Half-Yearly': 180
    }

    nextPremiumDue = new Date(
      baseDate.getTime() + map[frequency] * 86400000
    )
  }

  return {
    startDate: startDate.toISOString().split('T')[0],
    expiryDate: expiryDate.toISOString().split('T')[0],
    nextPremiumDue: nextPremiumDue
      ? nextPremiumDue.toISOString().split('T')[0]
      : null
  }
}

// ==============================
// FIX Bug #3: Renewal Modal
// Collects the new policy number from the user before submitting.
// This was entirely absent — without it policyNumber was never updated
// and the new doc was indistinguishable from the old one in the DB.
// ==============================
function RenewalModal({ policy, onConfirm, onClose, saving }) {
  const [newPolicyNumber, setNewPolicyNumber] = useState(policy.policyNumber || '')

  const handleSubmit = () => {
    if (!newPolicyNumber.trim()) {
      alert('Please enter the new policy number')
      return
    }
    onConfirm(newPolicyNumber.trim())
  }

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">🔄 Confirm Renewal</h2>
          <button onClick={onClose} disabled={saving}
                  className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {/* Policy summary */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm space-y-1">
          <p><span className="text-gray-500">Client:</span> <span className="font-semibold">{policy.clientName}</span></p>
          <p><span className="text-gray-500">Old Policy No:</span> <span className="font-mono font-semibold">{policy.policyNumber}</span></p>
          <p><span className="text-gray-500">Insurer:</span> {policy.insurer}</p>
          <p><span className="text-gray-500">Old Expiry:</span> {policy.expiryDate}</p>
        </div>

        {/* FIX Bug #3: New policy number input — the critical missing field */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            New Policy Number *
            <span className="ml-1 text-xs font-normal text-gray-400">
              (edit if insurer issued a new number, otherwise keep same)
            </span>
          </label>
          <input
            type="text"
            value={newPolicyNumber}
            onChange={e => setNewPolicyNumber(e.target.value)}
            disabled={saving}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                       disabled:bg-gray-100 disabled:cursor-not-allowed"
            placeholder="Enter new policy number from insurer"
            autoFocus
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-400
                       disabled:cursor-not-allowed text-white font-semibold
                       py-2 px-4 rounded-lg text-sm transition-colors"
          >
            {saving
              ? <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent
                                   rounded-full animate-spin inline-block" />
                  Processing…
                </span>
              : '✅ Confirm Renewal'
            }
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-gray-600 bg-gray-100
                       hover:bg-gray-200 rounded-lg disabled:cursor-not-allowed transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ==============================
// ✅ MAIN COMPONENT
// ==============================
export default function RenewalsPage() {
  const { policies } = usePolicies()

  const [dayWindow, setDayWindow] = useState(30)
  const [search, setSearch]       = useState('')

  // FIX Bug #1: Track which policy IDs have been successfully renewed locally
  // so the row vanishes immediately without waiting for Firestore snapshot sync
  const [dismissedIds, setDismissedIds] = useState(new Set())

  // FIX Bug #3: Track which policy the renewal modal is open for
  const [renewModal, setRenewModal] = useState(null)  // null | policy object

  // FIX Bug #1: saving state for the modal button (also prevents double-click in UI layer)
  const [saving, setSaving]         = useState(false)

  // FIX Bug #1: ref-based guard — synchronous lock that prevents a second
  // submission even if the user clicks the button before the first await resolves
  const submittingRef = useRef(false)

  // ==============================
  // ✅ FILTERED DATA
  // FIX Bug #1: filter by status !== 'Renewed-Out' instead of isActive === true
  //   The old `p.isActive === true` would show ZERO results because the DB field
  //   is `status: 'Active'`, not a boolean `isActive`. This was a silent data bug.
  // ==============================
  const renewals = useMemo(() => {
    const q = search.toLowerCase()

    return policies
      .filter(p => (p.status || '').trim() !== 'Renewed-Out') // FIX Bug #1: correct active filter

      .filter(p => {
        const d = getDays(p)
        if (d === null || isNaN(d)) return false

        const inWindow =
          dayWindow === -1
            ? d < 0
            : d >= 0 && d <= dayWindow

        if (!inWindow) return false

        const match =
          !q ||
          p.clientName?.toLowerCase().includes(q) ||
          p.policyNumber?.toLowerCase().includes(q) ||
          p.insurer?.toLowerCase().includes(q)

        return match
      })

      .sort((a, b) => {
        const da = getDays(a)
        const db = getDays(b)

        if (da === null) return 1
        if (db === null) return -1

        return da - db
      })
  }, [policies, dayWindow, search])

  // FIX Bug #1: visibleRenewals applies the optimistic dismissal on top of the
  // real-time list. Renewed cards disappear immediately on success rather than
  // waiting for the Firestore onSnapshot to propagate back to the client.
  const visibleRenewals = useMemo(
    () => renewals.filter(p => !dismissedIds.has(p.id)),
    [renewals, dismissedIds]
  )

  // ==============================
  // FIX: handleRenew opens the modal instead of immediately submitting
  // ==============================
  function handleRenew(policy) {
    if (policy.status === 'Renewed-Out') {
      alert('This policy has already been renewed')
      return
    }
    setRenewModal(policy)  // FIX Bug #3: open modal to collect new policy number
  }

  // ==============================
  // FIX: onConfirmRenew — called when user submits the modal
  // All three bugs are fixed here in coordination with saveRenewal() in firestore.js
  // ==============================
  async function onConfirmRenew(newPolicyNumber) {
    // FIX Bug #1: ref-based lock prevents race condition from double-click.
    // useRef is used (not useState) because assignment is synchronous —
    // the lock is set BEFORE the first await, unlike setState which is async.
    if (submittingRef.current) return
    submittingRef.current = true
    setSaving(true)

    const policy = renewModal  // capture before modal closes

    try {
      const dates = generateRenewalDates(policy, policy.frequency)

      // FIX Bug #2 + #3: saveRenewal() in firestore.js runs an atomic writeBatch:
      //   1. Updates old doc: status→'Renewed-Out', is_renewed→true
      //   2. Creates new doc: newPolicyNumber, parentPolicyId, policyYear+1, nextPremiumDue
      // Both writes succeed or both roll back — no orphaned records possible.
      await saveRenewal(policy.id, {
        ...policy,
        ...dates,
        newPolicyNumber,           // FIX Bug #3: user-entered new policy number passed to DB
      })

      // FIX Bug #1: Remove from visible list immediately — don't wait for Firestore listener
      setDismissedIds(prev => new Set([...prev, policy.id]))

      setRenewModal(null)
      alert(`✅ Renewed successfully!\nOld policy "${policy.policyNumber}" closed.\nNew policy "${newPolicyNumber}" (Year ${(policy.policyYear || 1) + 1}) is now active.`)

    } catch (err) {
      // saveRenewal batch failed — Firestore rolled back both writes automatically
      alert('❌ Renewal failed: ' + err.message)
    } finally {
      submittingRef.current = false  // always release the lock
      setSaving(false)
    }
  }

  // ==============================
  // UI (structure unchanged — only uses visibleRenewals instead of renewals in table)
  // ==============================
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Renewals</h1>

      {/* FILTERS — unchanged */}
      <div className="flex gap-2 mb-4">
        {[7, 15, 30, 60, -1].map(d => (
          <button
            key={d}
            onClick={() => setDayWindow(d)}
            className={`px-3 py-1 rounded ${
              dayWindow === d
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200'
            }`}
          >
            {d === -1 ? 'Overdue' : `${d}d`}
          </button>
        ))}

        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border px-2 py-1"
        />
      </div>

      {/* TABLE — FIX Bug #1: visibleRenewals instead of renewals */}
      <table className="w-full border">
        <thead>
          <tr className="bg-gray-100 text-sm">
            <th>#</th>
            <th>Client</th>
            <th>Policy</th>
            <th>Insurer</th>
            <th>Expiry</th>
            <th>Days</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>

        <tbody>
          {visibleRenewals.map((p, i) => {   /* FIX Bug #1: visibleRenewals */
            const d = getDays(p)

            return (
              <tr key={p.id} className="border-t text-sm">
                <td>{i + 1}</td>
                <td>{p.clientName}</td>
                <td>{p.policyNumber}</td>
                <td>{p.insurer}</td>
                <td>{p.expiryDate}</td>
                <td>{d}</td>
                <td>{statusBadge(d)}</td>

                <td>
                  <button
                    onClick={() => handleRenew(p)}
                    className="bg-green-600 text-white px-2 py-1 rounded"
                  >
                    Renew
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* FIX Bug #3: Renewal modal — renders only when a policy is selected */}
      {renewModal && (
        <RenewalModal
          policy={renewModal}
          onConfirm={onConfirmRenew}
          onClose={() => { if (!saving) setRenewModal(null) }}
          saving={saving}
        />
      )}
    </div>
  )
}
