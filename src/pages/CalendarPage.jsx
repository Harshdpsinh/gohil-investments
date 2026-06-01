// src/pages/CalendarPage.jsx
// ✅ FIXED: C1 (unified date source in policyMap & sidebar), C2 (Renewed-Out filtered first),
//           C3 (sidebar click uses same date key as policyMap)
import { useState, useMemo } from 'react'
import { usePolicies } from '../hooks/usePolicies'
import { useNavigate } from 'react-router-dom'
import {
  format, startOfMonth, endOfMonth,
  eachDayOfInterval, getDay, isSameDay, isSameMonth,
  addMonths, subMonths
} from 'date-fns'
import { fmtCurrency, fmtDate, getDueDate as getPolicyDueDate, parseAnyDate } from '../utils/dateUtils'

const TYPE_COLORS = {
  Health: 'bg-blue-500',
  Life:   'bg-purple-500',
  Motor:  'bg-orange-500',
  Home:   'bg-green-500',
  Travel: 'bg-teal-500',
  Other:  'bg-gray-400',
}
const TYPE_DOT = {
  Health: 'bg-blue-400',
  Life:   'bg-purple-400',
  Motor:  'bg-orange-400',
  Home:   'bg-green-400',
  Travel: 'bg-teal-400',
  Other:  'bg-gray-400',
}

// ✅ FIX C1: single authoritative function to get the "calendar date" for a policy
// Uses nextPremiumDue for non-yearly, expiryDate for yearly.
// Returns a Date or null.
function getCalendarDate(p) {
  return parseAnyDate(getPolicyDueDate(p))
}

