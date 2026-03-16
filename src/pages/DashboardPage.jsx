// src/pages/DashboardPage.jsx
import { useMemo, useState, useEffect } from 'react'
import { useClients }  from '../hooks/useClients'
import { usePolicies } from '../hooks/usePolicies'
import { fmtCurrency, daysUntil, fmtDate } from '../utils/dateUtils'
import { useNavigate } from 'react-router-dom'
import { subscribeTasks, subscribeClaims } from '../firebase/firestore'
import { computeCoverageGaps } from '../utils/policySchemas'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend, LineElement, PointElement
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import { format, addDays, parseISO, differenceInDays, isValid, subMonths, startOfMonth } from 'date-fns'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend, LineElement, PointElement)

const today = () => new Date()

function parseDate(val) {
  if (!val) return null
  if (val?.seconds) return new Date(val.seconds * 1000)
  try { const d = parseISO(val); return isValid(d) ? d : null } catch { return null }
}

function isBirthdayThisWeek(dobStr) {
  if (!dobStr) return false
  try {
    const dob  = parseISO(dobStr)
    const now  = today()
    const bday = new Date(now.getFullYear(), dob.getMonth(), dob.getDate())
    const diff = differenceInDays(bday, now)
    return diff >= 0 && diff <= 7
  } catch { return false }
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
    <div className={`stat-card relative ${onClick?'cursor-pointer hover:shadow-md transition-shadow':''}`} onClick={onClick}>
      {badge > 0 && (
        <span className="absolute top-2 right-2 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">{badge}</span>
      )}
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 ${colors[color]||colors.blue}`}>{icon}</div>
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
  const [perfTab, setPerfTab] = useState('commission')  // 'commission' | 'policies' | 'clients'

  useEffect(() => {
    const u1 = subscribeTasks(setTasks)
    const u2 = subscribeClaims(setClaims)
    return () => { u1(); u2() }
  }, [])

  const stats = useMemo(() => {
    const active     = policies.filter(p => p.status === 'Active')
    const expiring30 = active.filter(p => { const d=daysUntil(p.expiryDate); return d!==null && d>=0 && d<=30 })
    const expired    = policies.filter(p => { const d=daysUntil(p.expiryDate); return d!==null && d<0 && p.status==='Active' })
    const totalPrem  = active.reduce((s,p) => s+(parseFloat(p.premium)||0), 0)
    const totalComm  = active.reduce((s,p) => s + Math.round(((parseFloat(p.premium)||0)*(parseFloat(p.fyCommission)||0))/100), 0)
    const birthdays  = clients.filter(c => isBirthdayThisWeek(c.dob))
    const openClaims = claims.filter(c => !['Settled','Rejected'].includes(c.status))
    const openTasks  = tasks.filter(t => !t.done)

    // Type breakdown
    const byType = {}
    active.forEach(p => { byType[p.policyType] = (byType[p.policyType]||0)+1 })

    // Insurer breakdown
    const byInsurer = {}
    active.forEach(p => { if(p.insurer) byInsurer[p.insurer] = (byInsurer[p.insurer]||0)+1 })

    // Monthly new policies (last 6 months)
    const months = Array.from({length:6},(_,i) => {
      const d = subMonths(today(), 5-i)
      return { label: format(d,'MMM yy'), start: startOfMonth(d) }
    })
    const monthly = months.map(m => ({
      label: m.label,
      count: policies.filter(p => {
        const d = parseDate(p.createdAt)
        return d && format(d,'MMM yy') === m.label
      }).length,
      comm: policies.filter(p => {
        const d = parseDate(p.createdAt)
        return d && format(d,'MMM yy') === m.label
      }).reduce((s,p) => s + Math.round(((parseFloat(p.premium)||0)*(parseFloat(p.fyCommission)||0))/100), 0)
    }))

    // Coverage gaps count
    const clientsWithGaps = clients.filter(c => {
      const cp = policies.filter(p => p.clientId === c.id)
      return computeCoverageGaps(cp).length > 0
    })

    return {
      active: active.length, expiring30: expiring30.length,
      expired: expired.length, clients: clients.length,
      totalPrem, totalComm, birthdays, openClaims, openTasks,
      byType, byInsurer, monthly, clientsWithGaps: clientsWithGaps.length
    }
  }, [policies, clients, tasks, claims])

  // Upcoming renewals (next 7 days)
  const urgent = useMemo(() =>
    policies.filter(p => { const d=daysUntil(p.expiryDate); return d!==null && d>=0 && d<=7 && p.status==='Active' })
            .sort((a,b) => daysUntil(a.expiryDate)-daysUntil(b.expiryDate)),
    [policies]
  )

  const typeColors = ['#3b82f6','#a855f7','#f97316','#22c55e','#14b8a6','#6b7280']

  if (loading) return (
    <div className="p-8 flex items-center gap-3 text-gray-400 dark:text-gray-500">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>
      Loading dashboard…
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{format(today(),'EEEE, d MMMM yyyy')}</p>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon="👥" label="Clients"         value={stats.clients}     color="blue"   onClick={()=>navigate('/clients')} />
        <StatCard icon="📋" label="Active Policies" value={stats.active}      color="green"  onClick={()=>navigate('/policies')} />
        <StatCard icon="🔔" label="Expiring (30d)"  value={stats.expiring30}  color="yellow" onClick={()=>navigate('/renewals')} badge={stats.expiring30} />
        <StatCard icon="⏰" label="Overdue"          value={stats.expired}     color="red"    onClick={()=>navigate('/renewals')} badge={stats.expired} />
        <StatCard icon="💰" label="Est. Commission" value={fmtCurrency(stats.totalComm)} color="purple" />
        <StatCard icon="🔍" label="Open Claims"     value={stats.openClaims.length} color="orange" onClick={()=>navigate('/claims')} badge={stats.openClaims.length} />
      </div>

      {/* Alerts row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {stats.birthdays.length > 0 && (
          <div className="bg-pink-50 dark:bg-pink-900/20 border border-pink-200 dark:border-pink-800 rounded-xl p-4 cursor-pointer" onClick={()=>navigate('/clients')}>
            <p className="text-sm font-bold text-pink-700 dark:text-pink-300">🎂 Birthdays This Week</p>
            <div className="mt-2 space-y-1">
              {stats.birthdays.slice(0,3).map(c=>(
                <p key={c.id} className="text-xs text-pink-600 dark:text-pink-400">• {c.name}</p>
              ))}
              {stats.birthdays.length > 3 && <p className="text-xs text-pink-400">+{stats.birthdays.length-3} more</p>}
            </div>
          </div>
        )}
        {stats.openTasks.length > 0 && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 cursor-pointer" onClick={()=>navigate('/tasks')}>
            <p className="text-sm font-bold text-blue-700 dark:text-blue-300">✅ {stats.openTasks.length} Pending Tasks</p>
            <div className="mt-2 space-y-1">
              {stats.openTasks.slice(0,3).map(t=>(
                <p key={t.id} className="text-xs text-blue-600 dark:text-blue-400">• {t.title}</p>
              ))}
            </div>
          </div>
        )}
        {stats.clientsWithGaps > 0 && (
          <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-4 cursor-pointer" onClick={()=>navigate('/clients')}>
            <p className="text-sm font-bold text-orange-700 dark:text-orange-300">🎯 {stats.clientsWithGaps} Clients with Coverage Gaps</p>
            <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">Cross-sell opportunities waiting</p>
          </div>
        )}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Policy type donut */}
        <div className="card">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">🏷️ Policies by Type</p>
          <div style={{height:180}}>
            <Doughnut
              data={{
                labels: Object.keys(stats.byType),
                datasets: [{ data: Object.values(stats.byType), backgroundColor: typeColors, borderWidth: 2 }]
              }}
              options={DOUGHNUT_OPTS}
            />
          </div>
        </div>

        {/* Monthly new policies */}
        <div className="card">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">📅 New Policies (6 months)</p>
          <div style={{height:180}}>
            <Bar
              data={{
                labels: stats.monthly.map(m=>m.label),
                datasets: [{ label:'Policies', data: stats.monthly.map(m=>m.count), backgroundColor:'#3b82f6', borderRadius:4 }]
              }}
              options={CHART_OPTS}
            />
          </div>
        </div>

        {/* Monthly commission trend */}
        <div className="card">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">💰 Commission Trend (6 months)</p>
          <div style={{height:180}}>
            <Line
              data={{
                labels: stats.monthly.map(m=>m.label),
                datasets: [{
                  label:'Commission ₹',
                  data: stats.monthly.map(m=>m.comm),
                  borderColor:'#a855f7',
                  backgroundColor:'rgba(168,85,247,0.1)',
                  tension: 0.4, fill: true, pointRadius: 4
                }]
              }}
              options={{ ...CHART_OPTS, scales: { ...CHART_OPTS.scales, y: { ...CHART_OPTS.scales.y, ticks: { callback: v => `₹${(v/1000).toFixed(0)}K` } } } }}
            />
          </div>
        </div>
      </div>

      {/* Performance section */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-800 dark:text-white">📊 Agent Performance</h2>
          <div className="flex gap-1">
            {[['commission','💰 Commission'],['policies','📋 Policies'],['clients','👥 Clients']].map(([k,l])=>(
              <button key={k} onClick={()=>setPerfTab(k)}
                      className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${perfTab===k?'bg-blue-600 text-white':'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {perfTab === 'commission' && [
            { label:'Total FY Commission',  val: fmtCurrency(policies.reduce((s,p)=>s+Math.round(((parseFloat(p.premium)||0)*(parseFloat(p.fyCommission)||0))/100),0)) },
            { label:'Total RY Commission',  val: fmtCurrency(policies.reduce((s,p)=>s+Math.round(((parseFloat(p.premium)||0)*(parseFloat(p.ryCommission)||0))/100),0)) },
            { label:'Total Premium Under Mgmt', val: fmtCurrency(policies.filter(p=>p.status==='Active').reduce((s,p)=>s+(parseFloat(p.premium)||0),0)) },
            { label:'Avg Commission/Policy', val: fmtCurrency(policies.length ? Math.round(stats.totalComm/Math.max(policies.length,1)) : 0) },
          ].map(({label,val})=>(
            <div key={label} className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-4 text-center">
              <p className="text-xl font-bold text-purple-700 dark:text-purple-300">{val}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
            </div>
          ))}
          {perfTab === 'policies' && [
            { label:'Total Policies', val: policies.length },
            { label:'Active', val: stats.active },
            { label:'Health Policies', val: policies.filter(p=>p.policyType==='Health').length },
            { label:'Life Policies', val: policies.filter(p=>p.policyType==='Life').length },
          ].map(({label,val})=>(
            <div key={label} className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-center">
              <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{val}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
            </div>
          ))}
          {perfTab === 'clients' && [
            { label:'Total Clients', val: clients.length },
            { label:'KYC Complete', val: clients.filter(c=>c.kycStatus==='Complete').length },
            { label:'Coverage Gaps', val: stats.clientsWithGaps },
            { label:'Avg Policies/Client', val: clients.length ? (policies.filter(p=>p.status==='Active').length/clients.length).toFixed(1) : '0' },
          ].map(({label,val})=>(
            <div key={label} className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 text-center">
              <p className="text-xl font-bold text-green-700 dark:text-green-300">{val}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Urgent renewals */}
      {urgent.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-800 dark:text-white">⚡ Expiring This Week ({urgent.length})</h2>
            <button onClick={()=>navigate('/renewals')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">View all →</button>
          </div>
          <div className="space-y-2">
            {urgent.slice(0,8).map(p => {
              const d = daysUntil(p.expiryDate)
              return (
                <div key={p.id} className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{p.clientName}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{p.policyNumber} · {p.insurer}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${d===0?'text-red-600':d<=3?'text-orange-600':'text-yellow-600'}`}>
                      {d === 0 ? 'Today!' : `${d}d`}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{fmtCurrency(p.premium)}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Claims pipeline summary */}
      {claims.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-800 dark:text-white">🔍 Claims Pipeline</h2>
            <button onClick={()=>navigate('/claims')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">View all →</button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {['Intimated','Documents Submitted','Under Review','Approved','Settled','Rejected'].map(status => {
              const count = claims.filter(c=>c.status===status).length
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
