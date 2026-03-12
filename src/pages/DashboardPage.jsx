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
import { Bar, Doughnut } from 'react-chartjs-2'
import { format, addDays, parseISO, differenceInDays, isValid } from 'date-fns'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend, LineElement, PointElement)

// ── Helpers ───────────────────────────────────────────────────
const today = () => new Date()

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

function isPolicyAnniversarySoon(startDateStr) {
  if (!startDateStr) return false
  try {
    const sd  = parseISO(startDateStr)
    const now = today()
    const ann = new Date(now.getFullYear(), sd.getMonth(), sd.getDate())
    const diff = differenceInDays(ann, now)
    return diff >= 0 && diff <= 30
  } catch { return false }
}

// ── Stat card ─────────────────────────────────────────────────
function StatCard({ icon, label, value, sub, color, onClick, badge }) {
  const colors = {
    blue:   'bg-blue-100 text-blue-700',
    green:  'bg-green-100 text-green-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    red:    'bg-red-100 text-red-700',
    purple: 'bg-purple-100 text-purple-700',
    orange: 'bg-orange-100 text-orange-700',
  }
  return (
    <div className={`stat-card relative ${onClick?'cursor-pointer hover:shadow-md transition-shadow':''}`} onClick={onClick}>
      {badge > 0 && (
        <span className="absolute top-2 right-2 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">{badge}</span>
      )}
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 ${colors[color]||colors.blue}`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function RenewalRow({ policy }) {
  const days = daysUntil(policy.expiryDate)
  const urgency = days<0?'badge-red':days<=15?'badge-red':days<=30?'badge-yellow':'badge-blue'
  return (
    <tr className="table-row">
      <td className="table-cell font-medium text-gray-900">{policy.clientName||'—'}</td>
      <td className="table-cell">{policy.policyNumber}</td>
      <td className="table-cell">{policy.policyType}</td>
      <td className="table-cell">{policy.insurer}</td>
      <td className="table-cell">{fmtDate(policy.expiryDate)}</td>
      <td className="table-cell"><span className={urgency}>{days<0?`${Math.abs(days)}d overdue`:`${days}d`}</span></td>
      <td className="table-cell">{fmtCurrency(policy.premium)}</td>
    </tr>
  )
}

// ── Birthday widget ───────────────────────────────────────────
function BirthdayWidget({ clients }) {
  const upcoming = useMemo(() =>
    clients.filter(c => isBirthdayThisWeek(c.dob))
           .map(c => {
             const dob  = parseISO(c.dob)
             const now  = today()
             const bday = new Date(now.getFullYear(), dob.getMonth(), dob.getDate())
             return { ...c, daysUntilBday: differenceInDays(bday, now) }
           })
           .sort((a,b) => a.daysUntilBday - b.daysUntilBday),
    [clients]
  )
  if (!upcoming.length) return null
  return (
    <div className="card bg-pink-50 border border-pink-200">
      <h3 className="font-semibold text-pink-800 mb-3">🎂 Birthdays This Week</h3>
      <div className="space-y-2">
        {upcoming.map(c => (
          <div key={c.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2">
            <div>
              <p className="text-sm font-semibold text-gray-800">{c.name}</p>
              <p className="text-xs text-gray-500">{c.mobile||'No mobile'}</p>
            </div>
            <span className={`text-xs font-bold px-2 py-1 rounded-lg ${c.daysUntilBday===0?'bg-pink-500 text-white':'bg-pink-100 text-pink-700'}`}>
              {c.daysUntilBday===0?'Today!🎉':`${c.daysUntilBday}d`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Cross-sell widget ─────────────────────────────────────────
function CrossSellWidget({ clients, policies }) {
  const gaps = useMemo(() => {
    const result = []
    clients.slice(0,50).forEach(client => {
      const clientPolicies = policies.filter(p=>p.clientId===client.id)
      const g = computeCoverageGaps(clientPolicies)
      if (g.length > 0) result.push({ client, gaps: g })
    })
    return result.slice(0, 6)
  }, [clients, policies])

  if (!gaps.length) return null
  return (
    <div className="card">
      <h3 className="font-semibold text-gray-800 mb-3">🎯 Cross-sell Opportunities</h3>
      <div className="space-y-2">
        {gaps.map(({ client, gaps: g }) => (
          <div key={client.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
            <span className="text-sm font-medium text-gray-800">{client.name}</span>
            <div className="flex gap-1 flex-wrap justify-end">
              {g.map(gap => (
                <span key={gap.id} className={`text-xs px-2 py-0.5 rounded-full font-medium ${gap.color}`}>
                  {gap.label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Today's Tasks widget ──────────────────────────────────────
function TasksWidget({ tasks, navigate }) {
  const todayTasks = useMemo(() =>
    tasks.filter(t => {
      if (t.done) return false
      if (!t.dueDate) return false
      const d = differenceInDays(parseISO(t.dueDate), today())
      return d <= 0
    }).slice(0,5),
    [tasks]
  )
  const PRIORITY_COLORS = { High:'text-red-600', Medium:'text-yellow-600', Low:'text-green-600' }
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800">📋 Today's Tasks</h3>
        <button onClick={()=>navigate('/tasks')} className="text-sm text-blue-600 hover:underline">View all →</button>
      </div>
      {todayTasks.length === 0
        ? <p className="text-gray-400 text-sm py-2">✅ No tasks due today!</p>
        : <div className="space-y-2">
            {todayTasks.map(t => (
              <div key={t.id} className="flex items-start gap-2 py-1.5 border-b border-gray-50 last:border-0">
                <span className={`text-xs font-bold mt-0.5 ${PRIORITY_COLORS[t.priority||'Medium']}`}>●</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 font-medium truncate">{t.title}</p>
                  {t.clientName&&<p className="text-xs text-gray-400">👤 {t.clientName}</p>}
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">{t.type}</span>
              </div>
            ))}
          </div>
      }
    </div>
  )
}

// ── Open Claims widget ────────────────────────────────────────
function ClaimsWidget({ claims, navigate }) {
  const open = useMemo(() => claims.filter(c=>!['Settled','Rejected'].includes(c.status)).slice(0,5), [claims])
  const STATUS_COLORS = {
    'Intimated':'bg-gray-100 text-gray-700','Documents Submitted':'bg-blue-100 text-blue-700',
    'Under Review':'bg-yellow-100 text-yellow-700','Approved':'bg-green-100 text-green-700',
  }
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800">🔍 Open Claims</h3>
        <button onClick={()=>navigate('/claims')} className="text-sm text-blue-600 hover:underline">View all →</button>
      </div>
      {open.length === 0
        ? <p className="text-gray-400 text-sm py-2">No open claims.</p>
        : <div className="space-y-2">
            {open.map(c=>(
              <div key={c.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-800">{c.clientName||'—'}</p>
                  <p className="text-xs text-gray-400">{c.claimType} · {c.policyNumber||'—'}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded font-semibold ${STATUS_COLORS[c.status]||'bg-gray-100 text-gray-600'}`}>{c.status}</span>
              </div>
            ))}
          </div>
      }
    </div>
  )
}

