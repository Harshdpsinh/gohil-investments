// src/pages/CommissionPage.jsx
// ✅ FIXED: CM1 (debounce on CommCell save), CM2 (safe date parse in filter),
//           CM3 (NaN% guard in type breakdown bars)
import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { usePolicies }  from '../hooks/usePolicies'
import { useClients }   from '../hooks/useClients'
import { useAuth }       from '../hooks/useAuth'
import { updatePolicy, getCommissionTransactionsPage } from '../firebase/firestore'
import { exportToCSV, exportToExcel, exportToPDF } from '../utils/exportUtils'
import { fmtDate, fmtCurrency, parseAnyDate } from '../utils/dateUtils'
import {
  AGEING_BUCKETS, RECONCILE_STATUS, ageingSummary, insurerScorecard,
  receivablesForecast, reconcilePolicies, reconcileSummary, resolveBusinessType, tdsSummary,
} from '../utils/commissionReconcile'
import { financialYearOf, financialYearRange } from '../utils/businessDone'
import { canonicalInsurer, duplicateInsurers, unrecognisedInsurers } from '../utils/insurers'
import SearchBar from '../components/ui/SearchBar'
import StatementImportModal from '../components/commission/StatementImportModal'
import toast from 'react-hot-toast'
import { isValid } from 'date-fns'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const COMM_COLS = [
  { header:'Policy No',     accessor: r => r.policyNumber },
  { header:'Client',        accessor: r => r.clientName   },
  { header:'Type',          accessor: r => r.policyType   },
  { header:'Insurer',       accessor: r => r.insurer       },
  { header:'Premium ₹',     accessor: r => r.premium       },
  { header:'FY Comm %',     accessor: r => r.fyCommission  },
  { header:'FY Comm ₹',     accessor: r => r.fyAmt         },
  { header:'RY Comm %',     accessor: r => r.ryCommission  },
  { header:'RY Comm ₹',     accessor: r => r.ryAmt         },
  { header:'Total Comm ₹',  accessor: r => r.totalComm     },
  { header:'Start Date',    accessor: r => fmtDate(r.startDate) },
  { header:'Policy Year',   accessor: r => r.policyYear || 1 },
]

const STATUS_LABEL = {
  received: 'Settled', short: 'Short paid', over: 'Overpaid',
  awaited: 'Not received', 'no-rate': 'No rate on file', 'not-due': 'Not due yet',
}
const STATUS_TONE = {
  received: 'text-emerald-600 dark:text-emerald-400',
  short: 'text-red-600 dark:text-red-400',
  over: 'text-amber-600 dark:text-amber-400',
  awaited: 'text-red-600 dark:text-red-400',
  'no-rate': 'text-gray-500',
  'not-due': 'text-gray-400',
}

// Every column needed to chase an insurer, or to tick the row off by hand.
const RECON_COLS = [
  { header:'Status',       accessor: r => STATUS_LABEL[r.status] || r.status },
  { header:'Policy No',    accessor: r => r.policyNumber },
  { header:'Client',       accessor: r => r.clientName },
  { header:'Company',      accessor: r => r.insurer },
  { header:'Category',     accessor: r => r.policyType },
  { header:'Policy Year',  accessor: r => r.policyYear },
  { header:'Premium',      accessor: r => r.premium },
  { header:'Expected ₹',   accessor: r => r.expected },
  { header:'Received ₹',   accessor: r => r.received },
  { header:'Difference ₹', accessor: r => r.difference },
  { header:'TDS ₹',        accessor: r => r.tds },
  { header:'Reversals ₹',  accessor: r => r.reversals },
  { header:'Days Pending', accessor: r => r.ageingDays },
  { header:'Days To Pay',  accessor: r => (r.daysToPay === null ? '' : r.daysToPay) },
  { header:'Premium Collected', accessor: r => (r.premiumCollected ? 'Yes' : 'Not marked') },
  { header:'Start Date',   accessor: r => fmtDate(r.startDate) },
  { header:'Due Date',     accessor: r => fmtDate(r.dueDate) },
]

const SCORECARD_COLS = [
  { header:'Company',        accessor: r => r.insurer },
  { header:'Policies',       accessor: r => r.policies },
  { header:'Expected ₹',     accessor: r => r.expected },
  { header:'Received ₹',     accessor: r => r.received },
  { header:'Variance ₹',     accessor: r => r.variance },
  { header:'Settled %',      accessor: r => r.settledPct },
  { header:'Unpaid',         accessor: r => r.unpaid },
  { header:'Short Paid',     accessor: r => r.short },
  { header:'Outstanding ₹',  accessor: r => r.outstanding },
  { header:'Avg Days To Pay',accessor: r => (r.avgDaysToPay === null ? 'Never paid' : r.avgDaysToPay) },
  { header:'TDS ₹',          accessor: r => r.tds },
]

const TDS_COLS = [
  { header:'Company',   accessor: r => r.insurer },
  { header:'Entries',   accessor: r => r.rows },
  { header:'Gross ₹',   accessor: r => r.gross },
  { header:'TDS ₹',     accessor: r => r.tds },
  { header:'Net Received ₹', accessor: r => r.net },
]

