// src/pages/PipelineDashboard.jsx
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PipelineCanvas from '../three/PipelineCanvas'
import { STAGES, THEMES, stageForDays } from '../three/pipelineTheme'
import { usePolicies } from '../hooks/usePolicies'
import { daysUntilPolicyDue, fmtCurrency } from '../utils/dateUtils'

const MAX_CARDS = 16

const prefersCalm =
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

export default function PipelineDashboard() {
  const { policies = [] } = usePolicies()
  const [themeName, setThemeName] = useState('neon')
  const [selected, setSelected] = useState(null)
  const theme = THEMES[themeName]

  // Nearest renewals first, so the board shows what actually needs attention.
  const deals = useMemo(() => {
    return [...policies]
      .filter(p => !p.deleted)
      .map(p => ({ p, days: daysUntilPolicyDue(p) }))
      .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999))
      .slice(0, MAX_CARDS)
      .map(({ p, days }) => ({
        id: p.id,
        client: p.clientName || 'Unknown client',
        policyNumber: p.policyNumber || '—',
        amount: fmtCurrency(p.premium),
        stage: stageForDays(days),
        days,
      }))
  }, [policies])

  const revenue = useMemo(
    () => policies.reduce((sum, p) => sum + (Number(p.premium) || 0), 0),
    [policies]
  )

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden" style={{ background: theme.bg }}>
      <PipelineCanvas
        deals={deals}
        themeName={themeName}
        calm={prefersCalm}
        onSelect={setSelected}
      />

      {/* pointer-events-none lets drags reach the canvas; panels re-enable it. */}
      <div className="pointer-events-none absolute inset-0 p-3 lg:p-6">
        <aside
          className={`pointer-events-auto w-full rounded-3xl border p-5 shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-2xl lg:absolute lg:left-6 lg:top-6 lg:w-80 ${theme.glass}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold tracking-[0.18em]" style={{ color: theme.sub }}>
                GOHIL INVESTMENTS
              </p>
              <h1 className="text-xl font-extrabold" style={{ color: theme.text }}>Pipeline</h1>
            </div>
            <button
              onClick={() => setThemeName(t => (t === 'neon' ? 'frost' : 'neon'))}
              className="shrink-0 rounded-full border border-white/20 px-3 py-1 text-xs font-semibold"
              style={{ color: theme.text }}
            >
              {themeName === 'neon' ? 'Frost' : 'Neon'}
            </button>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-3">
            <Stat label="TOTAL REVENUE" value={fmtCurrency(revenue)} theme={theme} />
            <Stat label="ACTIVE LEADS" value={deals.length} theme={theme} />
          </dl>

          <ul className="mt-5 space-y-2">
            {STAGES.map(stage => (
              <li key={stage.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2" style={{ color: theme.sub }}>
                  <i className="h-2 w-2 rounded-full" style={{ background: stage.color }} />
                  {stage.id}
                </span>
                <span className="font-bold" style={{ color: theme.text }}>
                  {deals.filter(d => d.stage === stage.id).length}
                </span>
              </li>
            ))}
          </ul>

          <Link
            to="/renewals"
            className="mt-5 block rounded-xl border border-white/20 py-2 text-center text-sm font-semibold"
            style={{ color: theme.text }}
          >
            Back to Renewals
          </Link>
        </aside>

        {selected && (
          <aside
            className={`pointer-events-auto absolute bottom-3 right-3 w-[calc(100%-1.5rem)] rounded-3xl border p-5 backdrop-blur-2xl lg:bottom-6 lg:right-6 lg:w-72 ${theme.glass}`}
          >
            <p className="font-mono text-xs font-semibold" style={{ color: theme.sub }}>
              {selected.policyNumber}
            </p>
            <p className="mt-1 text-lg font-extrabold" style={{ color: theme.text }}>
              {selected.client}
            </p>
            <p className="mt-2 text-2xl font-black" style={{ color: theme.key }}>
              {selected.amount}
            </p>
            <p className="mt-1 text-xs" style={{ color: theme.sub }}>
              {selected.days === null
                ? 'No due date'
                : selected.days < 0
                  ? `${Math.abs(selected.days)} days overdue`
                  : `Due in ${selected.days} days`}
            </p>
            <button
              onClick={() => setSelected(null)}
              className="mt-4 w-full rounded-xl border border-white/20 py-2 text-sm font-semibold"
              style={{ color: theme.text }}
            >
              Close
            </button>
          </aside>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, theme }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <dt className="text-[10px] font-bold tracking-wider" style={{ color: theme.sub }}>{label}</dt>
      <dd className="mt-1 text-lg font-extrabold" style={{ color: theme.text }}>{value}</dd>
    </div>
  )
}
