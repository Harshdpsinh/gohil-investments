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
import SearchBar from '../components/ui/SearchBar'
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
  const { isAdmin }           = useAuth()

  const [search,      setSearch]      = useState('')
  const [typeFilter,  setTypeFilter]  = useState('All')
  const [yearFilter,  setYearFilter]  = useState('All')
  const [monthFilter, setMonthFilter] = useState('All')
  const [transactions, setTransactions] = useState([])
  const [transactionCursor, setTransactionCursor] = useState(null)
  const [hasMoreTransactions, setHasMoreTransactions] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [actualView, setActualView] = useState('insurer')
  const [ledgerError, setLedgerError] = useState('')

  useEffect(() => {
    if (!isAdmin) return
    getCommissionTransactionsPage({ pageSize: 100 }).then(page => { setTransactions(page.rows); setTransactionCursor(page.cursor); setHasMoreTransactions(page.hasMore); setLedgerError('') }).catch(err => { const message = err.message || 'Could not load posted commission.'; setLedgerError(message); toast.error(message) })
  }, [isAdmin])

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
      byInsurer[p.insurer]  = (byInsurer[p.insurer]  || 0) + p.totalComm
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
  const actualStats = useMemo(() => {
    const total = transactions.reduce((sum, item) => sum + Number(item.netReceived || item.receivedCommission || 0), 0)
    const byInsurer = transactions.reduce((map, item) => ({ ...map, [item.insurer || 'Other']: (map[item.insurer || 'Other'] || 0) + Number(item.netReceived || item.receivedCommission || 0) }), {})
    const byClient = transactions.reduce((map, item) => ({ ...map, [item.clientName || 'Unknown']: (map[item.clientName || 'Unknown'] || 0) + Number(item.netReceived || item.receivedCommission || 0) }), {})
    const byCategory = transactions.reduce((map, item) => { const category = policies.find(policy => policy.id === item.policyId)?.policyType || 'Other'; return { ...map, [category]: (map[category] || 0) + Number(item.netReceived || item.receivedCommission || 0) } }, {})
    const byMonth = transactions.reduce((map, item) => ({ ...map, [item.payoutMonth || 'Unknown']: (map[item.payoutMonth || 'Unknown'] || 0) + Number(item.netReceived || item.receivedCommission || 0) }), {})
    return { total, byInsurer, byClient, byCategory, byMonth }
  }, [transactions, policies])
  const actualBreakdown = actualView === 'client' ? actualStats.byClient : actualView === 'category' ? actualStats.byCategory : actualView === 'month' ? actualStats.byMonth : actualStats.byInsurer

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
          <button onClick={()=>exportToCSV(filtered,COMM_COLS,'commission')} className="btn-secondary text-xs">⬇ CSV</button>
          <button onClick={()=>exportToExcel(filtered,COMM_COLS,'Commission','commission')} className="btn-secondary text-xs">⬇ Excel</button>
          <button onClick={async()=>await exportToPDF(filtered,COMM_COLS,'Commission Report','commission')} className="btn-secondary text-xs">⬇ PDF</button>
        </div>
      </div>

      {ledgerError && <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"><span><strong>Commission ledger unavailable.</strong> {ledgerError}</span><button className="font-bold" onClick={() => window.location.reload()}>Retry</button></div>}

      <div className="commission-command-grid">
        {[
          { label:'Actual posted', val: fmtCurrency(actualStats.total), note: `${transactions.length} ledger entries`, tone:'text-emerald-600' },
          { label:'Estimated total', val: fmtCurrency(stats.total), note: 'From policy rates' },
          { label:'FY estimate', val: fmtCurrency(stats.fyTotal), note: 'First-year business' },
          { label:'RY estimate', val: fmtCurrency(stats.ryTotal), note: 'Renewal business' },
          { label:'Average estimate', val: fmtCurrency(filtered.length ? Math.round(stats.total/filtered.length) : 0), note: `${filtered.length} policies` },
        ].map(({ label, val, note, tone }) => (
          <div key={label} className="commission-metric"><p className="commission-metric-label">{label}</p><p className={`commission-metric-value ${tone || ''}`}>{val}</p><p className="commission-metric-note">{note}</p></div>
        ))}
      </div>

      <div className="fintech-panel p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-extrabold text-gray-950 dark:text-white">Actual commission breakdown</p><p className="text-xs text-gray-600 dark:text-gray-300">Posted ledger values only</p></div><div className="commission-segmented">{[['insurer','Company-wise'],['category','Category-wise'],['client','Client-wise'],['month','Month-wise']].map(([key,label]) => <button key={key} className={actualView === key ? 'active' : ''} onClick={() => setActualView(key)}>{label}</button>)}</div></div>
        {transactions.length ? <div className="commission-rank-list mt-4">{Object.entries(actualBreakdown).sort((a,b) => b[1]-a[1]).slice(0,10).map(([name,amount], index) => <div key={name} className="commission-rank-row"><span className="min-w-0 truncate"><span className="mr-2 text-xs font-bold text-gray-400">{String(index + 1).padStart(2,'0')}</span>{name}</span><strong className="tabular-nums">{fmtCurrency(amount)}</strong></div>)}</div> : <div className="commission-empty mt-4"><span className="commission-empty-mark">₹</span><p className="font-bold text-gray-700 dark:text-gray-200">No posted commission yet</p><p className="mt-1 text-sm">Confirm reconciliation rows or add a manual entry.</p></div>}
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
