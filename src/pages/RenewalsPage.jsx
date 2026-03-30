// ✅ FIXED RenewalsPage.jsx (Clean, Bug-Free Core Logic)

import { useState, useMemo } from 'react'

// --- Utilities (FIXED) ---
function getDays(p) {
  if (!p || !p.expiryDate) return null
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
    Expired: 'badge-red',
    'Due Today': 'badge-red',
    Critical: 'badge-red',
    Warning: 'badge-yellow',
    Active: 'badge-blue',
    Unknown: 'badge-gray'
  }
  return <span className={styles[status]}>{status}</span>
}

// --- Main Component ---
export default function RenewalsPage({ policies = [] }) {
  const [dayWindow, setDayWindow] = useState(30)
  const [search, setSearch] = useState('')

  // --- FILTERED DATA (FIXED) ---
  const renewals = useMemo(() => {
    const q = search.toLowerCase()

    return policies
      .filter(p => {
        const d = getDays(p)
        if (d === null || isNaN(d)) return false

        // ✅ FIXED WINDOW LOGIC
        const inWindow =
          dayWindow === -1
            ? d < 0
            : d >= 0 && d <= dayWindow

        if (!inWindow) return false

        const matchQ =
          !q ||
          p.clientName?.toLowerCase().includes(q) ||
          p.policyNumber?.toLowerCase().includes(q) ||
          p.insurer?.toLowerCase().includes(q)

        return matchQ
      })

      // ✅ FIXED SORT
      .sort((a, b) => {
        const da = getDays(a)
        const db = getDays(b)

        if (da === null) return 1
        if (db === null) return -1

        return da - db
      })
  }, [policies, dayWindow, search])

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Renewals</h1>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {[7, 15, 30, 60, -1].map(d => (
          <button
            key={d}
            onClick={() => setDayWindow(d)}
            className={`px-3 py-1 rounded ${dayWindow === d ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
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

      {/* Table */}
      <table className="w-full border">
        <thead>
          <tr className="bg-gray-100">
            <th>#</th>
            <th>Client</th>
            <th>Policy No</th>
            <th>Insurer</th>
            <th>Expiry</th>
            <th>Days</th>
            <th>Status</th>
          </tr>
        </thead>

        <tbody>
          {renewals.map((p, i) => {
            const d = getDays(p)

            return (
              <tr key={p.id} className="border-t">
                <td>{i + 1}</td>
                <td>{p.clientName}</td>
                <td>{p.policyNumber}</td>
                <td>{p.insurer}</td>
                <td>{p.expiryDate}</td>
                <td>{d}</td>
                <td>{statusBadge(d)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}


// ================================
// ✅ RENEWAL FORM DATE FIX
// ================================

export function getRenewalDates(policy, frequency = 'Yearly') {
  const baseDate = new Date(policy.expiryDate) // ✅ FIXED

  const startDate = new Date(baseDate)

  const expiryDate = new Date(baseDate)
  expiryDate.setFullYear(expiryDate.getFullYear() + 1)

  let nextPremiumDue = ''

  if (frequency !== 'Yearly') {
    const daysMap = {
      Monthly: 30,
      Quarterly: 90,
      'Half-Yearly': 180
    }

    const next = new Date(baseDate.getTime() + daysMap[frequency] * 86400000)
    nextPremiumDue = next.toISOString().split('T')[0]
  }

  return {
    startDate: startDate.toISOString().split('T')[0],
    expiryDate: expiryDate.toISOString().split('T')[0],
    nextPremiumDue
  }
}
