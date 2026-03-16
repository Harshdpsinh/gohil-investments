// src/pages/CommissionPage.jsx
import { useState, useMemo } from 'react'
import { usePolicies }  from '../hooks/usePolicies'
import { useClients }   from '../hooks/useClients'
import { updatePolicy } from '../firebase/firestore'
import { exportToCSV, exportToExcel, exportToPDF } from '../utils/exportUtils'
import { fmtDate, fmtCurrency } from '../utils/dateUtils'
import SearchBar from '../components/ui/SearchBar'
import toast from 'react-hot-toast'
import { format, parseISO, isValid } from 'date-fns'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Commission columns for export
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

// ── Inline edit commission % ──────────────────────────────────
function CommCell({ policyId, field, value }) {
  const [editing, setEditing] = useState(false)
  const [val,     setVal]     = useState(value || '')
  const save = async () => {
    try { await updatePolicy(policyId, { [field]: val }); toast.success('Updated!') }
    catch(err) { toast.error(err.message) }
    setEditing(false)
  }
  if (!editing) return (
    <span onClick={()=>setEditing(true)}
          className="cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/30 px-1 rounded text-blue-600 dark:text-blue-400 font-semibold"
          title="Click to edit">
      {value ? `${value}%` : '—'}
    </span>
  )
  return (
    <div className="flex items-center gap-1">
      <input type="number" value={val} onChange={e=>setVal(e.target.value)}
             className="w-16 px-1 py-0.5 text-xs border border-blue-400 rounded focus:outline-none"
             autoFocus onKeyDown={e=>{ if(e.key==='Enter')save(); if(e.key==='Escape')setEditing(false) }} />
      <button onClick={save} className="text-xs text-green-600 hover:text-green-700 font-bold">✓</button>
      <button onClick={()=>setEditing(false)} className="text-xs text-gray-400 hover:text-gray-500">✕</button>
    </div>
  )
}

export default function CommissionPage() {
  const { policies, loading } = usePolicies()
  const { clients }           = useClients()
  const [search,      setSearch]      = useState('')
  const [typeFilter,  setTypeFilter]  = useState('All')
  const [yearFilter,  setYearFilter]  = useState('All')  // FY1 / FY2+
  const [monthFilter, setMonthFilter] = useState('All')

  // Enrich policies with commission amounts
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
      let mM = true
      if (monthFilter !== 'All' && p.startDate) {
        try {
          const d = p.startDate?.seconds ? new Date(p.startDate.seconds*1000) : parseISO(p.startDate)
          mM = isValid(d) && d.getMonth() === MONTHS.indexOf(monthFilter)
        } catch { mM = true }
      }
      return mQ && mT && mY && mM
    })
  }, [enriched, search, typeFilter, yearFilter, monthFilter])

  // Summary stats
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
          const d = p.startDate?.seconds ? new Date(p.startDate.seconds*1000) : parseISO(p.startDate)
          if (isValid(d)) byMonth[d.getMonth()] += p.totalComm
        } catch {}
      }
    })
    const topInsurers = Object.entries(byInsurer)
      .sort((a,b) => b[1]-a[1]).slice(0,5)
    return { total, fyTotal, ryTotal, byType, topInsurers, byMonth }
  }, [filtered])

  // Bar chart helper
  const maxBar = Math.max(...stats.byMonth, 1)

  const TYPES = ['Health','Life','Motor','Home','Travel','Other']
  const TYPE_COLORS = { Health:'bg-blue-500', Life:'bg-purple-500', Motor:'bg-orange-500', Home:'bg-green-500', Travel:'bg-teal-500', Other:'bg-gray-400' }

  if (loading) return (
    <div className="p-8 text-gray-400 dark:text-gray-500 flex items-center gap-2">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />Loading…
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Commission Tracker</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{filtered.length} policies · Click any % to edit inline</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={()=>exportToCSV(filtered,COMM_COLS,'commission')} className="btn-secondary text-xs">⬇ CSV</button>
          <button onClick={()=>exportToExcel(filtered,COMM_COLS,'Commission','commission')} className="btn-secondary text-xs">⬇ Excel</button>
          <button onClick={()=>exportToPDF(filtered,COMM_COLS,'Commission Report','commission')} className="btn-secondary text-xs">⬇ PDF</button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label:'Total Commission', val: fmtCurrency(stats.total),   color:'blue',   icon:'💰' },
          { label:'FY Commission',    val: fmtCurrency(stats.fyTotal),  color:'purple', icon:'🆕' },
          { label:'RY Commission',    val: fmtCurrency(stats.ryTotal),  color:'green',  icon:'🔄' },
          { label:'Policies',         val: filtered.length,             color:'gray',   icon:'📋' },
          { label:'Avg per Policy',   val: fmtCurrency(filtered.length ? Math.round(stats.total/filtered.length) : 0), color:'orange', icon:'📊' },
        ].map(({ label, val, color, icon }) => (
          <div key={label} className="stat-card">
            <span className="text-2xl">{icon}</span>
            <div>
              <p className={`text-xl font-bold text-${color}-600 dark:text-${color}-400`}>{val}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Monthly bar chart */}
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

        {/* By policy type */}
        <div className="card">
          <p className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-4">🏷️ Commission by Policy Type</p>
          <div className="space-y-2">
            {Object.entries(stats.byType)
              .sort((a,b) => b[1]-a[1])
              .map(([type, amt]) => {
                const pct = stats.total > 0 ? (amt / stats.total * 100) : 0
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

      {/* Top Insurers */}
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

      {/* Filters */}
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

      {/* Table */}
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
          {/* Totals row */}
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