const AGEING_COLS = [
  { header:'Ageing Bucket', accessor: r => r.bucket },
  { header:'Policies',      accessor: r => r.count },
  { header:'Amount ₹',      accessor: r => r.amount },
]

const FORECAST_COLS = [
  { header:'Month',            accessor: r => r.month },
  { header:'Expected Commission ₹', accessor: r => r.amount },
]

function commAmt(premium, pct) {
  const p = parseFloat(premium) || 0
  const c = parseFloat(pct)     || 0
  return Math.round((p * c) / 100)
}

// ✅ FIX CM1: CommCell with debounced auto-save + explicit save button
function CommCell({ policyId, field, value }) {
  const [editing, setEditing] = useState(false)
  const [val,     setVal]     = useState(value || '')
  const [saving,  setSaving]  = useState(false)
  const debounceRef = useRef(null)

  const save = useCallback(async (newVal) => {
    if (saving) return
    setSaving(true)
    try {
      await updatePolicy(policyId, { [field]: newVal })
      toast.success('Updated!')
    } catch(err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }, [policyId, field, saving])

  // ✅ FIX CM1 (real fix): onChange starts the debounce timer so the cell
  // auto-saves 800 ms after the user stops typing — no Enter required.
  // Enter still works as an immediate save (clears the pending timer first).
  const handleChange = (e) => {
    const newVal = e.target.value
    setVal(newVal)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => save(newVal), 800)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter')  { clearTimeout(debounceRef.current); save(val) }
    if (e.key === 'Escape') { clearTimeout(debounceRef.current); setEditing(false); setVal(value || '') }
  }

  if (!editing) return (
    <span onClick={() => setEditing(true)}
          className="cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/30 px-1 rounded text-blue-600 dark:text-blue-400 font-semibold"
          title="Click to edit">
      {value ? `${value}%` : '—'}
    </span>
  )
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={val}
        onChange={handleChange}
        className="w-16 px-1 py-0.5 text-xs border border-blue-400 rounded focus:outline-none"
        autoFocus
        onKeyDown={handleKeyDown}
      />
      <button
        onClick={() => save(val)}
        disabled={saving}
        className="text-xs text-green-600 hover:text-green-700 font-bold disabled:opacity-50"
      >
        {saving ? '…' : '✓'}
      </button>
      <button
        onClick={() => { setEditing(false); setVal(value || '') }}
        className="text-xs text-gray-400 hover:text-gray-500"
      >
        ✕
      </button>
    </div>
  )
}

