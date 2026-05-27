// src/pages/DashboardPage.jsx
// ✅ FIXED: D1 (memoization - today() as stable ref), D2 (expired count uses isActivePol),
//           D3 (birthday exact day), D4 (commission trend fallback for missing createdAt)
import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { useClients }  from '../hooks/useClients'
import { usePolicies } from '../hooks/usePolicies'
import { fmtCurrency, daysUntil, fmtDate, parseAnyDate, daysUntilPremium } from '../utils/dateUtils'
import { useNavigate } from 'react-router-dom'
import { subscribeTasks, subscribeClaims } from '../firebase/firestore'
import { computeCoverageGaps } from '../utils/policySchemas'
import { openWhatsAppLink } from '../services/whatsappService'
import toast from 'react-hot-toast'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend, LineElement, PointElement, Filler
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import { format, differenceInDays, subMonths, startOfDay } from 'date-fns'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend, LineElement, PointElement, Filler)

// ✅ FIX D1: stable reference — do NOT call inside useMemo
const NOW = startOfDay(new Date())

const isActivePol = p => !['Renewed-Out', 'Cancelled', 'Matured'].includes((p.status || '').trim())

// ✅ FIX D3: handles same-day birthdays properly using >= 0 (not just > 0)
function isBirthdayThisWeek(dobStr) {
  if (!dobStr) return false
  try {
    const dob = parseAnyDate(dobStr)
    if (!dob) return false
    const bday = new Date(NOW.getFullYear(), dob.getMonth(), dob.getDate())
    // if this year's birthday has passed, check next year's
    const diff = differenceInDays(bday, NOW)
    if (diff >= 0 && diff <= 7) return true
    // Check if it's today (same day, diff might be 0 or negative due to DST)
    if (diff < 0) {
      const nextYearBday = new Date(NOW.getFullYear() + 1, dob.getMonth(), dob.getDate())
      const nextDiff = differenceInDays(nextYearBday, NOW)
      return nextDiff >= 0 && nextDiff <= 7
    }
    return false
  } catch { return false }
}

function getPremDays(p) {
  if (!p) return null
  if (p.nextPremiumDue) {
    const d = new Date(p.nextPremiumDue)
    if (!isNaN(d.getTime())) return Math.ceil((d - NOW) / 86400000)
  }
  if (p.startDate) {
    const days = daysUntilPremium(p.startDate, p.frequency)
    if (days !== null) return days
  }
  return daysUntil(p.expiryDate)
}

