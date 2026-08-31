import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '../../hooks/useAuth'
import { usePolicies } from '../../hooks/usePolicies'
import { getAllCommissionTransactions } from '../../firebase/firestore'
import {
  getBookSettlement,
  rewriteIciciInsurerNames,
  settleExistingBookCommissions,
} from '../../firebase/commissionOps'
import { insurerRewritePlan, policiesToSettle } from '../../utils/commissionSettle'
import ManualCommissionModal from './ManualCommissionModal'

export default function CommissionBookBanner() {
  const { pathname } = useLocation()
  const { isAdmin, user } = useAuth()
  const { policies } = usePolicies()
  const [transactions, setTransactions] = useState([])
  const [settlement, setSettlement] = useState(null)
  const [busy, setBusy] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [editingTxn, setEditingTxn] = useState(null)
  const onCommission = pathname.startsWith('/commission')

  useEffect(() => {
    if (!isAdmin) return
    getBookSettlement().then(setSettlement).catch(() => setSettlement(null))
    getAllCommissionTransactions().then(setTransactions).catch(() => setTransactions([]))
  }, [isAdmin])

  const pendingSettle = useMemo(() => policiesToSettle(policies, transactions), [policies, transactions])
  const rewrite = useMemo(() => insurerRewritePlan(policies, transactions), [policies, transactions])
  const rewriteCount = rewrite.policyUpdates.length + rewrite.transactionUpdates.length

  const reload = async () => {
    const [nextSettlement, nextTxns] = await Promise.all([
      getBookSettlement().catch(() => null),
      getAllCommissionTransactions().catch(() => []),
    ])
    setSettlement(nextSettlement)
    setTransactions(nextTxns)
  }

  const settle = async () => {
    if (busy) return
    setBusy('settle')
    try {
      const result = await settleExistingBookCommissions(policies, transactions, { user, cutoff: new Date() })
      toast.success(`${result.posted} policies marked paid. New policies stay unpaid until you import a statement or enter commission by hand.`)
      await reload()
    } catch (err) {
      toast.error(err.message || 'Could not mark commissions paid.')
    } finally {
      setBusy('')
    }
  }

  const mergeIcici = async () => {
    if (busy) return
    setBusy('merge')
    try {
      const result = await rewriteIciciInsurerNames(policies, transactions)
      toast.success(`Merged ICICI spellings on ${result.policies} policies and ${result.transactions} commission rows.`)
      await reload()
    } catch (err) {
      toast.error(err.message || 'Could not merge ICICI names.')
    } finally {
      setBusy('')
    }
  }

  if (!isAdmin) return null
  if (!onCommission && !pendingSettle.length && !rewriteCount) return null

  const recent = transactions.filter(row => row.policyId).slice(0, 6)

  return (
    <div className="space-y-3 p-3 sm:px-4 sm:pt-4">
      {!!rewriteCount && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-bold">ICICI and ICICI Lombard are stored as two names</p>
          <p className="mt-1 text-xs">
            ICIC / ICICI will be rewritten to ICICI Lombard (Life policies go to ICICI Prudential).
            Reports already treat them as one company.
          </p>
          <button className="btn-primary mt-2 text-xs" disabled={!!busy} onClick={mergeIcici}>
            {busy === 'merge' ? 'Merging…' : `Merge ${rewriteCount} records now`}
          </button>
        </div>
      )}

      {!settlement && pendingSettle.length > 0 && (
        <div className="rounded-xl border border-blue-300 bg-blue-50 p-3 text-sm text-blue-950 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-100">
          <p className="font-bold">One-time: mark the existing book as commission received</p>
          <p className="mt-1 text-xs">
            {pendingSettle.length} policies were on the book before this change and have no posted receipt.
            After this, nothing is marked paid unless you import a statement or enter it by hand.
          </p>
          <button className="btn-primary mt-2 text-xs" disabled={!!busy} onClick={settle}>
            {busy === 'settle' ? 'Updating…' : `Mark ${pendingSettle.length} existing policies as paid`}
          </button>
        </div>
      )}

      {onCommission && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-secondary text-xs" onClick={() => { setEditingTxn(null); setManualOpen(true) }}>
            + Manual commission
          </button>
          {settlement?.settledAt && (
            <span className="text-xs text-gray-500">Existing book marked paid. New policies wait for a file or a manual entry.</span>
          )}
        </div>
      )}

      {onCommission && recent.length > 0 && (
        <details className="rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-700">
          <summary className="cursor-pointer font-bold">Edit a posted commission</summary>
          <ul className="mt-2 space-y-1">
            {recent.map(row => (
              <li key={row.id} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  <span className="font-mono">{row.policyNumber}</span>
                  <span className="text-gray-500"> · {row.clientName} · ₹{Number(row.netReceived || row.receivedCommission || 0).toLocaleString('en-IN')}</span>
                </span>
                <button className="font-bold text-blue-600 dark:text-blue-400" onClick={() => setEditingTxn(row)}>Edit</button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ManualCommissionModal
        key={editingTxn?.id || 'new'}
        open={manualOpen || !!editingTxn}
        existing={editingTxn}
        policies={policies}
        user={user}
        onClose={() => { setManualOpen(false); setEditingTxn(null) }}
        onPosted={reload}
      />
    </div>
  )
}
