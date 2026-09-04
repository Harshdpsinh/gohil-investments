import { useCallback, useMemo, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { differenceInDays, format, startOfDay, subMonths } from 'date-fns'
import toast from 'react-hot-toast'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement,
  Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { useClients } from '../hooks/useClients'
import { usePolicies } from '../hooks/usePolicies'
import { fmtCurrency, fmtDate, fmtDateTime, parseAnyDate, daysUntilPolicyDue } from '../utils/dateUtils'
import { subscribeClaims } from '../firebase/firestore'
import { computeCoverageGaps } from '../utils/policySchemas'
import { openWhatsAppLink } from '../services/whatsappService'
import { bookSnapshot, isAutoWaOnPdfEnabled, setAutoWaOnPdfEnabled } from '../utils/opsSnapshot'
import AppIcon from '../components/ui/AppIcon'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const isActivePolicy = p => !['Renewed-Out', 'Cancelled', 'Matured'].includes((p.status || '').trim())

function isBirthdayThisWeek(dobStr, today) {
  const dob = parseAnyDate(dobStr)
  if (!dob) return false
  const bday = new Date(today.getFullYear(), dob.getMonth(), dob.getDate())
  const diff = differenceInDays(bday, today)
  if (diff >= 0 && diff <= 7) return true
  const nextDiff = differenceInDays(new Date(today.getFullYear() + 1, dob.getMonth(), dob.getDate()), today)
  return nextDiff >= 0 && nextDiff <= 7
}

function StatCard({ icon, label, value, color = 'blue', onClick, badge }) {
  const wells = {
    blue: 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
    yellow: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
    red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
    orange: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200',
    violet: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200',
  }
  return (
    <div className={`stat-card group relative ${onClick ? 'cursor-pointer' : ''}`} onClick={onClick}>
      {badge > 0 && <span className="absolute right-3 top-3 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{badge}</span>}
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${wells[color] || wells.blue}`}>
        <AppIcon name={icon} size={21} />
      </div>
      <div className="relative z-[1] min-w-0">
        <p className="text-[26px] font-bold leading-none tabular-nums text-slate-950 dark:text-slate-100">{value}</p>
        <p className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</p>
      </div>
    </div>
  )
}

function RupeeCard({ label, amount, count, note, onClick }) {
  const shown = fmtCurrency(amount)
  return (
    <button type="button" onClick={onClick} className="gi-kpi cursor-pointer" title={shown}>
      <p className="gi-kpi-label">{label}</p>
      <p className="gi-kpi-value">{shown}</p>
      <p className="gi-kpi-note">
        {count} polic{count === 1 ? 'y' : 'ies'}
        {note ? ` · ${note}` : ''}
      </p>
    </button>
  )
}

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#94a3b8' } },
    y: { grid: { color: 'rgba(148,163,184,0.1)' }, ticks: { font: { size: 11 }, color: '#94a3b8' } },
  },
}

const DOUGHNUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12, color: '#94a3b8' } } },
  cutout: '65%',
}

const HOME_TILES = [
  { to: '/renewals', icon: 'renewals', label: 'Renewals', hint: 'Due this month' },
  { to: '/business', icon: 'work', label: 'Business', hint: 'Written this FY' },
  { to: '/reports', icon: 'reports', label: 'Reports', hint: 'Company · product' },
  { to: '/wishes', icon: 'sparkles', label: 'Wishes', hint: 'Birthdays · anniversaries' },
]

export default function DashboardPage() {
  const { clients } = useClients()
  const { policies, loading } = usePolicies()
  const navigate = useNavigate()
  const [claims, setClaims] = useState([])
  const [autoWaPdf, setAutoWaPdf] = useState(() => isAutoWaOnPdfEnabled())
  const now = new Date()
  const today = startOfDay(now)

  useEffect(() => subscribeClaims(setClaims, err => console.error('Dashboard claims subscription failed:', err)), [])

  const openWA = useCallback((policy) => {
    const client = clients.find(c => c.id === policy.clientId)
      || clients.find(c => c.name?.toLowerCase().trim() === (policy.clientName || '').toLowerCase().trim())
    if (!client?.mobile) {
      toast.error('No mobile number found for this client.')
      return
    }
    const days = daysUntilPolicyDue(policy)
    const msg =
      `Dear ${policy.clientName},\n\n` +
      `Your ${policy.policyType || 'Insurance'} policy (${policy.policyNumber}) with ${policy.insurer || 'your insurer'} premium is due` +
      `${days !== null && days >= 0 ? ` in ${days} days` : ' - please renew urgently'}.\n\n` +
      `Please contact us for renewal.\n\n` +
      `Gohil Investments\nWealth Management & Insurance Advisory\n` +
      `Harshdipsinh Gohil - 7698997894\n` +
      `Pradipsinh Gohil - 9426204547\nBhavnagar, Gujarat`
    try {
      openWhatsAppLink({ mobile: client.mobile, message: msg })
    } catch (err) {
      toast.error(err.message || 'Could not open WhatsApp.')
    }
  }, [clients])

  const EMPTY_BOOK = { fy: { label: 'This FY' }, month: { label: 'This month' }, yearlyPremium: 0, yearlyCount: 0, monthPremium: 0, monthCount: 0, monthRenewalPremium: 0, monthRenewalCount: 0, lastUpdated: null }

  const book = useMemo(() => {
    try { return bookSnapshot(policies || [], now) }
    catch (err) {
      console.error('Home rupee snapshot failed:', err)
      return EMPTY_BOOK
    }
  }, [policies])

  const stats = useMemo(() => {
    const active = policies.filter(isActivePolicy)
    const expiring30 = active.filter(p => { const d = daysUntilPolicyDue(p); return d !== null && d >= 0 && d <= 30 })
    const expired = active.filter(p => { const d = daysUntilPolicyDue(p); return d !== null && d < 0 })
    const byType = {}
    active.forEach(p => { byType[p.policyType || 'Other'] = (byType[p.policyType || 'Other'] || 0) + 1 })

    const months = Array.from({ length: 6 }, (_, i) => {
      const d = subMonths(today, 5 - i)
      return { label: format(d, 'MMM yy'), count: 0 }
    })
    const monthIndex = Object.fromEntries(months.map((m, i) => [m.label, i]))
    policies.forEach(p => {
      const d = parseAnyDate(p.createdAt || p.startDate)
      if (!d) return
      const idx = monthIndex[format(d, 'MMM yy')]
      if (idx !== undefined) months[idx].count += 1
    })

    const clientsWithGaps = clients.filter(c => computeCoverageGaps(active.filter(p => p.clientId === c.id)).length > 0)
    return {
      active: active.length,
      expiring30: expiring30.length,
      expired: expired.length,
      clients: clients.length,
      totalPremium: active.reduce((sum, p) => sum + (parseFloat(p.premium) || 0), 0),
      birthdays: clients.filter(c => isBirthdayThisWeek(c.dob, today)),
      openClaims: claims.filter(c => !['Settled', 'Rejected'].includes(c.status)),
      byType,
      monthly: months,
      clientsWithGaps: clientsWithGaps.length,
    }
  }, [policies, clients, claims])

  const urgent = useMemo(() =>
    policies
      .filter(p => { const d = daysUntilPolicyDue(p); return d !== null && d >= 0 && d <= 7 && isActivePolicy(p) })
      .sort((a, b) => (daysUntilPolicyDue(a) || 0) - (daysUntilPolicyDue(b) || 0)),
    [policies]
  )

  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening'
  const typeColors = ['#0f766e', '#0ea5e9', '#d97706', '#059669', '#7c3aed', '#64748b']

  if (loading) {
    return (
      <div className="fintech-page space-y-4 sm:space-y-5">
        <div className="fintech-header border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <p className="fintech-kicker">Gohil Investments · Bhavnagar</p>
            <h1 className="fintech-title">{greeting}, Harshdip</h1>
            <p className="fintech-subtitle">Opening your book…</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="commission-skeleton h-24 rounded-xl" />)}
        </div>
        <button type="button" className="btn-secondary text-xs" onClick={() => window.location.reload()}>Retry</button>
      </div>
    )
  }

  return (
    <div className="fintech-page space-y-4 sm:space-y-5">
      <div className="fintech-header border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <p className="fintech-kicker">Gohil Investments · Bhavnagar</p>
          <h1 className="fintech-title">{greeting}, Harshdip</h1>
          <p className="fintech-subtitle">
            {fmtDate(now)} · Portfolio operations overview
            {book.lastUpdated ? ` · Last updated ${fmtDateTime(book.lastUpdated)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => navigate('/clients')} className="btn-secondary">Add Client</button>
          <button onClick={() => navigate('/policies')} className="btn-primary">Add Policy from PDF</button>
          <button onClick={() => navigate('/pipeline')} className="btn-secondary">Pipeline</button>
          <button onClick={() => navigate('/installments')} className="btn-secondary">Installments</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <RupeeCard
          label={`Yearly · ${book.fy.label}`}
          amount={book.yearlyPremium}
          count={book.yearlyCount}
          onClick={() => navigate('/business')}
        />
        <RupeeCard
          label={`This month · ${book.month.label}`}
          amount={book.monthPremium}
          count={book.monthCount}
          onClick={() => navigate('/business')}
        />
        <RupeeCard
          label="This month renewal"
          amount={book.monthRenewalPremium}
          count={book.monthRenewalCount}
          note="of month written"
          onClick={() => navigate('/business')}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {HOME_TILES.map(tile => (
          <button
            key={tile.to}
            type="button"
            onClick={() => navigate(tile.to)}
            className="gi-bento-tile min-h-[88px]"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 text-teal-800 dark:bg-teal-950/50 dark:text-teal-200">
              <AppIcon name={tile.icon} size={18} />
            </span>
            <span className="text-sm font-extrabold text-slate-950 dark:text-white">{tile.label}</span>
            <span className="text-[11px] text-slate-500">{tile.hint}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => navigate('/calendar')}
        className="text-left text-xs font-semibold text-teal-800 hover:underline dark:text-teal-300"
      >
        Premium calendar — booked vs due this month
      </button>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard icon="clients" label="Clients" value={stats.clients} onClick={() => navigate('/clients')} />
        <StatCard icon="policies" label="Active Policies" value={stats.active} color="green" onClick={() => navigate('/policies')} />
        <StatCard icon="renewals" label="Expiring (30d)" value={stats.expiring30} color="yellow" onClick={() => navigate('/renewals')} badge={stats.expiring30} />
        <StatCard icon="warning" label="Overdue" value={stats.expired} color="red" onClick={() => navigate('/renewals')} badge={stats.expired} />
        <StatCard icon="claims" label="Open Claims" value={stats.openClaims.length} color="orange" onClick={() => navigate('/claims')} badge={stats.openClaims.length} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="stat-card"><div><p className="text-xl font-bold tabular-nums">{fmtCurrency(stats.totalPremium)}</p><p className="text-xs text-gray-500">Premium Under Management</p></div></div>
        {stats.birthdays.length > 0 && (
          <button className="gi-bento-tile min-h-0" onClick={() => navigate('/wishes')}>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Birthdays this week</p>
            <p className="text-xs text-slate-500" title={stats.birthdays.map(c => c.name).join(', ')}>{stats.birthdays.slice(0, 3).map(c => c.name).join(', ')}</p>
          </button>
        )}
        {stats.clientsWithGaps > 0 && (
          <button className="gi-bento-tile min-h-0" onClick={() => navigate('/cross-sell')}>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{stats.clientsWithGaps} clients with coverage gaps</p>
            <p className="text-xs text-slate-500">Open the coverage-gap list to message them</p>
          </button>
        )}
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900">
        <input
          type="checkbox"
          className="mt-1"
          checked={autoWaPdf}
          onChange={event => {
            setAutoWaOnPdfEnabled(event.target.checked)
            setAutoWaPdf(event.target.checked)
          }}
        />
        <span>
          <span className="font-bold text-slate-800 dark:text-slate-100">WhatsApp the PDF after upload</span>
          <span className="mt-0.5 block text-xs text-slate-500">Off by default. When on, uploading a policy PDF also opens WhatsApp with the document link. Does not send by itself.</span>
        </span>
      </label>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">Policies by Type</p>
          <div style={{ height: 180 }}>
            <Doughnut
              data={{ labels: Object.keys(stats.byType), datasets: [{ data: Object.values(stats.byType), backgroundColor: typeColors, borderWidth: 2 }] }}
              options={DOUGHNUT_OPTS}
            />
          </div>
        </div>
        <div className="card">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">New Policies (6 months)</p>
          <div style={{ height: 180 }}>
            <Bar
              data={{ labels: stats.monthly.map(m => m.label), datasets: [{ label: 'Policies', data: stats.monthly.map(m => m.count), backgroundColor: '#0f766e', borderRadius: 4 }] }}
              options={CHART_OPTS}
            />
          </div>
        </div>
      </div>

      {urgent.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-800 dark:text-white">Expiring This Week ({urgent.length})</h2>
            <button onClick={() => navigate('/renewals')} className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300">View all</button>
          </div>
          <div className="space-y-2">
            {urgent.slice(0, 8).map(p => {
              const d = daysUntilPolicyDue(p)
              return (
                <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100" title={p.clientName}>{p.clientName}</p>
                    <p className="text-xs text-slate-500">{p.policyNumber} · {p.insurer}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-right">
                    <span className={d === 0 ? 'badge-red' : 'badge-yellow'}>{d === 0 ? 'Today' : `${d}d`}</span>
                    <p className="text-xs tabular-nums text-slate-500">{fmtCurrency(p.premium)}</p>
                    <button onClick={() => openWA(p)} className="btn-whatsapp px-2 py-0.5 text-xs">WA</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
