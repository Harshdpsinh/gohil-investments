// Loads every posted commission row. Reconciliation is wrong on a partial page.
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { getCommissionTransactionsPage } from '../firebase/firestore'

export async function fetchEntireCommissionLedger() {
  const first = await getCommissionTransactionsPage({ pageSize: 100 })
  const rows = [...first.rows]
  let cursor = first.cursor
  let more = first.hasMore
  while (more) {
    const page = await getCommissionTransactionsPage({ pageSize: 250, cursor })
    rows.push(...page.rows)
    cursor = page.cursor
    more = page.hasMore
  }
  return { rows, cursor, hasMore: false }
}

export function useCommissionLedger(enabled) {
  const [transactions, setTransactions] = useState([])
  const [transactionCursor, setTransactionCursor] = useState(null)
  const [hasMoreTransactions, setHasMoreTransactions] = useState(false)
  const [ledgerError, setLedgerError] = useState('')
  const [loadingAll, setLoadingAll] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const applyPage = useCallback(page => {
    setTransactions(page.rows)
    setTransactionCursor(page.cursor)
    setHasMoreTransactions(Boolean(page.hasMore))
    setLedgerError('')
  }, [])

  const reloadTransactions = useCallback(() => {
    fetchEntireCommissionLedger()
      .then(applyPage)
      .catch(err => toast.error(err.message || 'Could not refresh commission ledger.'))
  }, [applyPage])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetchEntireCommissionLedger()
      .then(page => { if (!cancelled) applyPage(page) })
      .catch(err => {
        if (cancelled) return
        const message = err.message || 'Could not load posted commission.'
        setLedgerError(message)
        toast.error(message)
      })
    return () => { cancelled = true }
  }, [enabled, applyPage])

  const loadEntireLedger = async () => {
    if (loadingAll) return
    setLoadingAll(true)
    try {
      const page = await fetchEntireCommissionLedger()
      applyPage(page)
    } catch (err) {
      const message = err.message || 'Could not load the full commission ledger.'
      setLedgerError(message)
      toast.error(message)
    } finally {
      setLoadingAll(false)
    }
  }

  const loadMoreTransactions = async () => {
    if (!hasMoreTransactions || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await getCommissionTransactionsPage({ pageSize: 100, cursor: transactionCursor })
      setTransactions(current => [...current, ...page.rows])
      setTransactionCursor(page.cursor)
      setHasMoreTransactions(page.hasMore)
    } catch (err) {
      const message = err.message || 'Could not load more commission history.'
      setLedgerError(message)
      toast.error(message)
    } finally {
      setLoadingMore(false)
    }
  }

  return {
    transactions,
    transactionCursor,
    hasMoreTransactions,
    ledgerError,
    loadingAll,
    loadingMore,
    reloadTransactions,
    loadEntireLedger,
    loadMoreTransactions,
  }
}