// ── Policy Year KPI ───────────────────────────────────────────
function PolicyYearKPI({ policies }) {
  const data = useMemo(() => {
    const yr1  = policies.filter(p=>!p.policyYear||p.policyYear===1).length
    const yr2p = policies.filter(p=>p.policyYear>1).length
    const fyComm = policies.filter(p=>!p.policyYear||p.policyYear===1).reduce((s,p)=>s+(parseFloat(p.premium)||0)*(parseFloat(p.fyCommission)||0)/100,0)
    const ryComm = policies.filter(p=>p.policyYear>1).reduce((s,p)=>s+(parseFloat(p.premium)||0)*(parseFloat(p.ryCommission)||0)/100,0)
    return { yr1, yr2p, fyComm, ryComm }
  }, [policies])

  return (
    <div className="card">
      <h3 className="font-semibold text-gray-800 mb-3">📊 Policy Year Split & Commission</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-blue-50 rounded-xl p-3">
          <p className="text-2xl font-bold text-blue-700">{data.yr1}</p>
          <p className="text-xs text-blue-600 font-medium">Year 1 Policies</p>
          <p className="text-xs text-blue-500 mt-0.5">FY Comm: {fmtCurrency(data.fyComm)}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-3">
          <p className="text-2xl font-bold text-green-700">{data.yr2p}</p>
          <p className="text-xs text-green-600 font-medium">Year 2+ Policies</p>
          <p className="text-xs text-green-500 mt-0.5">RY Comm: {fmtCurrency(data.ryComm)}</p>
        </div>
      </div>
      {(data.yr1+data.yr2p)>0 && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Year 1</span><span>Year 2+</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2.5 flex overflow-hidden">
            <div className="bg-blue-500 h-2.5 transition-all" style={{width:`${(data.yr1/(data.yr1+data.yr2p))*100}%`}} />
            <div className="bg-green-500 h-2.5 transition-all" style={{width:`${(data.yr2p/(data.yr1+data.yr2p))*100}%`}} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Anniversary Widget ────────────────────────────────────────
function AnniversaryWidget({ policies }) {
  const upcoming = useMemo(() =>
    policies.filter(p => p.status==='Active' && isPolicyAnniversarySoon(p.startDate))
            .map(p => {
              const sd  = parseISO(p.startDate)
              const now = today()
              const ann = new Date(now.getFullYear(), sd.getMonth(), sd.getDate())
              return { ...p, daysUntilAnn: differenceInDays(ann, now) }
            })
            .sort((a,b)=>a.daysUntilAnn-b.daysUntilAnn)
            .slice(0,5),
    [policies]
  )
  if (!upcoming.length) return null
  return (
    <div className="card bg-amber-50 border border-amber-200">
      <h3 className="font-semibold text-amber-800 mb-3">🔔 Policy Anniversaries (next 30d)</h3>
      <div className="space-y-2">
        {upcoming.map(p=>(
          <div key={p.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2">
            <div>
              <p className="text-sm font-semibold text-gray-800">{p.clientName||'—'}</p>
              <p className="text-xs text-gray-500">{p.policyType} · {p.insurer}</p>
            </div>
            <span className={`text-xs font-bold px-2 py-1 rounded-lg ${p.daysUntilAnn===0?'bg-amber-500 text-white':'bg-amber-100 text-amber-700'}`}>
              {p.daysUntilAnn===0?'Today!':''+p.daysUntilAnn+'d'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────
export default function DashboardPage() {
  const { clients,  loading: cl } = useClients()
  const { policies, loading: pl } = usePolicies()
  const navigate = useNavigate()
  const [tasks,  setTasks]  = useState([])
  const [claims, setClaims] = useState([])

  useEffect(() => {
    const u1 = subscribeTasks(setTasks)
    const u2 = subscribeClaims(setClaims)
    return () => { u1(); u2() }
  }, [])

  const stats = useMemo(() => {
    const active     = policies.filter(p=>p.status==='Active')
    const expiring30 = policies.filter(p=>{ const d=daysUntil(p.expiryDate); return d!==null&&d>=0&&d<=30 })
    const totalPrem  = active.reduce((s,p)=>s+(parseFloat(p.premium)||0),0)
    const openClaims = claims.filter(c=>!['Settled','Rejected'].includes(c.status)).length
    const overdueTasks = tasks.filter(t=>!t.done&&t.dueDate&&differenceInDays(parseISO(t.dueDate),today())<0).length
    const crossSellCount = clients.filter(c=>{
      const cp = policies.filter(p=>p.clientId===c.id)
      return computeCoverageGaps(cp).length > 0
    }).length
    return { active, expiring30, totalPrem, openClaims, overdueTasks, crossSellCount }
  }, [policies, claims, tasks, clients])

  const doughnutData = useMemo(() => {
    const types = {}
    policies.filter(p=>p.status==='Active').forEach(p=>{ const t=p.policyType||'Other'; types[t]=(types[t]||0)+1 })
    return {
      labels: Object.keys(types),
      datasets:[{ data:Object.values(types), backgroundColor:['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#f97316','#06b6d4'], borderWidth:0 }]
    }
  }, [policies])

  const barData = useMemo(() => {
    const now=today()
    const labels=[];const counts=[];const prems=[]
    for(let i=0;i<6;i++){
      const d=addDays(now,i*30)
      labels.push(format(d,'MMM yy'))
      const inMonth=policies.filter(p=>{if(!p.expiryDate)return false;const diff=daysUntil(p.expiryDate);return diff!==null&&diff>=i*30&&diff<(i+1)*30})
      counts.push(inMonth.length)
      prems.push(Math.round(inMonth.reduce((s,p)=>s+(parseFloat(p.premium)||0),0)/1000))
    }
    return {
      labels,
      datasets:[
        {label:'Renewals',data:counts,backgroundColor:'#3b82f6',borderRadius:6,yAxisID:'y'},
        {label:'Premium ₹K',data:prems,backgroundColor:'#10b981',borderRadius:6,yAxisID:'y1'},
      ]
    }
  }, [policies])

  const urgentRenewals = useMemo(() =>
    policies.filter(p=>{ const d=daysUntil(p.expiryDate); return d!==null&&d<=60 })
            .sort((a,b)=>daysUntil(a.expiryDate)-daysUntil(b.expiryDate))
            .slice(0,10),
    [policies]
  )

  if (cl||pl) return (
    <div className="p-8 flex items-center gap-3 text-gray-500">
      <div className="w-6 h-6 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
      Loading dashboard…
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Welcome back · {format(today(),'EEEE, dd MMMM yyyy')}</p>
      </div>

      {/* Primary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="👥" label="Total Clients"  value={clients.length}
                  sub={`${clients.filter(c=>c.kycStatus==='Complete').length} KYC complete`}
                  color="blue" onClick={()=>navigate('/clients')} />
        <StatCard icon="📋" label="Active Policies" value={stats.active.length}
                  sub={`${policies.length} total`}
                  color="green" onClick={()=>navigate('/policies')} />
        <StatCard icon="🔔" label="Due in 30 Days" value={stats.expiring30.length}
                  sub="Renewals upcoming"
                  color="yellow" onClick={()=>navigate('/renewals')} />
        <StatCard icon="💰" label="Total Premium" value={fmtCurrency(stats.totalPrem)}
                  sub="Under management" color="purple" />
      </div>

      {/* Secondary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon="🔍" label="Open Claims"  value={stats.openClaims}
                  sub="Active claims" color="orange"
                  badge={stats.openClaims} onClick={()=>navigate('/claims')} />
        <StatCard icon="📋" label="Overdue Tasks" value={stats.overdueTasks}
                  sub="Need attention" color="red"
                  badge={stats.overdueTasks} onClick={()=>navigate('/tasks')} />
        <StatCard icon="🎯" label="Cross-sell Leads" value={stats.crossSellCount}
                  sub="Clients with coverage gaps" color="blue"
                  onClick={()=>navigate('/clients')} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-2">
          <h3 className="font-semibold text-gray-800 mb-4">📅 Renewals & Premium — Next 6 Months</h3>
          <Bar data={barData} options={{responsive:true,plugins:{legend:{position:'top'}},
            scales:{y:{position:'left',title:{display:true,text:'Policies'}},
                    y1:{position:'right',title:{display:true,text:'Premium ₹K'},grid:{drawOnChartArea:false}}}}} />
        </div>
        <div className="card flex flex-col items-center">
          <h3 className="font-semibold text-gray-800 mb-4 self-start">🗂️ Policies by Type</h3>
          {policies.length>0
            ? <Doughnut data={doughnutData} options={{plugins:{legend:{position:'bottom'}},cutout:'65%'}} />
            : <p className="text-gray-400 text-sm mt-8">No policies yet</p>}
        </div>
      </div>

      {/* 3-column widgets */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <TasksWidget tasks={tasks} navigate={navigate} />
        <ClaimsWidget claims={claims} navigate={navigate} />
        <PolicyYearKPI policies={policies} />
      </div>

      {/* Birthday + Anniversary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BirthdayWidget clients={clients} />
        <AnniversaryWidget policies={policies} />
      </div>

      {/* Cross-sell */}
      <CrossSellWidget clients={clients} policies={policies} />

      {/* Urgent renewals */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">⚠️ Upcoming & Overdue Renewals</h3>
          <button onClick={()=>navigate('/renewals')} className="text-sm text-blue-600 hover:underline">View all →</button>
        </div>
        {urgentRenewals.length===0
          ? <p className="text-gray-400 text-sm py-4">🎉 No urgent renewals right now!</p>
          : <div className="table-container">
              <table className="min-w-full"><thead><tr>
                {['Client','Policy No','Type','Insurer','Expiry','Days','Premium'].map(h=>(
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr></thead>
              <tbody className="bg-white">
                {urgentRenewals.map(p=><RenewalRow key={p.id} policy={p} />)}
              </tbody></table>
            </div>
        }
      </div>
    </div>
  )
}
