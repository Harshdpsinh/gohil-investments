import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import TableHScroll from '../ui/TableHScroll'
import { fmtCurrency } from '../../utils/dateUtils'
import { exportToExcel } from '../../utils/exportUtils'
import { addManualCommission } from '../../firebase/commissionOps'
import {
  currentMonthKey, draftFromAmount, draftFromPct, entryRows, entryTotals, insurerChoices,
  netEntryAmount, pendingByInsurer, validateSignedAmount,
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

export default function CommissionEntrySheet({ policies = [], transactions = [], user, onPosted, plain = false }) {
  const choices = useMemo(() => insurerChoices(policies), [policies])
  const [insurerKey, setInsurerKey] = useState('')
  const [month, setMonth] = useState(() => currentMonthKey())
  const [client, setClient] = useState('')
  const [query, setQuery] = useState('')
  const [bulkPct, setBulkPct] = useState('')
  const [drafts, setDrafts] = useState({})
  const [busy, setBusy] = useState(false)
  const [showPaid, setShowPaid] = useState(false)

  const company = choices.find(c => c.key === insurerKey) || null
  const rows = useMemo(
    () => entryRows({ policies, transactions, insurerKey, month, query, client }),
    [policies, transactions, insurerKey, month, query, client],
  )
  const unpaid = rows.filter(r => !r.received)
  const paid = rows.filter(r => r.received)
  const pending = useMemo(
    () => pendingByInsurer(entryRows({ policies, transactions, month })),
    [policies, transactions, month],
  )
  const allOn = unpaid.length > 0 && unpaid.every(row => drafts[row.policyId]?.include)

  useEffect(() => {
    const list = entryRows({ policies, transactions, insurerKey, month, query, client }).filter(row => !row.received)
    const next = {}
    for (const row of list) {
      const seeded = draftFromPct(row.premium, row.bookedPct)
      next[row.policyId] = {
        ...seeded,
        adjust: '',
        year: row.year,
        payoutMonth: row.payoutMonth,
        include: Number(seeded.amount) !== 0,
      }
    }
    setDrafts(next)
  }, [insurerKey, month, query, client, transactions, policies])

  const totals = entryTotals(unpaid.map(row => ({
    premium: row.premium,
    amount: drafts[row.policyId]?.amount,
    adjust: drafts[row.policyId]?.adjust,
    include: drafts[row.policyId]?.include,
  })))

  const patch = (id, next) => setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...next } }))

  const onPct = (row, value) => {
    const seeded = draftFromPct(row.premium, value)
    patch(row.policyId, { pct: value, amount: seeded.amount, include: Number(seeded.amount) > 0 })
  }

  const onAmount = (row, value) => {
    const seeded = draftFromAmount(row.premium, value)
    patch(row.policyId, { amount: value, pct: seeded.error ? drafts[row.policyId]?.pct || '' : seeded.pct, include: !seeded.error && Number(value) !== 0 })
  }

  const onYear = (row, year) => {
    const slice = (row.slices || []).find(item => item.year === Number(year))
    if (!slice) return
    const seeded = draftFromPct(slice.premium, slice.pct)
    patch(row.policyId, {
      year: slice.year,
      payoutMonth: slice.payoutMonth,
      pct: slice.pct ? String(slice.pct) : '',
      amount: seeded.amount,
      include: !slice.received && Number(seeded.amount) !== 0,
    })
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
        const current = next[row.policyId] || {}
        next[row.policyId] = {
          ...current,
          ...seeded,
          include: Number(seeded.amount) !== 0,
        }
      }
      return next
    })
  }

  const toggleAll = () => {
    setDrafts(prev => {
      const next = { ...prev }
      for (const row of unpaid) {
        const current = next[row.policyId] || { pct: '', amount: '', include: false }
        next[row.policyId] = {
          ...current,
          include: !allOn && netEntryAmount(current.amount, current.adjust) !== 0,
        }
      }
      return next
    })
  }

  const save = async () => {
    const picked = unpaid.filter(row => {
      const draft = drafts[row.policyId]
      return draft?.include && netEntryAmount(draft.amount, draft.adjust) !== 0
    })
    if (!picked.length) {
      toast.error('Tick at least one policy with an amount.')
      return
    }
    for (const row of picked) {
      const net = netEntryAmount(drafts[row.policyId].amount, drafts[row.policyId].adjust)
      const err = validateSignedAmount(net)
      if (err) { toast.error(`${row.policyNumber}: ${err}`); return }
    }
    setBusy(true)
    let saved = 0
    try {
      for (const row of picked) {
        const draft = drafts[row.policyId]
        const net = netEntryAmount(draft.amount, draft.adjust)
        const yearNote = row.years > 1 ? `Year ${draft.year || row.year} of ${row.years}` : ''
        const adjustNote = Number(draft.adjust) ? `Month +/- ${draft.adjust}` : ''
        await addManualCommission(row.policy, {
          amount: net,
          expectedCommission: row.slices?.find(slice => slice.year === Number(draft.year || row.year))?.amount ?? row.expected,
          payoutMonth: draft.payoutMonth || row.payoutMonth || month,
          businessType: Number(draft.year || row.year) > 1 ? 'Renewal' : 'Fresh',
          remarks: ['Manual entry', company?.name || row.insurer, draft.payoutMonth || month, `${draft.pct || 0}%`, yearNote, adjustNote].filter(Boolean).join(' · '),
        }, { user })
        saved += 1
      }
      toast.success(`Saved ${saved} commission${saved === 1 ? '' : 's'}.`)
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
      toast.success('Every policy in this list already has a commission.')
      return
    }
    const who = company?.name || (client.trim() ? client.trim() : 'all-companies')
    await exportToExcel(
      list,
      UNPAID_COLS,
      `No commission · ${who} · ${month}`,
      `no-commission_${who.replace(/\s+/g, '-')}_${month}`,
    )
  }

  return (
    <div className={plain ? 'space-y-3' : 'fintech-panel space-y-3 p-4 sm:p-5'}>
      {!plain && (
        <div>
          <p className="text-sm font-extrabold text-slate-950 dark:text-white">Enter by company, client or month</p>
          <p className="text-xs text-slate-500">Type the last 4 digits to pick a policy, even if several match. A multi-year advance is entered one year at a time. Use Month +/- when the statement is a little over or short.</p>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
          Month
          <input className="form-input mt-1" type="month" value={month} onChange={e => setMonth(e.target.value)} />
        </label>
        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
          Company
          <select className="form-select mt-1 w-full text-sm" value={insurerKey} onChange={e => setInsurerKey(e.target.value)}>
            <option value="">All companies</option>
            {choices.map(c => <option key={c.key} value={c.key}>{c.name} ({c.count})</option>)}
          </select>
        </label>
        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
          Client
          <input className="form-input mt-1" placeholder="Name or mobile" value={client} onChange={e => setClient(e.target.value)} />
        </label>
        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
          Policy number
          <input className="form-input mt-1" placeholder="Last 4 digits" value={query} onChange={e => setQuery(e.target.value)} />
        </label>
        <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 sm:col-span-2">
          One % for every unpaid row in this list
          <span className="mt-1 flex gap-2">
            <input className="form-input" inputMode="decimal" placeholder="15" value={bulkPct} onChange={e => setBulkPct(e.target.value)} />
            <button type="button" className="btn-secondary shrink-0 text-xs" disabled={!unpaid.length} onClick={applyBulk}>Apply</button>
          </span>
        </label>
      </div>

      {pending.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Pending this month, by company</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {pending.map(item => (
              <button
                key={item.key}
                type="button"
                onClick={() => setInsurerKey(item.key)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${insurerKey === item.key ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100'}`}
              >
                {item.name} · {item.count} · {fmtCurrency(item.expected)}
              </button>
            ))}
          </div>
        </div>
      )}

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
              <th className="table-header">
                <input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all unpaid" />
              </th>
              <th className="table-header">Policy / Client</th>
              <th className="table-header text-right">Premium</th>
              <th className="table-header text-right">Booked %</th>
              <th className="table-header">Commission %</th>
              <th className="table-header">Commission ₹</th>
              <th className="table-header">Month +/-</th>
            </tr>
          </thead>
          <tbody>
            {unpaid.length === 0 ? (
              <tr><td className="table-cell text-slate-400" colSpan={7}>No unpaid policies for this month and filter.</td></tr>
            ) : unpaid.map(row => {
              const draft = drafts[row.policyId] || { pct: '', amount: '', adjust: '', include: false, year: row.year }
              return (
                <tr key={row.policyId} className="table-row">
                  <td className="table-cell">
                    <input type="checkbox" checked={Boolean(draft.include)} aria-label={`Save ${row.policyNumber}`} onChange={e => patch(row.policyId, { include: e.target.checked })} />
                  </td>
                  <td className="table-cell">
                    <p className="font-mono font-semibold">{row.policyNumber}</p>
                    <p className="text-[11px] text-slate-500">
                      Last 4 {row.policyTail || '—'} · {row.clientName}{company ? '' : ` · ${row.insurer}`}
                    </p>
                    {row.years > 1 && (
                      <label className="mt-1 block text-[11px] font-bold text-slate-500">
                        Year
                        <select className="form-select mt-1 w-full text-xs" value={draft.year || row.year} onChange={e => onYear(row, e.target.value)}>
                          {row.slices.map(slice => (
                            <option key={slice.year} value={slice.year}>
                              Year {slice.year} of {slice.years} · {slice.payoutMonth}{slice.received ? ' · already in' : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </td>
                  <td className="table-cell text-right">{fmtCurrency(row.premium)}</td>
                  <td className="table-cell text-right">{row.bookedPct ? `${row.bookedPct}%` : '—'}</td>
                  <td className="table-cell">
                    <input className="form-input w-20 text-right" inputMode="decimal" aria-label={`Percent ${row.policyNumber}`} value={draft.pct} onChange={e => onPct(row, e.target.value)} />
                  </td>
                  <td className="table-cell">
                    <input className="form-input w-28 text-right" inputMode="decimal" aria-label={`Amount ${row.policyNumber}`} value={draft.amount} onChange={e => onAmount(row, e.target.value)} />
                  </td>
                  <td className="table-cell">
                    <input className="form-input w-24 text-right" inputMode="decimal" placeholder="+/-" aria-label={`Adjust ${row.policyNumber}`} value={draft.adjust || ''} onChange={e => patch(row.policyId, { adjust: e.target.value, include: netEntryAmount(draft.amount, e.target.value) !== 0 })} />
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
    </div>
  )
}
