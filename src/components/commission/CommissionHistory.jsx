import { useMemo, useState } from 'react'
import { fmtCurrency } from '../../utils/dateUtils'
import { historyBatches, historyByMonth, paginateRows } from '../../utils/commissionTracker'
import TableHScroll from '../ui/TableHScroll'

export default function CommissionHistory({ transactions = [], policyIds = null, title = 'Commission history' }) {
  const hist = historyByMonth(transactions, policyIds)
  if (!hist.months.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-700">
        No posted commission yet for this {policyIds?.length === 1 ? 'policy' : 'client'}.
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-extrabold text-slate-900 dark:text-white">{title}</p>
          <p className="text-xs text-slate-500">From posted receipts, not estimates.</p>
        </div>
        <p className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{fmtCurrency(hist.total)}</p>
      </div>
      <TableHScroll>
        <table className="min-w-full text-xs">
          <thead>
            <tr>
              {['Month', 'Entries', 'Received'].map(h => <th key={h} className="table-header">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {hist.months.map(row => (
              <tr key={row.month} className="table-row">
                <td className="table-cell font-mono">{row.month}</td>
                <td className="table-cell">{row.count}</td>
                <td className="table-cell font-semibold">{fmtCurrency(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableHScroll>
    </div>
  )
}

export function CommissionBatches({ transactions = [], onPick } = {}) {
  const batches = historyBatches(transactions)
  if (!batches.length) {
    return <p className="text-xs text-slate-500">No import batches yet. Upload a statement to see it here.</p>
  }
  return (
    <TableHScroll>
      <table className="min-w-full text-xs">
        <thead>
          <tr>
            {['File', 'Month', 'Rows', 'Received', 'Posted by'].map(h => <th key={h} className="table-header">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {batches.map(batch => (
            <tr key={batch.id} className="table-row">
              <td className="table-cell">
                <p className="font-semibold">{batch.fileName}</p>
                {batch.fileHash ? <p className="font-mono text-[10px] text-slate-400">{batch.fileHash.slice(0, 12)}…</p> : null}
              </td>
              <td className="table-cell font-mono">{batch.payoutMonth || '—'}</td>
              <td className="table-cell">{batch.count}</td>
              <td className="table-cell font-semibold">{fmtCurrency(batch.amount)}</td>
              <td className="table-cell">
                <p className="truncate">{batch.createdByEmail || '—'}</p>
                {onPick ? (
                  <button type="button" className="mt-1 font-bold text-teal-700 dark:text-teal-300" onClick={() => onPick(batch.rows[0])}>
                    Open first row
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableHScroll>
  )
}

export function CommissionLedgerTable({ rows = [], onReview } = {}) {
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [insurer, setInsurer] = useState('')
  const [month, setMonth] = useState('')
  const insurers = useMemo(
    () => [...new Set(rows.map(r => r.insurer).filter(Boolean))].sort(),
    [rows],
  )
  const months = useMemo(
    () => [...new Set(rows.map(r => r.payoutMonth).filter(Boolean))].sort().reverse(),
    [rows],
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(r => {
      if (insurer && r.insurer !== insurer) return false
      if (month && r.payoutMonth !== month) return false
      if (!q) return true
      return `${r.clientName} ${r.policyNumber} ${r.insurer} ${r.planName}`.toLowerCase().includes(q)
    })
  }, [rows, query, insurer, month])
  const sliced = paginateRows(filtered, page, 100)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className="form-input min-w-[12rem] text-xs" placeholder="Client, policy, company…" value={query} onChange={e => { setQuery(e.target.value); setPage(1) }} />
        <select className="form-select w-auto text-xs" value={insurer} onChange={e => { setInsurer(e.target.value); setPage(1) }}>
          <option value="">All companies</option>
          {insurers.map(name => <option key={name}>{name}</option>)}
        </select>
        <select className="form-select w-auto text-xs" value={month} onChange={e => { setMonth(e.target.value); setPage(1) }}>
          <option value="">All months</option>
          {months.map(value => <option key={value}>{value}</option>)}
        </select>
        <span className="self-center text-xs text-slate-500">{sliced.total} posted rows · page {sliced.page} of {sliced.pages}</span>
      </div>
      <TableHScroll>
        <table className="min-w-full text-xs">
          <thead>
            <tr>
              {['Policy / Client', 'Company', 'Month', 'Received', 'Net', 'Source'].map(h => <th key={h} className="table-header">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {sliced.rows.length === 0 ? (
              <tr><td className="table-cell text-slate-400" colSpan={6}>No posted rows match these filters.</td></tr>
            ) : sliced.rows.map(row => (
              <tr key={row.id || row.postingKey} className="table-row">
                <td className="table-cell">
                  <p className="font-mono font-semibold">{row.policyNumber}</p>
                  <p className="text-[11px] text-slate-500">{row.clientName}</p>
                </td>
                <td className="table-cell">{row.insurer || '—'}</td>
                <td className="table-cell font-mono">{row.payoutMonth || '—'}</td>
                <td className="table-cell font-semibold">{fmtCurrency(row.receivedCommission)}</td>
                <td className="table-cell">{fmtCurrency(row.netReceived)}</td>
                <td className="table-cell">
                  <p className="truncate">{row.sourceFileName || 'Manual / book'}</p>
                  {onReview ? (
                    <button type="button" className="font-bold text-teal-700 dark:text-teal-300" onClick={() => onReview(row)}>Edit</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableHScroll>
      {sliced.pages > 1 && (
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary text-xs" disabled={sliced.page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
          <button type="button" className="btn-secondary text-xs" disabled={sliced.page >= sliced.pages} onClick={() => setPage(p => p + 1)}>Next 100</button>
        </div>
      )}
    </div>
  )
}