export default function CommissionPage() {
  const { policies, loading } = usePolicies()
  const { clients }           = useClients()
  const { isAdmin, user }     = useAuth()

  const [search,      setSearch]      = useState('')
  const [typeFilter,  setTypeFilter]  = useState('All')
  const [yearFilter,  setYearFilter]  = useState('All')
  const [monthFilter, setMonthFilter] = useState('All')
  const [transactions, setTransactions] = useState([])
  const [transactionCursor, setTransactionCursor] = useState(null)
  const [hasMoreTransactions, setHasMoreTransactions] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [actualView, setActualView] = useState('insurer')
  const [ledgerType, setLedgerType] = useState('All')   // Fresh / Renewal, as the statement said
  const [ledgerPlan, setLedgerPlan] = useState('All')   // plan / LOB, as the statement said
  const [ledgerError, setLedgerError] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [reconView, setReconView] = useState('outstanding')
  const [reconStatus, setReconStatus] = useState('all')
  const [loadingAll, setLoadingAll] = useState(false)

  useEffect(() => {
    if (!isAdmin) return
    getCommissionTransactionsPage({ pageSize: 100 }).then(page => { setTransactions(page.rows); setTransactionCursor(page.cursor); setHasMoreTransactions(page.hasMore); setLedgerError('') }).catch(err => { const message = err.message || 'Could not load posted commission.'; setLedgerError(message); toast.error(message) })
  }, [isAdmin])

  const reloadTransactions = useCallback(() => {
    getCommissionTransactionsPage({ pageSize: 100 })
      .then(page => { setTransactions(page.rows); setTransactionCursor(page.cursor); setHasMoreTransactions(page.hasMore); setLedgerError('') })
      .catch(err => toast.error(err.message || 'Could not refresh commission ledger.'))
  }, [])

  /**
   * Reconciliation compares every policy against the WHOLE ledger. On a partial
   * ledger a policy whose payout sits on an unloaded page reads as unpaid, so
   * the panel below refuses to be trusted until this has run.
   */
  const loadEntireLedger = async () => {
    if (loadingAll) return
    setLoadingAll(true)
    try {
      let cursor = transactionCursor
      let more = hasMoreTransactions
      const collected = []
      while (more) {
        const page = await getCommissionTransactionsPage({ pageSize: 500, cursor })
        collected.push(...page.rows)
        cursor = page.cursor
        more = page.hasMore
      }
      setTransactions(current => [...current, ...collected])
      setTransactionCursor(cursor)
      setHasMoreTransactions(false)
      setLedgerError('')
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
    } catch (err) { const message = err.message || 'Could not load more commission history.'; setLedgerError(message); toast.error(message) }
    finally { setLoadingMore(false) }
  }

  const enriched = useMemo(() =>
    policies.map(p => ({
      ...p,
      fyAmt:     commAmt(p.premium, p.fyCommission),
      ryAmt:     commAmt(p.premium, p.ryCommission),
      totalComm: commAmt(p.premium, p.fyCommission) + commAmt(p.premium, p.ryCommission),
    })),
    [policies]
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return enriched.filter(p => {
      const mQ  = !q || p.policyNumber?.toLowerCase().includes(q) || p.clientName?.toLowerCase().includes(q) || p.insurer?.toLowerCase().includes(q)
      const mT  = typeFilter === 'All' || p.policyType === typeFilter
      const mY  = yearFilter === 'All' || (yearFilter === 'FY1' ? (p.policyYear||1) === 1 : (p.policyYear||1) > 1)

      // ✅ FIX CM2: safe date parse — don't let malformed dates crash filter
      let mM = true
      if (monthFilter !== 'All' && p.startDate) {
        try {
          const d = parseAnyDate(p.startDate)
          mM = isValid(d) && d.getMonth() === MONTHS.indexOf(monthFilter)
        } catch {
          mM = false   // silently exclude rather than crash
        }
      }
      return mQ && mT && mY && mM
    })
  }, [enriched, search, typeFilter, yearFilter, monthFilter])

  const stats = useMemo(() => {
    const total      = filtered.reduce((s,p) => s + p.totalComm, 0)
    const fyTotal    = filtered.reduce((s,p) => s + p.fyAmt, 0)
    const ryTotal    = filtered.reduce((s,p) => s + p.ryAmt, 0)
    const byType     = {}
    const byInsurer  = {}
    const byMonth    = Array(12).fill(0)
    filtered.forEach(p => {
      byType[p.policyType]  = (byType[p.policyType]  || 0) + p.totalComm
      // Canonicalised: "HDFC ERGO" and "HDFC ERGO General Insurance" are one
      // company, not two each showing half the earnings.
      const company = canonicalInsurer(p.insurer) || 'Other'
      byInsurer[company] = (byInsurer[company] || 0) + p.totalComm
      if (p.startDate) {
        try {
          const d = parseAnyDate(p.startDate)
          if (isValid(d)) byMonth[d.getMonth()] += p.totalComm
        } catch { /* ignore */ }
      }
    })
    const topInsurers = Object.entries(byInsurer)
      .sort((a,b) => b[1]-a[1]).slice(0,5)
    return { total, fyTotal, ryTotal, byType, topInsurers, byMonth }
  }, [filtered])

  const maxBar = Math.max(...stats.byMonth, 1)

  // Ledger-only filters. These read the statement's own Fresh/Renewal and plan
  // columns — not the policy's policyYear, which answers a different question.
  const planOptions = useMemo(
    () => [...new Set(transactions.map(t => t.planName).filter(Boolean))].sort(),
    [transactions]
  )
  // Business type is resolved against the policy book, not read raw. Most
  // statements carry no Fresh/Renewal column, and the ones that do disagree on
  // the wording — so the policy's own year is the reliable answer.
  const policyById = useMemo(
    () => new Map(policies.map(policy => [policy.id, policy])),
    [policies]
  )
  const businessTypeOf = useCallback(
    item => resolveBusinessType(item, policyById.get(item.policyId) || null),
    [policyById]
  )

  const ledgerRows = useMemo(() => transactions.filter(item =>
    (ledgerType === 'All' || businessTypeOf(item) === ledgerType) &&
    (ledgerPlan === 'All' || (item.planName || '') === ledgerPlan)
  ), [transactions, ledgerType, ledgerPlan, businessTypeOf])

  const actualStats = useMemo(() => {
    const amount = item => Number(item.netReceived || item.receivedCommission || 0)
    // Mutate the accumulator; the old `{ ...map }` spread rebuilt the whole
    // object on every row.
    const tally = pick => ledgerRows.reduce((map, item) => {
      const key = pick(item)
      map[key] = (map[key] || 0) + amount(item)
      return map
    }, {})

    // The policy is the authority for who the company and client are; the
    // statement's spelling is only a hint. Statements abbreviate ("ICIC"),
    // truncate, and use legal names the book does not — reading the matched
    // policy first collapses all of that without needing an alias for every
    // variant a carrier might invent.
    const policyOf = item => policyById.get(item.policyId) || null
    const companyOf = item => canonicalInsurer(policyOf(item)?.insurer || item.insurer) || 'Other'
    const clientOf = item => policyOf(item)?.clientName || item.clientName || 'Unknown'

    return {
      total: ledgerRows.reduce((sum, item) => sum + amount(item), 0),
      byInsurer: tally(companyOf),
      byClient: tally(clientOf),
      byCategory: tally(item => policyOf(item)?.policyType || 'Other'),
      byMonth: tally(item => item.payoutMonth || 'Unknown'),
      // Falls back to the policy's own year when the statement carried no
      // Fresh/Renewal column — which is most of them.
      byBusinessType: tally(businessTypeOf),
      byPlan: tally(item => item.planName || 'Unspecified'),
    }
    // businessTypeOf is listed because the policy book usually finishes loading
    // after the ledger — without it the Fresh/Renewal split would stay stuck on
    // the first render, when no policy was available to derive from.
  }, [ledgerRows, policyById, businessTypeOf])
  // ── Reconciliation: the policy book joined to the posted ledger ──────────
  // Answers "which policy earned commission that never arrived", which neither
  // the estimate nor the ledger can answer alone.
  const reconciled = useMemo(
    () => reconcilePolicies(policies, transactions),
    [policies, transactions]
  )
  const reconTotals = useMemo(() => reconcileSummary(reconciled), [reconciled])
  const ageing = useMemo(() => ageingSummary(reconciled), [reconciled])
  const scorecard = useMemo(() => insurerScorecard(reconciled), [reconciled])
  const forecast = useMemo(() => receivablesForecast(policies), [policies])
  const currentFy = useMemo(() => financialYearRange(financialYearOf(new Date())), [])
  const tds = useMemo(
    () => tdsSummary(transactions, { from: currentFy.from.slice(0, 7), to: currentFy.to.slice(0, 7) }),
    [transactions, currentFy]
  )

  const reconRows = useMemo(() => {
    const rows = reconStatus === 'all'
      ? reconciled.filter(row => row.chaseable || row.status === RECONCILE_STATUS.SHORT || row.status === RECONCILE_STATUS.OVER)
      : reconciled.filter(row => row.status === reconStatus)
    // Oldest unpaid first — that is the chase order.
    return [...rows].sort((a, b) => b.ageingDays - a.ageingDays || b.expected - a.expected)
  }, [reconciled, reconStatus])

  // Object-shaped summaries flattened for the tables and the Excel export.
  const ageingRows = useMemo(
    () => AGEING_BUCKETS.map(bucket => ({ bucket, ...ageing[bucket] })),
    [ageing]
  )
  const forecastRows = useMemo(
    () => Object.entries(forecast.byMonth).map(([month, amount]) => ({ month, amount })),
    [forecast]
  )

  const downloadSimple = async (rows, cols, sheet, name, format) => {
    if (!rows.length) return toast.error('Nothing to download in this view.')
    try {
      if (format === 'excel') await exportToExcel(rows, cols, sheet, name)
      else await exportToCSV(rows, cols, name)
      toast.success('Download ready.')
    } catch (err) {
      toast.error(err.message || 'Could not build the file.')
    }
  }

  const downloadRecon = format =>
    downloadSimple(reconRows, RECON_COLS, 'Reconciliation', `commission-reconciliation-${reconStatus}`, format)

  // Spellings across BOTH sides — the policy book and the posted ledger. A
  // statement writing "HDFC ERGO" against a policy saved as "HDFC ERGO General
  // Insurance" is the common case, and it splits one company across two rows
  // until it is merged.
  const allInsurerNames = useMemo(
    () => [...policies.map(p => p.insurer), ...transactions.map(t => t.insurer)],
    [policies, transactions]
  )
  const insurerDupes = useMemo(() => duplicateInsurers(allInsurerNames), [allInsurerNames])
  // Names tied to no known company — typos and truncations too ambiguous to
  // resolve, like "ICIC", which prefixes both ICICI Lombard and ICICI
  // Prudential and so is never guessed at.
  const unknownInsurers = useMemo(() => unrecognisedInsurers(allInsurerNames), [allInsurerNames])

  const actualBreakdown = {
    client: actualStats.byClient, category: actualStats.byCategory, month: actualStats.byMonth,
    business: actualStats.byBusinessType, plan: actualStats.byPlan,
  }[actualView] || actualStats.byInsurer

  const TYPES = ['Health','Life','Motor','Home','Travel','Other']
  const TYPE_COLORS = { Health:'bg-blue-500', Life:'bg-purple-500', Motor:'bg-orange-500', Home:'bg-green-500', Travel:'bg-teal-500', Other:'bg-gray-400' }

  if (!isAdmin) return (
    <div className="p-8 text-center"><p className="text-gray-600 dark:text-gray-400 font-medium">Access restricted to administrators only.</p></div>
  )

  if (loading) return (
    <div className="fintech-page space-y-4"><div className="commission-skeleton h-8 w-64" /><div className="commission-command-grid">{Array.from({ length: 5 }, (_, index) => <div key={index} className="fintech-panel space-y-3 p-4"><div className="commission-skeleton h-3 w-24" /><div className="commission-skeleton h-7 w-32" /><div className="commission-skeleton h-3 w-20" /></div>)}</div><div className="fintech-panel space-y-3 p-5"><div className="commission-skeleton h-5 w-52" />{Array.from({ length: 5 }, (_, index) => <div key={index} className="commission-skeleton h-10 w-full" />)}</div></div>
  )

  return (
    <div className="fintech-page space-y-4 sm:space-y-5">
      <div className="fintech-header">
        <div><p className="fintech-kicker">Revenue intelligence</p>
          <h1 className="fintech-title">Commission Tracker</h1>
          <p className="fintech-subtitle">{filtered.length} policies · Separate estimated earnings from posted receipts.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isAdmin && <button onClick={()=>setImportOpen(true)} className="btn-primary text-xs">⬆ Import Statement</button>}
          <button onClick={()=>exportToCSV(filtered,COMM_COLS,'commission')} className="btn-secondary text-xs">⬇ CSV</button>
          <button onClick={()=>exportToExcel(filtered,COMM_COLS,'Commission','commission')} className="btn-secondary text-xs">⬇ Excel</button>
          <button onClick={async()=>await exportToPDF(filtered,COMM_COLS,'Commission Report','commission')} className="btn-secondary text-xs">⬇ PDF</button>
        </div>
      </div>

      {ledgerError && <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"><span><strong>Commission ledger unavailable.</strong> {ledgerError}</span><button className="font-bold" onClick={() => window.location.reload()}>Retry</button></div>}

      <StatementImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        policies={policies}
        user={user}
        onPosted={reloadTransactions}
      />

      <div className="commission-command-grid">
        {[
          { label:'Actual posted', val: fmtCurrency(actualStats.total), note: `${ledgerRows.length} ledger entries${ledgerRows.length === transactions.length ? '' : ' (filtered)'}`, tone:'text-emerald-600' },
          { label:'Estimated total', val: fmtCurrency(stats.total), note: 'From policy rates' },
          { label:'FY estimate', val: fmtCurrency(stats.fyTotal), note: 'First-year business' },
          { label:'RY estimate', val: fmtCurrency(stats.ryTotal), note: 'Renewal business' },
          { label:'Average estimate', val: fmtCurrency(filtered.length ? Math.round(stats.total/filtered.length) : 0), note: `${filtered.length} policies` },
        ].map(({ label, val, note, tone }) => (
          <div key={label} className="commission-metric"><p className="commission-metric-label">{label}</p><p className={`commission-metric-value ${tone || ''}`}>{val}</p><p className="commission-metric-note">{note}</p></div>
        ))}
      </div>

      {/* ── Reconciliation ─────────────────────────────────────────────── */}
      <div className="fintech-panel p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-extrabold text-gray-950 dark:text-white">Reconciliation · what the insurers still owe you</p>
            <p className="text-xs text-gray-600 dark:text-gray-300">
              Every policy priced at its own FY/RY rate and matched against posted receipts.
            </p>
          </div>
          <div className="commission-segmented">
            {[['outstanding','Outstanding'],['ageing','Ageing'],['scorecard','Company scorecard'],['forecast','Forecast'],['tds','TDS']].map(([key,label]) => (
              <button key={key} className={reconView === key ? 'active' : ''} onClick={() => setReconView(key)}>{label}</button>
            ))}
          </div>
        </div>

        {hasMoreTransactions && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <span>
              <strong>These figures are incomplete.</strong> Only {transactions.length} ledger entries are loaded,
              so a policy paid on an unloaded page still shows as unpaid.
            </span>
            <button className="btn-secondary text-xs" disabled={loadingAll} onClick={loadEntireLedger}>
              {loadingAll ? 'Loading…' : 'Load full ledger'}
            </button>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Outstanding', fmtCurrency(reconTotals.outstanding), `${reconTotals.counts.awaited} unpaid · ${reconTotals.counts.short} short`, 'text-red-600 dark:text-red-400'],
            ['Settled', reconTotals.counts.received, 'policies fully paid', 'text-emerald-600 dark:text-emerald-400'],
            ['TDS this FY', fmtCurrency(tds.total), currentFy.label],
            ['Next 90 days', fmtCurrency(forecast.total), `${forecast.count} renewals due`],
          ].map(([label, value, note, tone]) => (
            <div key={label} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
              <p className={`text-lg font-extrabold ${tone || ''}`}>{value}</p>
              <p className="text-[11px] text-gray-500">{note}</p>
            </div>
          ))}
        </div>

        {reconView === 'outstanding' && (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select value={reconStatus} onChange={e => setReconStatus(e.target.value)} className="form-select w-auto text-xs">
                <option value="all">Needs action (unpaid, short, over)</option>
                <option value={RECONCILE_STATUS.AWAITED}>Not received only</option>
                <option value={RECONCILE_STATUS.SHORT}>Short paid only</option>
                <option value={RECONCILE_STATUS.OVER}>Overpaid only</option>
                <option value={RECONCILE_STATUS.RECEIVED}>Settled only</option>
                <option value={RECONCILE_STATUS.NO_RATE}>Missing commission rate</option>
              </select>
              <span className="text-xs text-gray-500">{reconRows.length} policies</span>
              <div className="ml-auto flex gap-2">
                <button className="btn-primary text-xs" onClick={() => downloadRecon('excel')}>⬇ Excel</button>
                <button className="btn-secondary text-xs" onClick={() => downloadRecon('csv')}>⬇ CSV</button>
              </div>
            </div>
            <div className="mt-3 max-h-[52vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                  <tr>{['Status','Policy / Client','Company','Expected','Received','Difference','Pending'].map(h => <th key={h} className="table-header whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {reconRows.map(row => (
                    <tr key={row.policyId}>
                      <td className="table-cell"><span className={`font-bold ${STATUS_TONE[row.status]}`}>{STATUS_LABEL[row.status]}</span>{!row.premiumCollected && row.chaseable && <p className="text-[10px] text-gray-500">premium not marked paid</p>}</td>
                      <td className="table-cell"><p className="font-mono">{row.policyNumber}</p><p className="text-[11px] text-gray-500">{row.clientName}</p></td>
                      <td className="table-cell">{row.insurer}</td>
                      <td className="table-cell">{fmtCurrency(row.expected)}</td>
                      <td className="table-cell">{fmtCurrency(row.received)}</td>
                      <td className={`table-cell font-bold ${row.difference < 0 ? 'text-red-600 dark:text-red-400' : row.difference > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>{fmtCurrency(row.difference)}</td>
                      <td className="table-cell">{row.chaseable ? `${row.ageingDays}d` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!reconRows.length && <p className="p-6 text-center text-xs text-gray-500">Nothing in this bucket. Every policy here is settled.</p>}
            </div>
          </>
        )}

        {reconView === 'ageing' && (
          <div className="mt-3">
            <div className="mb-3 flex justify-end gap-2">
              <button className="btn-primary text-xs" onClick={() => downloadSimple(ageingRows, AGEING_COLS, 'Ageing', 'commission-ageing', 'excel')}>⬇ Excel</button>
              <button className="btn-secondary text-xs" onClick={() => downloadSimple(ageingRows, AGEING_COLS, 'Ageing', 'commission-ageing', 'csv')}>⬇ CSV</button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {AGEING_BUCKETS.map(bucket => (
                <div key={bucket} className={`rounded-xl border p-3 ${bucket === '90+' ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{bucket} days</p>
                  <p className="text-lg font-extrabold">{fmtCurrency(ageing[bucket].amount)}</p>
                  <p className="text-[11px] text-gray-500">{ageing[bucket].count} policies</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-gray-500">Counted from the day cover started. Anything past 90 days needs escalating, not chasing.</p>
          </div>
        )}

        {reconView === 'scorecard' && (
          <div className="mt-3">
            <div className="mb-3 flex justify-end gap-2">
              <button className="btn-primary text-xs" onClick={() => downloadSimple(scorecard, SCORECARD_COLS, 'Scorecard', 'commission-company-scorecard', 'excel')}>⬇ Excel</button>
              <button className="btn-secondary text-xs" onClick={() => downloadSimple(scorecard, SCORECARD_COLS, 'Scorecard', 'commission-company-scorecard', 'csv')}>⬇ CSV</button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800"><tr>{['Company','Policies','Expected','Received','Settled %','Outstanding','Avg days to pay'].map(h => <th key={h} className="table-header whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {scorecard.map(row => (
                    <tr key={row.insurer}>
                      <td className="table-cell font-semibold">{row.insurer}</td>
                      <td className="table-cell">{row.policies}</td>
                      <td className="table-cell">{fmtCurrency(row.expected)}</td>
                      <td className="table-cell">{fmtCurrency(row.received)}</td>
                      <td className={`table-cell font-bold ${row.settledPct >= 95 ? 'text-emerald-600 dark:text-emerald-400' : row.settledPct >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{row.settledPct}%</td>
                      <td className="table-cell">{fmtCurrency(row.outstanding)}</td>
                      <td className="table-cell">{row.avgDaysToPay === null ? <span className="text-red-600 dark:text-red-400">never paid</span> : `${row.avgDaysToPay}d`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {reconView === 'forecast' && (
          <div className="mt-3">
            <div className="mb-3 flex justify-end gap-2">
              <button className="btn-primary text-xs" onClick={() => downloadSimple(forecastRows, FORECAST_COLS, 'Forecast', 'commission-forecast', 'excel')}>⬇ Excel</button>
              <button className="btn-secondary text-xs" onClick={() => downloadSimple(forecastRows, FORECAST_COLS, 'Forecast', 'commission-forecast', 'csv')}>⬇ CSV</button>
            </div>
            {!forecastRows.length ? (
              <p className="p-6 text-center text-xs text-gray-500">No renewals fall due in the next 90 days.</p>
            ) : (
              <div className="space-y-2">
                {forecastRows.map(row => (
                  <div key={row.month} className="flex items-center gap-3">
                    <span className="w-20 text-xs font-semibold">{row.month}</span>
                    <div className="h-2 flex-1 rounded-full bg-slate-200 dark:bg-slate-700">
                      <div className="h-2 rounded-full bg-blue-500" style={{ width: `${(row.amount / Math.max(...forecastRows.map(r => r.amount), 1)) * 100}%` }} />
                    </div>
                    <span className="w-24 text-right text-xs font-bold">{fmtCurrency(row.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-gray-500">Renewals already on the book, priced at the RY rate. Excludes anything already renewed.</p>
          </div>
        )}

        {reconView === 'tds' && (
          <div className="mt-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs text-gray-600 dark:text-gray-300">{currentFy.label} · check against Form 26AS</p>
              <div className="flex gap-2">
                <button className="btn-primary text-xs" onClick={() => downloadSimple(tds.byInsurer, TDS_COLS, 'TDS', `tds-${currentFy.label.replace(/\s/g,'-')}`, 'excel')}>⬇ Excel</button>
                <button className="btn-secondary text-xs" onClick={() => downloadSimple(tds.byInsurer, TDS_COLS, 'TDS', `tds-${currentFy.label.replace(/\s/g,'-')}`, 'csv')}>⬇ CSV</button>
              </div>
            </div>
            {!tds.total ? (
              <p className="rounded-lg border border-slate-200 p-6 text-center text-xs text-gray-500 dark:border-slate-700">
                No TDS captured yet. Statements imported before this release did not record it —
                re-import a statement that has a TDS column and it will appear here.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800"><tr>{['Company','Entries','Gross','TDS','Net received'].map(h => <th key={h} className="table-header whitespace-nowrap">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {tds.byInsurer.map(row => (
                      <tr key={row.insurer}>
                        <td className="table-cell font-semibold">{row.insurer}</td>
                        <td className="table-cell">{row.rows}</td>
                        <td className="table-cell">{fmtCurrency(row.gross)}</td>
                        <td className="table-cell font-bold text-blue-600 dark:text-blue-400">{fmtCurrency(row.tds)}</td>
                        <td className="table-cell">{fmtCurrency(row.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="bg-slate-50 dark:bg-slate-800"><td className="table-cell font-extrabold">Total</td><td className="table-cell" /><td className="table-cell font-extrabold">{fmtCurrency(tds.gross)}</td><td className="table-cell font-extrabold">{fmtCurrency(tds.total)}</td><td className="table-cell" /></tr></tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="fintech-panel p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-extrabold text-gray-950 dark:text-white">Actual commission breakdown</p><p className="text-xs text-gray-600 dark:text-gray-300">Posted ledger values only · {ledgerRows.length} of {transactions.length} entries</p></div><div className="commission-segmented">{[['insurer','Company-wise'],['category','Category-wise'],['client','Client-wise'],['month','Month-wise'],['business','Fresh vs Renewal'],['plan','Plan-wise']].map(([key,label]) => <button key={key} className={actualView === key ? 'active' : ''} onClick={() => setActualView(key)}>{label}</button>)}</div></div>
        {actualView === 'insurer' && insurerDupes.length > 0 && (
          <details className="mt-3 rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-700">
            <summary className="cursor-pointer font-bold text-amber-700 dark:text-amber-300">
              {insurerDupes.length} {insurerDupes.length === 1 ? 'company is' : 'companies are'} spelled more than one way — counted as one here
            </summary>
            <ul className="mt-2 space-y-1">
              {insurerDupes.map(dupe => (
                <li key={dupe.canonical}>
                  <span className="font-semibold">{dupe.canonical}</span>
                  <span className="text-gray-500"> ← {dupe.variants.join(' · ')}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-gray-500">Your records are untouched. A company we do not recognise is kept exactly as written, and grouped under <strong>Other</strong> only if it has no name at all.</p>
          </details>
        )}

        {actualView === 'insurer' && unknownInsurers.length > 0 && (
          <details className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs dark:border-amber-800 dark:bg-amber-950/30">
            <summary className="cursor-pointer font-bold text-amber-800 dark:text-amber-200">
              {unknownInsurers.length} company {unknownInsurers.length === 1 ? 'name is' : 'names are'} not recognised — check for a typo
            </summary>
            <p className="mt-2 text-amber-900 dark:text-amber-200">
              Each of these is counted on its own. Some will be genuine companies not on our
              list, which is fine. Others are truncations too short to resolve safely — “ICIC”
              could be ICICI Lombard or ICICI Prudential, so it is never guessed at. Correct
              them on the policy and they merge automatically.
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {unknownInsurers.map(name => (
                <li key={name} className="rounded border border-amber-300 bg-white px-1.5 py-0.5 font-mono dark:border-amber-800 dark:bg-slate-900">{name}</li>
              ))}
            </ul>
          </details>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={ledgerType} onChange={e=>setLedgerType(e.target.value)} className="form-select w-auto text-xs">
            <option value="All">All business</option>
            <option value="Fresh">Fresh only</option>
            <option value="Renewal">Renewal only</option>
            <option value="Unspecified">Unspecified only</option>
          </select>
          <select value={ledgerPlan} onChange={e=>setLedgerPlan(e.target.value)} className="form-select w-auto text-xs">
            <option value="All">All plans / LOB</option>
            {planOptions.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          {(ledgerType !== 'All' || ledgerPlan !== 'All') && <button className="text-xs font-bold text-blue-600 dark:text-blue-400" onClick={()=>{setLedgerType('All');setLedgerPlan('All')}}>Clear</button>}
        </div>
        {ledgerRows.length ? <div className="commission-rank-list mt-4">{Object.entries(actualBreakdown).sort((a,b) => b[1]-a[1]).slice(0,10).map(([name,amount], index) => <div key={name} className="commission-rank-row"><span className="min-w-0 truncate"><span className="mr-2 text-xs font-bold text-gray-400">{String(index + 1).padStart(2,'0')}</span>{name}</span><strong className="tabular-nums">{fmtCurrency(amount)}</strong></div>)}</div> : <div className="commission-empty mt-4"><span className="commission-empty-mark">₹</span><p className="font-bold text-gray-700 dark:text-gray-200">{transactions.length ? 'No posted commission matches these filters' : 'No posted commission yet'}</p><p className="mt-1 text-sm">{transactions.length ? 'Older imports have no Fresh/Renewal column — try “Unspecified only”.' : 'Confirm reconciliation rows or add a manual entry.'}</p></div>}
      </div>
      {hasMoreTransactions && <div className="text-center"><button className="btn-secondary" disabled={loadingMore} onClick={loadMoreTransactions}>{loadingMore ? 'Loading...' : 'Load 100 more commission records'}</button></div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">📅 Commission by Start Month</p>
          <div className="flex items-end gap-1 h-32">
            {MONTHS.map((m, i) => (
              <div key={m} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full bg-blue-500 dark:bg-blue-600 rounded-t-sm transition-all"
                     style={{ height: `${(stats.byMonth[i] / maxBar) * 100}%`, minHeight: stats.byMonth[i] > 0 ? '4px' : '0' }}
                     title={`${m}: ₹${stats.byMonth[i].toLocaleString('en-IN')}`} />
                <span className="text-xs text-gray-400 dark:text-gray-500">{m}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">🏷️ Commission by Policy Type</p>
          <div className="space-y-2">
            {Object.entries(stats.byType)
              .sort((a,b) => b[1]-a[1])
              .map(([type, amt]) => {
                // ✅ FIX CM3: guard against division by zero → NaN%
                const pct = (stats.total > 0 && amt > 0) ? (amt / stats.total * 100) : 0
                return (
                  <div key={type}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-600 dark:text-gray-400 font-medium">{type}</span>
                      <span className="text-gray-800 dark:text-gray-200 font-semibold">{fmtCurrency(amt)}</span>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2">
                      <div className={`${TYPE_COLORS[type]||'bg-gray-400'} h-2 rounded-full transition-all`}
                           style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      </div>

      {stats.topInsurers.length > 0 && (
        <div className="card">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">🏢 Top 5 Insurers by Commission</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {stats.topInsurers.map(([ins, amt], i) => (
              <div key={ins} className="text-center bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
                <p className="text-xs text-gray-400 dark:text-gray-500 font-semibold">#{i+1}</p>
                <p className="text-sm font-bold text-gray-800 dark:text-gray-200 mt-1 truncate" title={ins}>{ins}</p>
                <p className="text-xs text-blue-600 dark:text-blue-400 font-semibold mt-1">{fmtCurrency(amt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
        <SearchBar value={search} onChange={setSearch} placeholder="Policy, client, insurer…" />
        <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} className="form-select w-auto text-sm">
          <option value="All">All Types</option>
          {TYPES.map(t=><option key={t}>{t}</option>)}
        </select>
        <select value={yearFilter} onChange={e=>setYearFilter(e.target.value)} className="form-select w-auto text-sm">
          <option value="All">All Years</option>
          <option value="FY1">FY1 Only</option>
          <option value="FY2+">FY2+ Only</option>
        </select>
        <select value={monthFilter} onChange={e=>setMonthFilter(e.target.value)} className="form-select w-auto text-sm">
          <option value="All">All Months</option>
          {MONTHS.map(m=><option key={m}>{m}</option>)}
        </select>
      </div>

      <div className="table-container">
        <table className="min-w-full">
          <thead><tr>
            {['Policy No','Client','Type','Insurer','Premium','FY %','FY ₹','RY %','RY ₹','Total Comm','Start','Yr'].map(h=>(
              <th key={h} className="table-header">{h}</th>
            ))}
          </tr></thead>
          <tbody className="bg-white dark:bg-gray-800">
            {filtered.length === 0
              ? <tr><td colSpan={12} className="text-center text-gray-400 dark:text-gray-500 py-10">No policies found</td></tr>
              : filtered.map(p => (
                <tr key={p.id} className="table-row">
                  <td className="table-cell font-mono text-xs font-semibold">{p.policyNumber}</td>
                  <td className="table-cell font-medium">{p.clientName||'—'}</td>
                  <td className="table-cell"><span className="badge-blue">{p.policyType}</span></td>
                  <td className="table-cell text-xs">{p.insurer||'—'}</td>
                  <td className="table-cell font-semibold">{fmtCurrency(p.premium)}</td>
                  <td className="table-cell text-center">
                    <CommCell policyId={p.id} field="fyCommission" value={p.fyCommission} />
                  </td>
                  <td className="table-cell text-right text-blue-600 dark:text-blue-400 font-semibold">{fmtCurrency(p.fyAmt)}</td>
                  <td className="table-cell text-center">
                    <CommCell policyId={p.id} field="ryCommission" value={p.ryCommission} />
                  </td>
                  <td className="table-cell text-right text-green-600 dark:text-green-400 font-semibold">{fmtCurrency(p.ryAmt)}</td>
                  <td className="table-cell text-right font-bold text-gray-800 dark:text-gray-200">{fmtCurrency(p.totalComm)}</td>
                  <td className="table-cell text-xs">{fmtDate(p.startDate)}</td>
                  <td className="table-cell text-center text-xs text-gray-500 dark:text-gray-400">Y{p.policyYear||1}</td>
                </tr>
              ))
            }
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="bg-blue-50 dark:bg-blue-900/30 border-t-2 border-blue-200 dark:border-blue-700">
                <td colSpan={6} className="px-4 py-3 text-sm font-bold text-blue-800 dark:text-blue-300">
                  TOTAL ({filtered.length} policies)
                </td>
                <td className="px-4 py-3 text-right text-sm font-bold text-blue-700 dark:text-blue-300">
                  {fmtCurrency(stats.fyTotal)}
                </td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right text-sm font-bold text-green-700 dark:text-green-300">
                  {fmtCurrency(stats.ryTotal)}
                </td>
                <td className="px-4 py-3 text-right text-sm font-bold text-gray-900 dark:text-white">
                  {fmtCurrency(stats.total)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
