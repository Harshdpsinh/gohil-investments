// src/pages/BusinessDonePage.jsx
// Production report: what was written in a period, split into new business and
// renewals, broken down by category, company, month and client.
//
// Reads the policy book, not the commission ledger — insurer statements land
// 30-90 days late, so a ledger-driven report would always understate the
// current month and keep revising itself afterwards.
import { useMemo, useState } from 'react'
import { usePolicies } from '../hooks/usePolicies'
import { exportToCSV, exportToExcel } from '../utils/exportUtils'
import { fmtCurrency, fmtDate } from '../utils/dateUtils'
import {
  GROUP_KEYS,
  PERIOD_PRESETS,
  groupBusiness,
  isRenewalPolicy,
  periodRange,
  policiesInPeriod,
  renewalRatio,
  summariseBusiness,
  yearOnYear,
} from '../utils/businessDone'
import { duplicateInsurers } from '../utils/insurers'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/ui/EmptyState'
import toast from 'react-hot-toast'

const VIEWS = [
  ['category', 'Category-wise'],
  ['company', 'Company-wise'],
  ['month', 'Month-wise'],
  ['client', 'Client-wise'],
]

// Every column the owner needs to tick off a row by hand against an insurer's
// own statement. Exported verbatim to Excel.
const POLICY_COLS = [
  { header: 'Business',    accessor: r => (isRenewalPolicy(r) ? 'Renewal' : 'New Business') },
  { header: 'Start Date',  accessor: r => fmtDate(r.startDate) },
  { header: 'Policy No',   accessor: r => r.policyNumber || '' },
  { header: 'Client',      accessor: r => r.clientName || '' },
  { header: 'Category',    accessor: r => r.policyType || '' },
  { header: 'Company',     accessor: r => r.insurer || '' },
  { header: 'Plan',        accessor: r => r.planName || '' },
  { header: 'Premium',     accessor: r => Number(r.premium) || 0 },
  { header: 'Policy Year', accessor: r => Number(r.policyYear) || 1 },
  { header: 'Premium Collected', accessor: r => (r.lastPremiumPaidAt ? 'Yes' : 'Not marked') },
  { header: 'Status',      accessor: r => r.status || '' },
  { header: 'Expiry',      accessor: r => fmtDate(r.expiryDate) },
]

const BREAKDOWN_COLS = [
  { header: 'Group',            accessor: r => r.key },
  { header: 'New Business Qty', accessor: r => r.freshCount },
  { header: 'New Business ₹',   accessor: r => r.freshPremium },
  { header: 'Renewal Qty',      accessor: r => r.renewalCount },
  { header: 'Renewal ₹',        accessor: r => r.renewalPremium },
  { header: 'Total Qty',        accessor: r => r.count },
  { header: 'Total Premium ₹',  accessor: r => r.premium },
  { header: 'Share %',          accessor: r => r.sharePct },
]

const pct = value => (value === null ? '—' : `${value > 0 ? '+' : ''}${value}%`)