function StatCard({ icon, label, value, sub, color, onClick, badge }) {
  const colors = {
    blue:   'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    green:  'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
    yellow: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-200',
    red:    'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
    purple: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
    orange: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
  }
  return (
    <div className={`stat-card relative ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`} onClick={onClick}>
      {badge > 0 && (
        <span className="absolute top-2 right-2 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">{badge}</span>
      )}
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 ${colors[color] || colors.blue}`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{label}</p>
        {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

const CHART_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 11 } } },
    y: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 11 } } }
  }
}

const DOUGHNUT_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12 } } },
  cutout: '65%'
}

export default function DashboardPage() {
  const { clients }           = useClients()
  const { policies, loading } = usePolicies()
  const navigate  = useNavigate()
  const [tasks,   setTasks]   = useState([])
  const [claims,  setClaims]  = useState([])
  const [perfTab, setPerfTab] = useState('commission')

  const openWA = useCallback((policy) => {
    let client = clients.find(c => c.id === policy.clientId)
    if (!client?.mobile && policy.clientName) {
      client = clients.find(c => c.name?.toLowerCase().trim() === (policy.clientName || '').toLowerCase().trim())
    }
    const mobile = (client?.mobile || '').replace(/\D/g, '')
    if (!mobile) {
      toast.error('No mobile number found for this client.')
      return
    }
    if (!mobile) return
    const d = getPremDays(policy)
    const safeMsg =
      `Dear ${policy.clientName},\n\n` +
      `Your ${policy.policyType || 'Insurance'} policy (${policy.policyNumber}) with ${policy.insurer || 'your insurer'} premium is due` +
      `${d !== null && d >= 0 ? ` in ${d} days` : ' - please renew urgently'}.\n\n` +
      `Please contact us for renewal.\n\n` +
      `Gohil Investments\nWealth Management & Insurance Advisory\n` +
      `Harshdipsinh Gohil - 7698997894\n` +
      `Pradipsinh Gohil - 9426204547\nBhavnagar, Gujarat`
    try {
      openWhatsAppLink({ mobile: client?.mobile, message: safeMsg })
    } catch (err) {
      toast.error(err.message || 'Could not open WhatsApp.')
    }
    return
    const msg = encodeURIComponent(
      `Dear ${policy.clientName},\n\nYour *${policy.policyType}* policy (${policy.policyNumber}) with *${policy.insurer}* premium is due${d !== null && d >= 0 ? ` in *${d} days*` : ' — please renew urgently'}.\n\nPlease contact us for renewal.\n\n*Gohil Investments*\nWealth Management & Insurance Advisory\n📞 *Harshdipsinh Gohil* — 7698997894\n📞 Pradipsinh Gohil — 9426204547\n📍 Bhavnagar, Gujarat`
    )
    window.open(`https://wa.me/91${mobile}?text=${msg}`, '_blank')
  }, [clients])

  useEffect(() => {
    const u1 = subscribeTasks(setTasks, err => console.error('Dashboard tasks subscription failed:', err))
    const u2 = subscribeClaims(setClaims, err => console.error('Dashboard claims subscription failed:', err))
    return () => { u1(); u2() }
  }, [])

  const stats = useMemo(() => {
    // ✅ FIX D2: filter active policies FIRST before computing expired
    const active     = policies.filter(p => isActivePol(p))
    const expiring30 = active.filter(p => { const d = getPremDays(p); return d !== null && d >= 0 && d <= 30 })
    // ✅ FIX D2: expired only from active policies (Renewed-Out already excluded)
    const expired    = active.filter(p => { const d = getPremDays(p); return d !== null && d < 0 })
    const totalPrem  = active.reduce((s, p) => s + (parseFloat(p.premium) || 0), 0)
    const totalComm  = active.reduce((s, p) => s + Math.round(((parseFloat(p.premium) || 0) * (parseFloat(p.fyCommission) || 0)) / 100), 0)
    const birthdays  = clients.filter(c => isBirthdayThisWeek(c.dob))
    const openClaims = claims.filter(c => !['Settled', 'Rejected'].includes(c.status))
    const openTasks  = tasks.filter(t => !t.done)

    const byType = {}
    active.forEach(p => { byType[p.policyType] = (byType[p.policyType] || 0) + 1 })

    const byInsurer = {}
    active.forEach(p => { if (p.insurer) byInsurer[p.insurer] = (byInsurer[p.insurer] || 0) + 1 })

    // ✅ FIX D4: fallback to startDate if createdAt is missing
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = subMonths(NOW, 5 - i)
      return { label: format(d, 'MMM yy'), count: 0, comm: 0 }
    })
    const monthIndex = Object.fromEntries(months.map((m, i) => [m.label, i]))

    policies.forEach(p => {
      // ✅ FIX D4: try createdAt first, fall back to startDate
      const rawDate = p.createdAt || p.startDate
      if (!rawDate) return
      const d = parseAnyDate(rawDate)
      if (!d) return
      const lbl = format(d, 'MMM yy')
      const idx = monthIndex[lbl]
      if (idx === undefined) return
      months[idx].count++
      months[idx].comm += Math.round(((parseFloat(p.premium) || 0) * (parseFloat(p.fyCommission) || 0)) / 100)
    })

    const clientsWithGaps = clients.filter(c => {
      const cp = policies.filter(p => p.clientId === c.id && isActivePol(p))
      return computeCoverageGaps(cp).length > 0
    })

    return {
      active: active.length, expiring30: expiring30.length,
      expired: expired.length, clients: clients.length,
      totalPrem, totalComm, birthdays, openClaims, openTasks,
      byType, byInsurer, monthly: months, clientsWithGaps: clientsWithGaps.length
    }
  }, [policies, clients, tasks, claims])

  const urgent = useMemo(() =>
    policies
      .filter(p => { const d = getPremDays(p); return d !== null && d >= 0 && d <= 7 && isActivePol(p) })
      .sort((a, b) => (getPremDays(a) || 0) - (getPremDays(b) || 0)),
    [policies]
  )

  const typeColors = ['#3b82f6', '#a855f7', '#f97316', '#22c55e', '#14b8a6', '#6b7280']

  if (loading) return (
    <div className="p-8 flex items-center gap-3 text-gray-400 dark:text-gray-500">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      Loading dashboard…
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{format(NOW, 'EEEE, d MMMM yyyy')}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon="👥" label="Clients"         value={stats.clients}     color="blue"   onClick={() => navigate('/clients')} />
        <StatCard icon="📋" label="Active Policies" value={stats.active}      color="green"  onClick={() => navigate('/policies')} />
        <StatCard icon="🔔" label="Expiring (30d)"  value={stats.expiring30}  color="yellow" onClick={() => navigate('/renewals')} badge={stats.expiring30} />
        <StatCard icon="⏰" label="Overdue"          value={stats.expired}     color="red"    onClick={() => navigate('/renewals')} badge={stats.expired} />
        <StatCard icon="💰" label="Est. Commission" value={fmtCurrency(stats.totalComm)} color="purple" />
        <StatCard icon="🔍" label="Open Claims"     value={stats.openClaims.length} color="orange" onClick={() => navigate('/claims')} badge={stats.openClaims.length} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {stats.birthdays.length > 0 && (
          <div className="bg-pink-50 dark:bg-pink-900/20 border border-pink-200 dark:border-pink-800 rounded-xl p-4 cursor-pointer" onClick={() => navigate('/clients')}>
            <p className="text-sm font-bold text-pink-700 dark:text-pink-300">🎂 Birthdays This Week</p>
            <div className="mt-2 space-y-1">
              {stats.birthdays.slice(0, 3).map(c => (
                <p key={c.id} className="text-xs text-pink-600 dark:text-pink-400">• {c.name}</p>
              ))}
              {stats.birthdays.length > 3 && <p className="text-xs text-pink-400">+{stats.birthdays.length - 3} more</p>}
            </div>
          </div>
        )}
        {stats.openTasks.length > 0 && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 cursor-pointer" onClick={() => navigate('/tasks')}>
            <p className="text-sm font-bold text-blue-700 dark:text-blue-300">✅ {stats.openTasks.length} Pending Tasks</p>
            <div className="mt-2 space-y-1">
              {stats.openTasks.slice(0, 3).map(t => (
                <p key={t.id} className="text-xs text-blue-600 dark:text-blue-400">• {t.title}</p>
              ))}
            </div>
          </div>
        )}
        {stats.clientsWithGaps > 0 && (
          <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-4 cursor-pointer" onClick={() => navigate('/clients')}>
            <p className="text-sm font-bold text-orange-700 dark:text-orange-300">🎯 {stats.clientsWithGaps} Clients with Coverage Gaps</p>
            <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">Cross-sell opportunities waiting</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">🏷️ Policies by Type</p>
          <div style={{ height: 180 }}>
            <Doughnut
              data={{ labels: Object.keys(stats.byType), datasets: [{ data: Object.values(stats.byType), backgroundColor: typeColors, borderWidth: 2 }] }}
              options={DOUGHNUT_OPTS}
            />
          </div>
        </div>
        <div className="card">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">📅 New Policies (6 months)</p>
          <div style={{ height: 180 }}>
            <Bar
              data={{ labels: stats.monthly.map(m => m.label), datasets: [{ label: 'Policies', data: stats.monthly.map(m => m.count), backgroundColor: '#3b82f6', borderRadius: 4 }] }}
              options={CHART_OPTS}
            />
          </div>
        </div>
        <div className="card">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">💰 Commission Trend (6 months)</p>
          <div style={{ height: 180 }}>
            <Line
              data={{ labels: stats.monthly.map(m => m.label), datasets: [{ label: 'Commission ₹', data: stats.monthly.map(m => m.comm), borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,0.1)', tension: 0.4, fill: true, pointRadius: 4 }] }}
              options={{ ...CHART_OPTS, scales: { ...CHART_OPTS.scales, y: { ...CHART_OPTS.scales.y, ticks: { callback: v => `₹${(v / 1000).toFixed(0)}K` } } } }}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-800 dark:text-white">📊 Agent Performance</h2>
          <div className="flex gap-1">
            {[['commission', '💰 Commission'], ['policies', '📋 Policies'], ['clients', '👥 Clients']].map(([k, l]) => (
              <button key={k} onClick={() => setPerfTab(k)}
                      className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${perfTab === k ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {perfTab === 'commission' && [
            { label: 'Total FY Commission',      val: fmtCurrency(policies.reduce((s, p) => s + Math.round(((parseFloat(p.premium) || 0) * (parseFloat(p.fyCommission) || 0)) / 100), 0)) },
            { label: 'Total RY Commission',      val: fmtCurrency(policies.reduce((s, p) => s + Math.round(((parseFloat(p.premium) || 0) * (parseFloat(p.ryCommission) || 0)) / 100), 0)) },
            { label: 'Total Premium Under Mgmt', val: fmtCurrency(policies.filter(p => isActivePol(p)).reduce((s, p) => s + (parseFloat(p.premium) || 0), 0)) },
            { label: 'Avg Commission/Policy',    val: fmtCurrency(policies.length ? Math.round(stats.totalComm / Math.max(policies.length, 1)) : 0) },
          ].map(({ label, val }) => (
            <div key={label} className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-4 text-center">
              <p className="text-xl font-bold text-purple-700 dark:text-purple-300">{val}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
            </div>
          ))}
          {perfTab === 'policies' && [
            { label: 'Total Policies',   val: policies.length },
            { label: 'Active',           val: stats.active },
            { label: 'Health Policies',  val: policies.filter(p => p.policyType === 'Health').length },
            { label: 'Life Policies',    val: policies.filter(p => p.policyType === 'Life').length },
          ].map(({ label, val }) => (
            <div key={label} className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-center">
              <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{val}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
            </div>
          ))}
          {perfTab === 'clients' && [
            { label: 'Total Clients',        val: clients.length },
            { label: 'KYC Complete',         val: clients.filter(c => c.kycStatus === 'Complete').length },
            { label: 'Coverage Gaps',        val: stats.clientsWithGaps },
            { label: 'Avg Policies/Client',  val: clients.length ? (policies.filter(p => isActivePol(p)).length / clients.length).toFixed(1) : '0' },
          ].map(({ label, val }) => (
            <div key={label} className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 text-center">
              <p className="text-xl font-bold text-green-700 dark:text-green-300">{val}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {urgent.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-800 dark:text-white">⚡ Expiring This Week ({urgent.length})</h2>
            <button onClick={() => navigate('/renewals')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">View all →</button>
          </div>
          <div className="space-y-2">
            {urgent.slice(0, 8).map(p => {
              const d = getPremDays(p)
              return (
                <div key={p.id} className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{p.clientName}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{p.policyNumber} · {p.insurer}</p>
                  </div>
                  <div className="text-right flex flex-col items-end gap-1">
                    <p className={`text-sm font-bold ${d === 0 ? 'text-red-600' : d !== null && d <= 3 ? 'text-orange-600' : 'text-yellow-600'}`}>
                      {d === 0 ? 'Today!' : d !== null ? `${d}d` : '—'}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{fmtCurrency(p.premium)}</p>
                    <button onClick={() => openWA(p)} className="text-xs px-2 py-0.5 bg-green-500 text-white rounded hover:bg-green-600">📱 WA</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {claims.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-800 dark:text-white">🔍 Claims Pipeline</h2>
            <button onClick={() => navigate('/claims')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">View all →</button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {['Intimated', 'Documents Submitted', 'Under Review', 'Approved', 'Settled', 'Rejected'].map(status => {
              const count = claims.filter(c => c.status === status).length
              return (
                <div key={status} className="text-center bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
                  <p className="text-xl font-bold text-gray-800 dark:text-gray-200">{count}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-tight">{status}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
