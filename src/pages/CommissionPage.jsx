// src/pages/CommissionPage.jsx
// Commission Calculator — First Year, Renewal Year, and Combined totals
import { useState, useMemo } from 'react'
import { usePolicies }  from '../hooks/usePolicies'
import { fmtDate, fmtCurrency } from '../utils/dateUtils'
import { exportToCSV, exportToExcel, exportToPDF } from '../utils/exportUtils'
import { format } from 'date-fns'

const TYPES = ['All','Health','Life','Motor','Home','Travel','Marine','Fire','Other']

// ── Determine if a policy is in its first year ────────────────
function getPolicyYear(startDate) {
  if (!startDate) return 'renewal'
  const start = new Date(startDate)
  const now   = new Date()
  const monthsOld = (now.getFullYear() - start.getFullYear()) * 12
                  + (now.getMonth() - start.getMonth())
  return monthsOld < 12 ? 'first' : 'renewal'
}

// ── Calculate commission amount ───────────────────────────────
function calcCommission(policy) {
  const premium  = parseFloat(policy.premium)  || 0
  const fyPct    = parseFloat(policy.fyCommission) || 0
  const ryPct    = parseFloat(policy.ryCommission) || 0
  const year     = getPolicyYear(policy.startDate)
  const pct      = year === 'first' ? fyPct : ryPct
  const amount   = (premium * pct) / 100
  return { year, pct, amount, fyAmt: (premium * fyPct) / 100, ryAmt: (premium * ryPct) / 100 }
}

// ── Stat card ─────────────────────────────────────────────────
function Card({ label, value, sub, color = 'blue' }) {
  const colors = {
    blue:   'bg-blue-50  border-blue-200  text-blue-700',
    green:  'bg-green-50 border-green-200 text-green-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs mt-1 opacity-60">{sub}</p>}
    </div>
  )
}

