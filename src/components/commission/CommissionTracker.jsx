import { useMemo, useState } from 'react'
import { fmtCurrency } from '../../utils/dateUtils'
import { currentFyStart, trackerRows, validateCommissionAmount } from '../../utils/commissionTracker'
import { addManualCommission, updateCommissionTransaction } from '../../firebase/commissionOps'
import toast from 'react-hot-toast'
import TableHScroll from '../ui/TableHScroll'

const TONE = {
  received: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  missing: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  na: 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
}

export default function CommissionTracker({
  policies, transactions, clients, user, onPosted,
}) {
  const [fyStart, setFyStart] = useState(() => currentFyStart())
  const [query, setQuery] = useState('')
  const [insurer, setInsurer] = useState('')
  const [editing, setEditing] = useState(null)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  const grid = useMemo(
    () => trackerRows({ policies, transactions, clients, fyStart, query, insurer }),
    [policies, transactions, clients, fyStart, query, insurer],
  )

  const insurers = useMemo(
    () => [...new Set(policies.map(p => p.insurer).filter(Boolean))].sort(),
    [policies],
  )

  const openCell = (row, monthKey, cell) => {
    if (cell.state === 'na') return
    setEditing({ row, monthKey, cell })
    setAmount(cell.amount ? String(cell.amount) : '')
  }

  const saveCell = async () => {
    const err = validateCommissionAmount(amount)
    if (err) { toast.error(err); return }
    setBusy(true)
    try {
      const received = Number(amount)
      if (editing.cell.txn?.id) {
        await updateCommissionTransaction(editing.cell.txn.id, {
          receivedCommission: received,
          netReceived: received,
          expectedCommission: editing.cell.expected,
          difference: received - editing.cell.expected,
          payoutMonth: editing.monthKey,
        })
        toast.success('Commission updated.')
      } else {
        await addManualCommission(editing.row.policy, {
          amount: received,
          payoutMonth: editing.monthKey,
          remarks: 'Entered from month tracker',
        }, { user })
        toast.success('Commission saved.')
      }
      onPosted?.()
      setEditing(null)
    } catch (e) {
      toast.error(e.message || 'Could not save that cell.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fintech-panel space-y-3 p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-extrabold text-slate-950 dark:text-white">Month-wise tracker</p>
          <p className="text-xs text-slate-500">Green = received. Amber = expected, still missing. Grey = not in force. Click a cell to enter or fix the amount.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            className="form-input min-w-[12rem] text-sm"
            placeholder="Search name, policy, mobile, PAN…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <select className="form-select w-auto text-sm" value={insurer} onChange={e => setInsurer(e.target.value)}>
            <option value="">All companies</option>
            {insurers.map(name => <option key={name}>{name}</option>)}
          </select>
          <select className="form-select w-auto text-sm" value={fyStart} onChange={e => setFyStart(Number(e.target.value))}>
            {[fyStart - 1, fyStart, fyStart + 1].filter((y, i, a) => a.indexOf(y) === i).map(y => (
              <option key={y} value={y}>FY {y}-{(y + 1) % 100}</option>
            ))}
          </select>
        </div>
      </div>

      <TableHScroll>
        <table className="min-w-full text-xs">
          <thead>
            <tr>
              <th className="table-header sticky left-0 z-10 bg-slate-50 dark:bg-slate-900">Policy / Client</th>
              {grid.months.map(m => <th key={m.key} className="table-header text-center">{m.label}</th>)}
              <th className="table-header text-right">Received</th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.length === 0 ? (
              <tr><td className="table-cell text-slate-400" colSpan={grid.months.length + 2}>No policies match this search.</td></tr>
            ) : grid.rows.map(row => (
              <tr key={row.policyId} className="table-row">
                <td className="table-cell sticky left-0 bg-white dark:bg-slate-900">
                  <p className="font-mono font-semibold">{row.policyNumber}</p>
                  <p className="text-[11px] text-slate-500">{row.clientName}</p>
                  <p className="text-[10px] text-slate-400">{row.insurer}</p>
                </td>
                {grid.months.map(m => {
                  const cell = row.cells[m.key]
                  return (
                    <td key={m.key} className="table-cell p-1 text-center">
                      <button
                        type="button"
                        disabled={cell.state === 'na'}
                        onClick={() => openCell(row, m.key, cell)}
                        className={`min-h-[2.25rem] min-w-[3.5rem] rounded-lg px-1 text-[10px] font-bold ${TONE[cell.state]} disabled:cursor-default`}
                      >
                        {cell.state === 'received' ? fmtCurrency(cell.amount) : cell.state === 'missing' ? '—' : ''}
                      </button>
                    </td>
                  )
                })}
                <td className="table-cell text-right font-semibold">{fmtCurrency(row.receivedTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableHScroll>

      {editing && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => !busy && setEditing(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-extrabold">{editing.cell.txn ? 'Update commission' : 'Enter commission'}</p>
            <p className="mt-1 text-xs text-slate-500">
              {editing.row.clientName} · {editing.row.policyNumber} · {editing.monthKey}
            </p>
            <p className="mt-3 text-xs">Expected {fmtCurrency(editing.cell.expected)}</p>
            <label className="mt-2 block text-xs font-bold">Received ₹</label>
            <input className="form-input mt-1" type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
            <div className="mt-4 flex gap-2">
              <button className="btn-primary flex-1" disabled={busy} onClick={saveCell}>{busy ? 'Saving…' : 'Save'}</button>
              <button className="btn-secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
