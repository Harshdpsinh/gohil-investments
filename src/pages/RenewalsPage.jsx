import { useState, useMemo } from 'react'
import { usePolicies } from '../hooks/usePolicies'
import { renewPolicy } from '../firebase/policies'

// ==============================
// ✅ UTILS (FIXED)
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
// ✅ DATE GENERATOR (FIXED)
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
    nextPremiumDue
      ? nextPremiumDue.toISOString().split('T')[0]
      : null
  }
}

// ==============================
// ✅ MAIN COMPONENT
// ==============================
export default function RenewalsPage() {
  const { policies } = usePolicies()

  const [dayWindow, setDayWindow] = useState(30)
  const [search, setSearch] = useState('')

  // ==============================
  // ✅ FILTERED DATA (FIXED)
  // ==============================
  const renewals = useMemo(() => {
    const q = search.toLowerCase()

    return policies
      // 🔥 MOST IMPORTANT FIX
      .filter(p => p.isActive === true)

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

  // ==============================
  // ✅ HANDLE RENEW (FIXED)
  // ==============================
  async function handleRenew(policy) {
    try {
      // 🚫 Prevent duplicate
      if (policy.status === 'Renewed-Out') {
        alert('Already renewed')
        return
      }

      const dates = generateRenewalDates(policy, policy.frequency)

      await renewPolicy(policy.id, {
        ...policy,
        ...dates
      })

      alert('✅ Renewed Successfully')

    } catch (err) {
      alert(err.message)
    }
  }

  // ==============================
  // UI
  // ==============================
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Renewals</h1>

      {/* FILTERS */}
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

      {/* TABLE */}
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
          {renewals.map((p, i) => {
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
    </div>
  )
}