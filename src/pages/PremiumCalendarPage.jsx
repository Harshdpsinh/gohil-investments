import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePolicies } from '../hooks/usePolicies'
import { fmtCurrency, fmtDate } from '../utils/dateUtils'
import { calendarMonth } from '../utils/opsSnapshot'
import PageHeader from '../components/ui/PageHeader'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function PremiumCalendarPage() {
  const { policies, loading } = usePolicies()
  const navigate = useNavigate()
  const now = new Date()
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [picked, setPicked] = useState(now.getDate())

  const cal = useMemo(
    () => calendarMonth(policies, cursor.year, cursor.month),
    [policies, cursor.year, cursor.month],
  )
  const day = cal.days[picked] || { booked: 0, due: 0, bookedCount: 0, dueCount: 0, bookedRows: [], dueRows: [] }
  const startPad = new Date(cursor.year, cursor.month, 1).getDay()
  const title = `${MONTHS[cursor.month]} ${cursor.year}`

  const shift = delta => {
    const next = new Date(cursor.year, cursor.month + delta, 1)
    setCursor({ year: next.getFullYear(), month: next.getMonth() })
    setPicked(1)
  }

  if (loading) return <div className="p-8 text-slate-400">Loading calendar...</div>

  return (
    <div className="fintech-page space-y-4">
      <PageHeader
        icon="clock"
        title="Premium calendar"
        subtitle="Booked = policy start in this month. Due = existing renewal due date. Read-only."
      />

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <button type="button" className="btn-secondary text-xs" onClick={() => shift(-1)}>Prev</button>
          <p className="text-sm font-extrabold">{title}</p>
          <button type="button" className="btn-secondary text-xs" onClick={() => shift(1)}>Next</button>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
            <p className="font-bold text-slate-500">Booked</p>
            <p className="font-extrabold">{fmtCurrency(cal.totals.booked)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
            <p className="font-bold text-slate-500">Due</p>
            <p className="font-extrabold">{fmtCurrency(cal.totals.due)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
            <p className="font-bold text-slate-500">Policies</p>
            <p className="font-extrabold">{cal.totals.bookedCount + cal.totals.dueCount}</p>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-slate-400">
          {WEEKDAYS.map(dayName => <div key={dayName}>{dayName}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: startPad }, (_, i) => <div key={`pad-${i}`} />)}
          {Array.from({ length: cal.last }, (_, i) => {
            const n = i + 1
            const cell = cal.days[n]
            const active = n === picked
            return (
              <button
                key={n}
                type="button"
                onClick={() => setPicked(n)}
                className={`min-h-12 rounded-lg border p-1 text-xs ${
                  active
                    ? 'border-teal-600 bg-teal-50 dark:border-teal-400 dark:bg-teal-950/40'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <span className="font-bold">{n}</span>
                {cell.bookedCount > 0 && <span className="mt-0.5 block h-1.5 w-1.5 rounded-full bg-teal-600 mx-auto" />}
                {cell.dueCount > 0 && <span className="mt-0.5 block h-1.5 w-1.5 rounded-full bg-amber-500 mx-auto" />}
              </button>
            )
          })}
        </div>
      </div>

      <div className="card space-y-3">
        <p className="text-sm font-bold">{fmtDate(new Date(cursor.year, cursor.month, picked))}</p>
        <DayGroup
          title={`Booked (${day.bookedCount}) · ${fmtCurrency(day.booked)}`}
          rows={day.bookedRows}
          empty="Nothing started this day."
          onOpen={id => navigate('/policies')}
        />
        <DayGroup
          title={`Due (${day.dueCount}) · ${fmtCurrency(day.due)}`}
          rows={day.dueRows}
          empty="Nothing due this day."
          onOpen={() => navigate('/renewals')}
        />
      </div>
    </div>
  )
}

function DayGroup({ title, rows, empty, onOpen }) {
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {rows.map(policy => (
            <li key={policy.id}>
              <button type="button" className="w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800" onClick={onOpen}>
                <span className="font-semibold">{policy.clientName}</span>
                <span className="ml-2 text-xs text-slate-500">{policy.policyNumber} · {fmtCurrency(policy.premium)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
