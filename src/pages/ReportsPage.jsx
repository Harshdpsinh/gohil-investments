import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useClients } from '../hooks/useClients'
import { usePolicies } from '../hooks/usePolicies'
import DateInput from '../components/ui/DateInput'
import { exportToCSV, exportToExcel, exportToPDF } from '../utils/exportUtils'
import { daysUntilPolicyDue, fmtCurrency, fmtDate, parseAnyDate } from '../utils/dateUtils'
import { subscribeClaims } from '../firebase/firestore'
import AppIcon from '../components/ui/AppIcon'

const reportTypes = [
  'Company',
  'Product',
  'Business',
  'Renewals',
  'Claims',
  'Clients',
  'Cross Sell',
]

const REPORT_TILES = [
  { name: 'Company', icon: 'insurer', hint: 'By insurer' },
  { name: 'Product', icon: 'policies', hint: 'By policy type' },
  { name: 'Business', icon: 'work', hint: 'Written policies' },
  { name: 'Renewals', icon: 'renewals', hint: 'Due list' },
  { name: 'Claims', icon: 'claims', hint: 'Claim board' },
]

function groupReportRows(policies, keyFn, type) {
  const map = new Map()
  policies.forEach(policy => {
    const key = keyFn(policy) || 'Unknown'
    const current = map.get(key) || {
      type,
      date: policy.startDate,
      client: '',
      policyNumber: '',
      insurer: type === 'Company' ? key : '',
      product: type === 'Product' ? key : '',
      status: 'Active',
      amount: 0,
      detail: '0 policies',
      count: 0,
    }
    current.amount += Number(policy.premium || 0)
    current.count += 1
    current.detail = `${current.count} polic${current.count === 1 ? 'y' : 'ies'}`
    if (!current.date || String(policy.startDate || '') > String(current.date || '')) current.date = policy.startDate
    map.set(key, current)
  })
  return [...map.values()].sort((a, b) => b.amount - a.amount)
}

function isBetween(dateValue, from, to) {
  const d = parseAnyDate(dateValue)
  if (!d) return true
  const f = parseAnyDate(from)
  const t = parseAnyDate(to)
  if (f && d < f) return false
  if (t && d > t) return false
  return true
}

