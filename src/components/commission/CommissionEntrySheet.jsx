import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import TableHScroll from '../ui/TableHScroll'
import { fmtCurrency } from '../../utils/dateUtils'
import { exportToExcel } from '../../utils/exportUtils'
import { addManualCommission } from '../../firebase/commissionOps'
import { validateCommissionAmount } from '../../utils/commissionTracker'
import {
  currentMonthKey, draftFromAmount, draftFromPct, entryRows, entryTotals, insurerChoices,
} from '../../utils/commissionEntry'

const UNPAID_COLS = [
  { header: 'Policy No', accessor: r => r.policyNumber },
  { header: 'Client', accessor: r => r.clientName },
  { header: 'Mobile', accessor: r => r.clientMobile },
  { header: 'Insurer', accessor: r => r.insurer },
  { header: 'Plan', accessor: r => r.planName },
  { header: 'Premium ₹', accessor: r => r.premium },
  { header: 'Booked %', accessor: r => r.bookedPct },
  { header: 'Expected commission ₹', accessor: r => r.expected },
  { header: 'Month', accessor: r => r.month },
]

export default function CommissionEntrySheet({ policies = [], transactions = [], user, onPosted }) {
  const choices = useMemo(() => insurerChoices(policies), [policies])
  const [insurerKey, setInsurerKey] = useState('')
  const [month, setMonth] = useState(() => currentMonthKey())
  const [query, setQuery] = useState('')
  const [bulkPct, setBulkPct] = useState('')
  const [drafts, setDrafts] = useState({})
  const [busy, setBusy] = useState(false)
  const [showPaid, setShowPaid] = useState(false)

  const company = choices.find(c => c.key === insurerKey) || null
  const rows = useMemo(
    () => entryRows({ policies, transactions, insurerKey, month, query }),
    [policies, transactions, insurerKey, month, query],
  )
  const unpaid = rows.filter(r => !r.received)
  const paid = rows.filter(r => r.received)

  useEffect(() => {
    const list = entryRows({ policies, transactions, insurerKey, month, query }).filter(row => !row.received)
    const next = {}
    for (const row of list) {
      const seeded = draftFromPct(row.premium, row.bookedPct)
      next[row.policyId] = { ...seeded, include: Number(seeded.amount) > 0 }
    }
    setDrafts(next)
  }, [insurerKey, month, query, transactions, policies])

  const totals = entryTotals(unpaid.map(row => ({
    premium: row.premium,
    amount: drafts[row.policyId]?.amount,
    include: drafts[row.policyId]?.include,
  })))

  const patch = (id, next) => setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...next } }))

  const onPct = (row, value) => {
    const seeded = draftFromPct(row.premium, value)
    patch(row.policyId, { pct: value, amount: seeded.amount, include: Number(seeded.amount) > 0 })
  }

  const onAmount = (row, value) => {
    const seeded = draftFromAmount(row.premium, value)
    patch(row.policyId, { amount: value, pct: seeded.error ? drafts[row.policyId]?.pct || '' : seeded.pct, include: !seeded.error && Number(value) > 0 })
  }

  const applyBulk = () => {
    const rate = Number(bulkPct)
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      toast.error('Enter a percentage between 0 and 100.')
      return
    }
    setDrafts(prev => {
      const next = { ...prev }
      for (const row of unpaid) {
        const seeded = draftFromPct(row.premium, rate)
        next[row.policyId] = { ...seeded, include: Number(seeded.amount) > 0 }
      }
      return next
    })
  }

  const save = async () => {
    const picked = unpaid.filter(row => drafts[row.policyId]?.include && Number(drafts[row.policyId]?.amount) > 0)
    if (!picked.length) {
      toast.error('Tick at least one policy with an amount.')
      return
    }
    for (const row of picked) {
      const err = validateCommissionAmount(drafts[row.policyId].amount)
      if (err) { toast.error(`${row.policyNumber}: ${err}`); return }
    }
    setBusy(true)
    let saved = 0
    try {
      for (const row of picked) {
        await addManualCommission(row.policy, {
          amount: Number(drafts[row.policyId].amount),
          payoutMonth: month,
          remarks: `Entered by company · ${company?.name || row.insurer} · ${month} · ${drafts[row.policyId].pct || 0}%`,
        }, { user })
        saved += 1
      }
      toast.success(`Saved ${saved} commission${saved === 1 ? '' : 's'} for ${company?.name || 'this company'}.`)
      onPosted?.()
    } catch (err) {
      toast.error(saved
        ? `Saved ${saved}, then stopped: ${err.message || 'could not save'}`
        : (err.message || 'Could not save commission.'))
      if (saved) onPosted?.()
    } finally {
      setBusy(false)
    }
  }

  const downloadUnpaid = async () => {
    const list = unpaid.map(row => ({ ...row, month }))
    if (!list.length) {
      toast.success('Every policy for this company and month already has a commission.')
      return
    }
    const label = `${company?.name || 'company'} ${month}`
    await exportToExcel(list, UNPAID_COLS, `No commission · ${label}`, `no-commission_${(company?.name || 'company').replace(/\s+/g, '-')}_${month}`)
  }

  return (
    <div className="fintech-panel space-y-3 p-4 sm:p-5">
      <div>
        <p className="text-sm font-extrabold text-slate-950 dark:text-white">Enter by company and month</p>
        <p className="text-xs text-slate-500">Pick one insurer and one month. The percentage on the policy fills the amount. Change either one and the other follows. Download what is still unpaid after you save.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
          Company
          <select className="form-select mt-1 w-full text-sm" value={insurerKey} onChange={e => setInsurerKey(e.target.value)}>
            <option value="">Select insurer</option>
            {choices.map(c => <option key={c.key} value={c.key}>{c.name} ({c.count})</option>)}
          </select>
        </label>
        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
          Month
          <input className="form-input mt-1" type="month" value={month} onChange={e => setMonth(e.target.value)} />
        </label>
        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
          Search
          <input className="form-input mt-1" placeholder="Policy, client, plan" value={query} onChange={e => setQuery(e.target.value)} />
        </label>
        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
          One % for all unpaid
          <span className="mt-1 flex gap-2">
            <input className="form-input" inputMode="decimal" placeholder="15" value={bulkPct} onChange={e => setBulkPct(e.target.value)} />
            <button type="button" className="btn-secondary text-xs" disabled={!unpaid.length} onClick={applyBulk}>Apply</button>
          </span>
        </label>
      </div>

      {!insurerKey ? (
        <p className="text-sm text-slate-500">Select a company to see its policies for this month.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['To save', String(totals.policies)],
              ['Premium', fmtCurrency(totals.premium)],
              ['Commission', fmtCurrency(totals.commission)],
              ['Overall %', `${totals.pct}%`],
            ].map(([label, val]) => (
              <div key={label} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
                <p className="text-sm font-extrabold text-slate-950 dark:text-white">{val}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary text-xs" disabled={busy || !totals.policies} onClick={save}>
              {busy ? 'Saving…' : `Save ${totals.policies || ''} for ${month}`}
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={downloadUnpaid}>
              Download unpaid ({unpaid.length})
            </button>
            {paid.length > 0 && (
              <button type="button" className="btn-secondary text-xs" onClick={() => setShowPaid(v => !v)}>
                {showPaid ? 'Hide' : 'Show'} already received ({paid.length})
              </button>
            )}
          </div>

          <TableHScroll>
            <table className="min-w-full text-xs">
              <thead>
                <tr>
                  <th className="table-header">Save</th>
                  <th className="table-header">Policy / Client</th>
                  <th className="table-header text-right">Premium</th>
                  <th className="table-header text-right">Booked %</th>
                  <th className="table-header">Commission %</th>
                  <th className="table-header">Commission ₹</th>
                </tr>
              </thead>
              <tbody>
                {unpaid.length === 0 ? (
                  <tr><td className="table-cell text-slate-400" colSpan={6}>No unpaid policies for this company in {month}.</td></tr>
                ) : unpaid.map(row => {
                  const draft = drafts[row.policyId] || { pct: '', amount: '', include: false }
                  return (
                    <tr key={row.policyId} className="table-row">
                      <td className="table-cell">
                        <input type="checkbox" checked={Boolean(draft.include)} onChange={e => patch(row.policyId, { include: e.target.checked })} />
                      </td>
                      <td className="table-cell">
                        <p className="font-mono font-semibold">{row.policyNumber}</p>
                        <p className="text-[11px] text-slate-500">{row.clientName}</p>
                      </td>
                      <td className="table-cell text-right">{fmtCurrency(row.premium)}</td>
                      <td className="table-cell text-right">{row.bookedPct ? `${row.bookedPct}%` : '—'}</td>
                      <td className="table-cell">
                        <input className="form-input w-20 text-right" inputMode="decimal" value={draft.pct} onChange={e => onPct(row, e.target.value)} />
                      </td>
                      <td className="table-cell">
                        <input className="form-input w-28 text-right" inputMode="decimal" value={draft.amount} onChange={e => onAmount(row, e.target.value)} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableHScroll>

          {showPaid && paid.length > 0 && (
            <TableHScroll>
              <table className="min-w-full text-xs">
                <thead>
                  <tr>
                    <th className="table-header">Already received</th>
                    <th className="table-header text-right">Premium</th>
                    <th className="table-header text-right">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {paid.map(row => (
                    <tr key={row.policyId} className="table-row">
                      <td className="table-cell">
                        <p className="font-mono font-semibold">{row.policyNumber}</p>
                        <p className="text-[11px] text-slate-500">{row.clientName}</p>
                      </td>
                      <td className="table-cell text-right">{fmtCurrency(row.premium)}</td>
                      <td className="table-cell text-right font-semibold text-emerald-700 dark:text-emerald-300">{fmtCurrency(row.receivedAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableHScroll>
          )}
        </>
      )}
    </div>
  )
}