export default function BusinessDonePage() {
  const { policies, loading, error } = usePolicies()
  const [preset, setPreset] = useState('This FY')
  const [view, setView] = useState('category')
  const [custom, setCustom] = useState({ from: '', to: '' })

  // A complete custom range wins over the preset; a half-filled one is ignored
  // rather than silently reporting on an open-ended window.
  const range = useMemo(() => {
    if (custom.from && custom.to) {
      return { from: custom.from, to: custom.to, label: `${fmtDate(custom.from)} – ${fmtDate(custom.to)}` }
    }
    return periodRange(preset)
  }, [preset, custom])

  const summary = useMemo(() => summariseBusiness(policies, range), [policies, range])
  const ratio = useMemo(() => renewalRatio(policies, range), [policies, range])
  const yoy = useMemo(() => yearOnYear(policies, range), [policies, range])
  const breakdown = useMemo(
    () => groupBusiness(policies, range, GROUP_KEYS[view]),
    [policies, range, view]
  )
  const periodPolicies = useMemo(() => policiesInPeriod(policies, range), [policies, range])
  // Whole book, not just this period — a spelling that needs fixing is worth
  // knowing about whenever it was entered.
  const dupes = useMemo(() => duplicateInsurers(policies.map(p => p.insurer)), [policies])

  const slug = `business-done-${range.from}-to-${range.to}`
  const download = async (kind, format) => {
    const [rows, cols, sheet] = kind === 'policies'
      ? [periodPolicies, POLICY_COLS, 'Business Done']
      : [breakdown, BREAKDOWN_COLS, VIEWS.find(([key]) => key === view)[1]]
    if (!rows.length) return toast.error('Nothing to download for this period.')
    try {
      const name = kind === 'policies' ? slug : `${slug}-${view}`
      if (format === 'excel') await exportToExcel(rows, cols, sheet, name)
      else await exportToCSV(rows, cols, name)
      toast.success('Download ready.')
    } catch (err) {
      toast.error(err.message || 'Could not build the file.')
    }
  }

  const maxPremium = Math.max(...breakdown.map(row => row.premium), 1)

  if (loading) {
    return (
      <div className="fintech-page space-y-4">
        <div className="commission-skeleton h-8 w-64" />
        <div className="commission-command-grid">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="fintech-panel space-y-3 p-4"><div className="commission-skeleton h-3 w-24" /><div className="commission-skeleton h-7 w-32" /></div>)}
        </div>
        <div className="fintech-panel space-y-3 p-5">{Array.from({ length: 6 }, (_, i) => <div key={i} className="commission-skeleton h-10 w-full" />)}</div>
      </div>
    )
  }

  return (
    <div className="fintech-page space-y-4 sm:space-y-5">
      <PageHeader
        icon="work"
        title="Business Done"
        subtitle={`${range.label} · ${summary.total} policies written`}
        actions={
          <>
            <button className="btn-primary text-xs" onClick={() => download('policies', 'excel')}>⬇ Excel (policy list)</button>
            <button className="btn-secondary text-xs" onClick={() => download('breakdown', 'excel')}>⬇ Excel (breakdown)</button>
            <button className="btn-secondary text-xs" onClick={() => download('policies', 'csv')}>⬇ CSV</button>
          </>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          <strong>Could not load policies.</strong> {error.message || String(error)}
        </div>
      )}

      {dupes.length > 0 && (
        <details className="fintech-panel p-3 text-xs sm:p-4">
          <summary className="cursor-pointer font-bold text-amber-700 dark:text-amber-300">
            {dupes.length} insurance {dupes.length === 1 ? 'company is' : 'companies are'} spelled more than one way
          </summary>
          <p className="mt-2 text-gray-600 dark:text-gray-300">
            These are counted as one company in every report below. Fixing the spelling on the
            policies themselves is optional — nothing here changes your records.
          </p>
          <ul className="mt-2 space-y-1">
            {dupes.map(dupe => (
              <li key={dupe.canonical}>
                <span className="font-semibold">{dupe.canonical}</span>
                <span className="text-gray-500"> ← {dupe.variants.join(' · ')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Period */}
      <div className="fintech-panel flex flex-wrap items-center gap-2 p-3 sm:p-4">
        <div className="commission-segmented">
          {PERIOD_PRESETS.map(name => (
            <button
              key={name}
              className={!custom.from && !custom.to && preset === name ? 'active' : ''}
              onClick={() => { setPreset(name); setCustom({ from: '', to: '' }) }}
            >{name}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <input type="date" value={custom.from} className="form-input w-auto text-xs"
                 onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} />
          <span className="text-gray-500">to</span>
          <input type="date" value={custom.to} className="form-input w-auto text-xs"
                 onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} />
          {(custom.from || custom.to) && (
            <button className="font-bold text-blue-600 dark:text-blue-400" onClick={() => setCustom({ from: '', to: '' })}>Clear</button>
          )}
        </div>
      </div>

      {/* Headline numbers */}
      <div className="commission-command-grid">
        {[
          { label: 'New business', val: summary.freshCount, note: fmtCurrency(summary.freshPremium), tone: 'text-blue-600 dark:text-blue-400', delta: yoy.growth.freshCount },
          { label: 'Renewals done', val: summary.renewalCount, note: fmtCurrency(summary.renewalPremium), tone: 'text-emerald-600 dark:text-emerald-400', delta: yoy.growth.renewalCount },
          { label: 'Total policies', val: summary.total, note: fmtCurrency(summary.totalPremium), delta: yoy.growth.total },
          { label: 'Renewal ratio', val: `${ratio.ratio}%`, note: `${ratio.renewed} of ${ratio.due} due renewed` },
          { label: 'Premium collected', val: summary.collectedCount, note: `of ${summary.total} marked paid` },
        ].map(({ label, val, note, tone, delta }) => (
          <div key={label} className="commission-metric">
            <p className="commission-metric-label">{label}</p>
            <p className={`commission-metric-value ${tone || ''}`}>{val}</p>
            <p className="commission-metric-note">
              {note}
              {delta !== undefined && delta !== null && (
                <span className={delta >= 0 ? ' text-emerald-600 dark:text-emerald-400' : ' text-red-600 dark:text-red-400'}>
                  {' · '}{pct(delta)} YoY
                </span>
              )}
            </p>
          </div>
        ))}
      </div>

      {/* Persistency */}
      <div className="fintech-panel p-4 sm:p-5">
        <p className="text-sm font-extrabold text-gray-950 dark:text-white">Renewal outcome for {range.label}</p>
        <p className="text-xs text-gray-600 dark:text-gray-300">
          Of the policies that fell due in this window. A client who renewed elsewhere counts as
          pending until the policy is marked Cancelled or Lapsed.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Fell due', ratio.due, ''],
            ['Renewed', ratio.renewed, 'text-emerald-600 dark:text-emerald-400'],
            ['Still pending', ratio.pending, 'text-amber-600 dark:text-amber-400'],
            ['Lost / cancelled', ratio.lost, 'text-red-600 dark:text-red-400'],
          ].map(([label, value, tone]) => (
            <div key={label} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
              <p className={`text-xl font-extrabold ${tone}`}>{value}</p>
            </div>
          ))}
        </div>
        {ratio.pendingPremium > 0 && (
          <p className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-300">
            {fmtCurrency(ratio.pendingPremium)} of premium is still unrenewed in this window.
          </p>
        )}
      </div>

      {/* Breakdown */}
      <div className="fintech-panel p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-extrabold text-gray-950 dark:text-white">Business breakdown</p>
            <p className="text-xs text-gray-600 dark:text-gray-300">New business and renewals side by side · {breakdown.length} groups</p>
          </div>
          <div className="commission-segmented">
            {VIEWS.map(([key, label]) => (
              <button key={key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>{label}</button>
            ))}
          </div>
        </div>

        {!breakdown.length ? (
          <EmptyState
            icon="work"
            title="No business written in this period"
            description="Change the period above, or check that policy start dates are filled in."
          />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="commission-table min-w-full text-xs">
              <thead>
                <tr>
                  {['Group', 'New biz', 'New biz ₹', 'Renewals', 'Renewal ₹', 'Total', 'Premium', 'Share'].map(h => (
                    <th key={h} className="table-header whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {breakdown.map(row => (
                  <tr key={row.key}>
                    <td className="table-cell font-semibold">{row.key}</td>
                    <td className="table-cell text-blue-600 dark:text-blue-400">{row.freshCount}</td>
                    <td className="table-cell">{fmtCurrency(row.freshPremium)}</td>
                    <td className="table-cell text-emerald-600 dark:text-emerald-400">{row.renewalCount}</td>
                    <td className="table-cell">{fmtCurrency(row.renewalPremium)}</td>
                    <td className="table-cell font-bold">{row.count}</td>
                    <td className="table-cell font-bold">{fmtCurrency(row.premium)}</td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-slate-200 dark:bg-slate-700">
                          <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${(row.premium / maxPremium) * 100}%` }} />
                        </div>
                        <span className="tabular-nums">{row.sharePct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Counted by policy start date, the same basis an insurer uses on its own production
        report, so the two can be checked against each other. A renewal is any policy linked
        back to the one it replaced. Download the policy list to verify row by row.
      </p>
    </div>
  )
}