export default function ReportsPage() {
  const { clients } = useClients()
  const { policies } = usePolicies()
  const [claims, setClaims] = useState([])
  const [report, setReport] = useState('Business')
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('All')

  useEffect(() => {
    return subscribeClaims(setClaims, err => toast.error(err.message || 'Claims load failed.'))
  }, [])

  const rows = useMemo(() => {
    const q = query.toLowerCase()
    const activePolicies = policies.filter(p => !['Renewed-Out', 'Cancelled'].includes(p.status))
    const clientMap = Object.fromEntries(clients.map(c => [c.id, c]))

    const baseRows = {
      Company: groupReportRows(activePolicies, p => p.insurer, 'Company'),
      Product: groupReportRows(activePolicies, p => p.policyType, 'Product'),
      Business: activePolicies.map(p => ({
        type: 'Business',
        date: p.startDate,
        client: p.clientName,
        policyNumber: p.policyNumber,
        insurer: p.insurer,
        product: p.planName || p.product || '',
        status: p.status || 'Active',
        amount: Number(p.premium || 0),
        detail: p.policyType || '',
      })),
      Renewals: activePolicies.map(p => ({
        type: 'Renewal',
        date: p.nextPremiumDue || p.expiryDate,
        client: p.clientName,
        policyNumber: p.policyNumber,
        insurer: p.insurer,
        product: p.planName || '',
        status: daysUntilPolicyDue(p) < 0 ? 'Overdue' : 'Due',
        amount: Number(p.premium || 0),
        detail: `${daysUntilPolicyDue(p) ?? '-'} days`,
      })),
      Claims: claims.map(c => ({
        type: 'Claim',
        date: c.intimationDate || c.createdAt,
        client: c.clientName,
        policyNumber: c.policyNumber,
        insurer: c.insurer,
        product: c.claimType || '',
        status: c.status || '',
        amount: Number(c.claimedAmount || c.claimAmount || c.amount || 0),
        detail: c.claimNumber || '',
      })),
      Clients: clients.map(c => ({
        type: 'Client',
        date: c.createdAt || c.dob,
        client: c.name,
        policyNumber: '',
        insurer: c.city || '',
        product: c.mobile || '',
        status: c.kycStatus || '',
        amount: activePolicies.filter(p => p.clientId === c.id).length,
        detail: c.familyName || '',
      })),
      'Cross Sell': clients.flatMap(c => {
        const owned = activePolicies.filter(p => p.clientId === c.id).map(p => String(p.policyType || '').toLowerCase())
        const gaps = []
        if (!owned.includes('health')) gaps.push('Health')
        if (!owned.includes('life') && !owned.includes('term')) gaps.push('Life / Term')
        if (!owned.includes('motor')) gaps.push('Motor')
        return gaps.map(gap => ({
          type: 'Cross Sell',
          date: c.createdAt,
          client: c.name,
          policyNumber: '',
          insurer: '',
          product: gap,
          status: 'identified',
          amount: 0,
          detail: clientMap[c.id]?.mobile || '',
        }))
      }),
    }

    return (baseRows[report] || []).filter(row => {
      const text = Object.values(row).join(' ').toLowerCase()
      return (!q || text.includes(q)) && (status === 'All' || row.status === status) && isBetween(row.date, from, to)
    })
  }, [clients, policies, claims, report, query, from, to, status])

  const statuses = useMemo(() => ['All', ...Array.from(new Set(rows.map(r => r.status).filter(Boolean)))], [rows])
  const totalAmount = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)

  const columns = [
    { header: 'Type', accessor: r => r.type },
    { header: 'Date', accessor: r => fmtDate(r.date) },
    { header: 'Client', accessor: r => r.client },
    { header: 'Policy No', accessor: r => r.policyNumber },
    { header: 'Insurer / Source', accessor: r => r.insurer },
    { header: 'Product / Detail', accessor: r => r.product },
    { header: 'Status', accessor: r => r.status },
    { header: 'Amount', accessor: r => r.amount },
    { header: 'Notes', accessor: r => r.detail },
  ]

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dynamic Reports</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Tap a tile to switch the table. Clients and cross-sell stay in the dropdown.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-secondary text-xs" onClick={() => exportToCSV(rows, columns, `${report.toLowerCase()}_report`)}>CSV</button>
          <button className="btn-secondary text-xs" onClick={() => exportToExcel(rows, columns, report, `${report.toLowerCase()}_report`)}>Excel</button>
          <button className="btn-secondary text-xs" onClick={() => exportToPDF(rows, columns, `${report} Report`, `${report.toLowerCase()}_report`)}>PDF</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {REPORT_TILES.map(tile => (
          <button
            key={tile.name}
            type="button"
            onClick={() => { setReport(tile.name); setStatus('All') }}
            className={`rounded-xl border p-4 text-left ${
              report === tile.name
                ? 'border-teal-600 bg-teal-50 dark:border-teal-400 dark:bg-teal-950/40'
                : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
            }`}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <AppIcon name={tile.icon} size={16} />
            </span>
            <p className="mt-2 text-sm font-extrabold">{tile.name}</p>
            <p className="text-[11px] text-slate-500">{tile.hint}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="stat-card"><div><p className="text-xl font-bold">{rows.length}</p><p className="text-xs text-gray-500">Rows</p></div></div>
        <div className="stat-card"><div><p className="text-xl font-bold">{fmtCurrency(totalAmount)}</p><p className="text-xs text-gray-500">Amount</p></div></div>
        <div className="stat-card"><div><p className="text-xl font-bold">{report}</p><p className="text-xs text-gray-500">Report</p></div></div>
        <div className="stat-card"><div><p className="text-xl font-bold">{statuses.length - 1}</p><p className="text-xs text-gray-500">Statuses</p></div></div>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
        <select className="form-input" value={report} onChange={e => setReport(e.target.value)}>{reportTypes.map(r => <option key={r}>{r}</option>)}</select>
        <input className="form-input md:col-span-2" placeholder="Search..." value={query} onChange={e => setQuery(e.target.value)} />
        <DateInput value={from} onChange={setFrom} />
        <DateInput value={to} onChange={setTo} />
        <select className="form-input" value={status} onChange={e => setStatus(e.target.value)}>{statuses.map(s => <option key={s}>{s}</option>)}</select>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 z-10 text-xs uppercase text-gray-500">
            <tr>{columns.map(c => <th key={c.header} className="px-4 py-3 text-left whitespace-nowrap">{c.header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={`${row.type}-${idx}`} className="border-t border-gray-100 dark:border-gray-700">
                {columns.map(c => <td key={c.header} className="px-4 py-3 whitespace-nowrap">{c.accessor(row)}</td>)}
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="px-4 py-8 text-gray-400" colSpan={columns.length}>No report rows found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