export default function CommissionPage() {
  const { policies, loading } = usePolicies()
  const [typeFilter, setTypeFilter]     = useState('All')
  const [insurerFilter, setInsurerFilter] = useState('')
  const [yearFilter, setYearFilter]     = useState('All') // All / first / renewal
  const [search, setSearch]             = useState('')

  // Unique insurers for filter
  const insurers = useMemo(() => {
    const s = new Set(policies.map(p => p.insurer).filter(Boolean))
    return ['', ...Array.from(s).sort()]
  }, [policies])

  // Only active policies with at least one commission % set
  const rows = useMemo(() => {
    const q = search.toLowerCase()
    return policies
      .filter(p => p.status !== 'Lapsed' && p.status !== 'Cancelled')
      .filter(p => typeFilter === 'All' || p.policyType === typeFilter)
      .filter(p => !insurerFilter || p.insurer === insurerFilter)
      .filter(p => {
        if (yearFilter === 'All') return true
        return getPolicyYear(p.startDate) === yearFilter
      })
      .filter(p => !q ||
        p.policyNumber?.toLowerCase().includes(q) ||
        p.clientName?.toLowerCase().includes(q) ||
        p.insurer?.toLowerCase().includes(q)
      )
      .map(p => ({ ...p, ...calcCommission(p) }))
  }, [policies, typeFilter, insurerFilter, yearFilter, search])

  // Summary totals
  const totals = useMemo(() => {
    const fyRows = rows.filter(r => r.year === 'first')
    const ryRows = rows.filter(r => r.year === 'renewal')
    return {
      fyCount:   fyRows.length,
      ryCount:   ryRows.length,
      fyTotal:   fyRows.reduce((s, r) => s + r.amount, 0),
      ryTotal:   ryRows.reduce((s, r) => s + r.amount, 0),
      grand:     rows.reduce((s, r) => s + r.amount, 0),
      // Projected: what ALL policies would give if they renew
      projected: rows.reduce((s, r) => s + r.ryAmt, 0),
    }
  }, [rows])

  // Export columns
  const COMM_COLS = [
    { header: 'Policy No',   accessor: r => r.policyNumber },
    { header: 'Client',      accessor: r => r.clientName },
    { header: 'Type',        accessor: r => r.policyType },
    { header: 'Insurer',     accessor: r => r.insurer },
    { header: 'Premium ₹',   accessor: r => r.premium },
    { header: 'Year',        accessor: r => r.year === 'first' ? '1st Year' : 'Renewal' },
    { header: 'Comm %',      accessor: r => r.pct + '%' },
    { header: 'Commission ₹',accessor: r => Math.round(r.amount) },
    { header: 'FY Rate %',   accessor: r => r.fyCommission || 0 },
    { header: 'FY Amt ₹',    accessor: r => Math.round(r.fyAmt) },
    { header: 'RY Rate %',   accessor: r => r.ryCommission || 0 },
    { header: 'RY Amt ₹',    accessor: r => Math.round(r.ryAmt) },
    { header: 'Expiry',      accessor: r => fmtDate(r.expiryDate) },
  ]

  if (loading) return (
    <div className="p-8 text-gray-400 flex items-center gap-2">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      Loading commission data…
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">💰 Commission Calculator</h1>
          <p className="text-sm text-gray-500">
            Based on {rows.length} active policies · as of {format(new Date(),'dd MMM yyyy')}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => exportToCSV(rows, COMM_COLS, 'commission')}
                  className="btn-secondary text-xs">⬇ CSV</button>
          <button onClick={() => exportToExcel(rows, COMM_COLS, 'Commission', 'commission')}
                  className="btn-secondary text-xs">⬇ Excel</button>
          <button onClick={() => exportToPDF(rows, COMM_COLS, 'Commission Report', 'commission')}
                  className="btn-secondary text-xs">⬇ PDF</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          label="First Year Commission"
          value={fmtCurrency(totals.fyTotal)}
          sub={`${totals.fyCount} policies in 1st year`}
          color="blue"
        />
        <Card
          label="Renewal Commission"
          value={fmtCurrency(totals.ryTotal)}
          sub={`${totals.ryCount} renewal policies`}
          color="green"
        />
        <Card
          label="Grand Total (Current)"
          value={fmtCurrency(totals.grand)}
          sub="1st year + renewal combined"
          color="purple"
        />
        <Card
          label="Projected Renewal Income"
          value={fmtCurrency(totals.projected)}
          sub="If all shown policies renew"
          color="orange"
        />
      </div>

      {/* Breakdown by type */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">📊 By Policy Type (filtered view)</p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Type','Policies','Total Premium','FY Commission','RY Commission','Total'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-500 uppercase py-2 px-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {['Health','Life','Motor','Home','Travel','Marine','Fire','Other'].map(type => {
                const grp = rows.filter(r => r.policyType === type)
                if (!grp.length) return null
                return (
                  <tr key={type} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 px-3 font-medium text-blue-700">{type}</td>
                    <td className="py-2 px-3">{grp.length}</td>
                    <td className="py-2 px-3">{fmtCurrency(grp.reduce((s,r)=>s+parseFloat(r.premium||0),0))}</td>
                    <td className="py-2 px-3 text-blue-600 font-medium">
                      {fmtCurrency(grp.filter(r=>r.year==='first').reduce((s,r)=>s+r.amount,0))}
                    </td>
                    <td className="py-2 px-3 text-green-600 font-medium">
                      {fmtCurrency(grp.filter(r=>r.year==='renewal').reduce((s,r)=>s+r.amount,0))}
                    </td>
                    <td className="py-2 px-3 font-bold">
                      {fmtCurrency(grp.reduce((s,r)=>s+r.amount,0))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-start sm:items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search policy, client, insurer…"
          className="form-input text-sm w-full sm:w-64"
        />
        <div className="flex gap-2 flex-wrap">
          {['All','first','renewal'].map(v => (
            <button key={v}
              onClick={() => setYearFilter(v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                yearFilter === v ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >{v === 'All' ? 'All Years' : v === 'first' ? '1st Year Only' : 'Renewal Only'}</button>
          ))}
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
                className="form-select text-sm w-auto">
          {TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        <select value={insurerFilter} onChange={e => setInsurerFilter(e.target.value)}
                className="form-select text-sm w-auto">
          {insurers.map(i => <option key={i} value={i}>{i || 'All Insurers'}</option>)}
        </select>
      </div>

      {/* Detail table */}
      <div className="table-container">
        <table className="min-w-full">
          <thead>
            <tr>
              {['Policy No','Client','Type','Insurer','Premium','Year',
                'Comm %','Commission ₹','FY %','FY Amt ₹','RY %','RY Amt ₹','Expiry'].map(h => (
                <th key={h} className="table-header">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white">
            {rows.length === 0
              ? <tr><td colSpan={13} className="text-center text-gray-400 py-10">
                  No policies found. Make sure to enter FY Commission % and RY Commission % when adding policies.
                </td></tr>
              : rows.map(p => (
                <tr key={p.id} className="table-row">
                  <td className="table-cell font-mono text-xs font-semibold">{p.policyNumber}</td>
                  <td className="table-cell font-medium">{p.clientName}</td>
                  <td className="table-cell"><span className="badge-blue">{p.policyType}</span></td>
                  <td className="table-cell text-xs">{p.insurer}</td>
                  <td className="table-cell">{fmtCurrency(p.premium)}</td>
                  <td className="table-cell">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      p.year === 'first'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-green-100 text-green-700'
                    }`}>
                      {p.year === 'first' ? '1st Year' : 'Renewal'}
                    </span>
                  </td>
                  <td className="table-cell text-center font-semibold">{p.pct}%</td>
                  <td className="table-cell font-bold text-blue-700">
                    {fmtCurrency(Math.round(p.amount))}
                  </td>
                  <td className="table-cell text-center text-xs text-gray-500">{p.fyCommission || '—'}%</td>
                  <td className="table-cell text-xs text-blue-600">{fmtCurrency(Math.round(p.fyAmt))}</td>
                  <td className="table-cell text-center text-xs text-gray-500">{p.ryCommission || '—'}%</td>
                  <td className="table-cell text-xs text-green-600">{fmtCurrency(Math.round(p.ryAmt))}</td>
                  <td className="table-cell text-xs">{fmtDate(p.expiryDate)}</td>
                </tr>
              ))
            }
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-blue-50 border-t-2 border-blue-200">
                <td colSpan={7} className="table-cell font-bold text-right text-blue-800">TOTALS</td>
                <td className="table-cell font-bold text-blue-800 text-lg">
                  {fmtCurrency(Math.round(totals.grand))}
                </td>
                <td colSpan={2} className="table-cell font-semibold text-blue-700 text-xs">
                  FY: {fmtCurrency(Math.round(totals.fyTotal))}
                </td>
                <td colSpan={3} className="table-cell font-semibold text-green-700 text-xs">
                  RY: {fmtCurrency(Math.round(totals.ryTotal))}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Help note */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800">
        <p className="font-semibold mb-1">ℹ️ How commission is calculated</p>
        <p>• <strong>1st Year:</strong> Policy start date is within the last 12 months → uses <strong>FY Commission %</strong></p>
        <p>• <strong>Renewal:</strong> Policy is older than 12 months → uses <strong>RY Commission %</strong></p>
        <p>• Set FY % and RY % when adding or editing a policy in the Policies tab.</p>
        <p>• <strong>Projected Renewal Income</strong> shows what you would earn if all current policies renew (using RY %).</p>
      </div>
    </div>
  )
}