export default function CalendarPage() {
  const { policies, loading } = usePolicies()
  const navigate  = useNavigate()
  const [current,    setCurrent]    = useState(new Date())
  const [selected,   setSelected]   = useState(null)
  const [typeFilter, setTypeFilter] = useState('All')

  const monthStart = startOfMonth(current)
  const monthEnd   = endOfMonth(current)
  const days       = eachDayOfInterval({ start: monthStart, end: monthEnd })

  // ✅ FIX C2: exclude Renewed-Out FIRST before any date logic
  // ✅ FIX C1: use getCalendarDate() everywhere consistently
  const policyMap = useMemo(() => {
    const map = {}
    policies.forEach(p => {
      // ✅ FIX C2: filter status before date processing
      if ((p.status || '').trim() === 'Renewed-Out') return
      if (typeFilter !== 'All' && p.policyType !== typeFilter) return

      const d = getCalendarDate(p)
      if (!d || !isSameMonth(d, current)) return

      const key = format(d, 'yyyy-MM-dd')
      if (!map[key]) map[key] = []
      map[key].push(p)
    })
    return map
  }, [policies, current, typeFilter])

  // ✅ FIX C1: sidebar list also uses getCalendarDate() (same source as policyMap)
  const monthPolicies = useMemo(() =>
    Object.values(policyMap).flat().sort((a, b) => {
      const da = getCalendarDate(a)
      const db = getCalendarDate(b)
      return (da ? da.getTime() : 0) - (db ? db.getTime() : 0)
    }),
    [policyMap]
  )

  const selectedPolicies = selected
    ? (policyMap[format(selected, 'yyyy-MM-dd')] || [])
    : []

  const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const startPad = getDay(monthStart)

  const totalPremium = monthPolicies.reduce((s, p) => s + (parseFloat(p.premium) || 0), 0)

  if (loading) return (
    <div className="p-8 text-gray-400 dark:text-gray-500 flex items-center gap-2">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />Loading…
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Policy Expiry Calendar</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {monthPolicies.length} policies expiring in {format(current, 'MMMM yyyy')} · Renewal premium: {fmtCurrency(totalPremium)}
          </p>
        </div>
        {/* Type filter legend */}
        <div className="flex gap-1 flex-wrap">
          {['All', 'Health', 'Life', 'Motor', 'Home', 'Travel', 'Other'].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
                    className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors
                      ${typeFilter === t ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
              {t !== 'All' && <span className={`inline-block w-2 h-2 rounded-full mr-1 ${TYPE_DOT[t] || 'bg-gray-400'}`} />}{t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Calendar */}
        <div className="lg:col-span-2 card p-0 overflow-hidden">
          {/* Month nav */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <button onClick={() => { setCurrent(c => subMonths(c, 1)); setSelected(null) }}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-lg">‹</button>
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">{format(current, 'MMMM yyyy')}</h2>
            <button onClick={() => { setCurrent(c => addMonths(c, 1)); setSelected(null) }}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-lg">›</button>
          </div>

          {/* Days header */}
          <div className="grid grid-cols-7 border-b border-gray-100 dark:border-gray-700">
            {DAYS_OF_WEEK.map(d => (
              <div key={d} className="px-2 py-2 text-center text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7">
            {Array.from({ length: startPad }).map((_, i) => (
              <div key={`pad-${i}`} className="min-h-[80px] border-b border-r border-gray-50 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20" />
            ))}
            {days.map(day => {
              const key       = format(day, 'yyyy-MM-dd')
              const polsOnDay = policyMap[key] || []
              const isToday   = isSameDay(day, new Date())
              const isSel     = selected && isSameDay(day, selected)
              return (
                <div key={key}
                     onClick={() => setSelected(isSel ? null : day)}
                     className={`min-h-[80px] border-b border-r border-gray-100 dark:border-gray-700 p-1.5 cursor-pointer transition-colors
                       ${isSel ? 'bg-blue-50 dark:bg-blue-900/30 ring-2 ring-inset ring-blue-400' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                  <p className={`text-xs font-semibold mb-1 w-6 h-6 flex items-center justify-center rounded-full
                    ${isToday ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-400'}`}>
                    {format(day, 'd')}
                  </p>
                  <div className="space-y-0.5">
                    {polsOnDay.slice(0, 3).map(p => (
                      <div key={p.id}
                           className={`${TYPE_COLORS[p.policyType] || 'bg-gray-400'} text-white text-xs rounded px-1 py-0.5 truncate leading-tight`}
                           title={`${p.clientName} — ${p.policyType}`}>
                        {p.clientName?.split(' ')[0]}
                      </div>
                    ))}
                    {polsOnDay.length > 3 && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 pl-1">+{polsOnDay.length - 3} more</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          {/* Selected day details */}
          {selected && selectedPolicies.length > 0 && (
            <div className="card">
              <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">
                📅 {fmtDate(selected)} — {selectedPolicies.length} expir{selectedPolicies.length === 1 ? 'y' : 'ies'}
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {selectedPolicies.map(p => (
                  <div key={p.id} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{p.clientName}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{p.policyNumber}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{p.insurer}</p>
                      </div>
                      <span className={`text-xs font-semibold text-white px-2 py-0.5 rounded-full flex-shrink-0 ${TYPE_COLORS[p.policyType] || 'bg-gray-400'}`}>
                        {p.policyType}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs font-bold text-blue-600 dark:text-blue-400">{fmtCurrency(p.premium)}</p>
                      <button onClick={() => navigate('/renewals')}
                              className="text-xs px-2 py-0.5 bg-green-50 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded hover:bg-green-100">
                        Renew →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* This month summary */}
          <div className="card">
            <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">
              📋 {format(current, 'MMMM')} — All Expiries ({monthPolicies.length})
            </p>
            {monthPolicies.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">No policies expiring this month</p>
            ) : (
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {monthPolicies.map(p => {
                  // ✅ FIX C3: use getCalendarDate() so click navigates to the correct day
                  const d = getCalendarDate(p)
                  return (
                    <div key={p.id}
                         onClick={() => d && setSelected(d)}
                         className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${TYPE_DOT[p.policyType] || 'bg-gray-400'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">{p.clientName}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">{p.insurer}</p>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                        {d ? fmtDate(d) : '?'}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
