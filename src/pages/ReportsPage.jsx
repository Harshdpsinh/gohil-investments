import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useClients } from '../hooks/useClients'
import { usePolicies } from '../hooks/usePolicies'
import DateInput from '../components/ui/DateInput'
import { exportToCSV, exportToExcel, exportToPDF } from '../utils/exportUtils'
import { daysUntilPolicyDue, fmtCurrency, fmtDate, parseAnyDate } from '../utils/dateUtils'
import { getAllCommissionTransactions, getAllEndorsements, getAllLeads, subscribeClaims, subscribeTasks } from '../firebase/firestore'

const reportTypes = [
  'Business',
  'Renewals',
  'Claims',
  'Commission',
  'Leads',
  'Clients',
  'Pending Work',
  'Cross Sell',
]

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
  const [tasks, setTasks] = useState([])
  const [leads, setLeads] = useState([])
  const [endorsements, setEndorsements] = useState([])
  const [commissionTx, setCommissionTx] = useState([])
  const [report, setReport] = useState('Business')
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('All')

  useEffect(() => {
    const unsubClaims = subscribeClaims(setClaims, err => toast.error(err.message || 'Claims load failed.'))
    const unsubTasks = subscribeTasks(setTasks, err => toast.error(err.message || 'Tasks load failed.'))
    Promise.all([getAllLeads(), getAllEndorsements(), getAllCommissionTransactions()])
      .then(([l, e, c]) => { setLeads(l); setEndorsements(e); setCommissionTx(c) })
      .catch(err => toast.error(err.message || 'Report data load failed.'))
    return () => { unsubClaims(); unsubTasks() }
  }, [])

  const rows = useMemo(() => {
    const q = query.toLowerCase()
    const activePolicies = policies.filter(p => !['Renewed-Out', 'Cancelled'].includes(p.status))
    const clientMap = Object.fromEntries(clients.map(c => [c.id, c]))

    const baseRows = {
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
        amount: Number(c.claimAmount || c.amount || 0),
        detail: c.claimNumber || '',
      })),
      Commission: commissionTx.map(c => ({
        type: 'Commission',
        date: c.payoutDate || c.createdAt,
        client: c.clientName,
        policyNumber: c.policyNumber,
        insurer: c.insurer,
        product: c.referenceNumber || '',
        status: c.status || '',
        amount: Number(c.netReceived || c.receivedCommission || 0),
        detail: `Expected ${fmtCurrency(c.expectedCommission)} | Diff ${fmtCurrency(c.difference)}`,
      })),
      Leads: leads.map(l => ({
        type: 'Lead',
        date: l.followUpDate || l.createdAt,
        client: l.name,
        policyNumber: '',
        insurer: l.source || '',
        product: l.insuranceNeed || '',
        status: l.status || '',
        amount: Number(l.leadValue || 0),
        detail: l.assignedUserName || '',
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
      'Pending Work': [
        ...tasks.filter(t => !t.done).map(t => ({
          type: 'Task',
          date: t.dueDate || t.createdAt,
          client: t.clientName || '',
          policyNumber: t.policyNumber || '',
          insurer: t.priority || '',
          product: t.type || '',
          status: 'Pending',
          amount: 0,
          detail: t.title || t.note || '',
        })),
        ...endorsements.filter(e => !['completed', 'approved', 'rejected'].includes(e.status)).map(e => ({
          type: 'Endorsement',
          date: e.requestedDate,
          client: e.clientName,
          policyNumber: e.policyNumber,
          insurer: '',
          product: e.type,
          status: e.status,
          amount: 0,
          detail: e.notes || '',
        })),
      ],
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
  }, [clients, policies, claims, tasks, leads, endorsements, commissionTx, report, query, from, to, status])

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
          <p className="text-sm text-gray-500 dark:text-gray-400">Business, renewal, claim, commission, lead, client, pending work, and cross-sell views.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-secondary text-xs" onClick={() => exportToCSV(rows, columns, `${report.toLowerCase()}_report`)}>CSV</button>
          <button className="btn-secondary text-xs" onClick={() => exportToExcel(rows, columns, report, `${report.toLowerCase()}_report`)}>Excel</button>
          <button className="btn-secondary text-xs" onClick={() => exportToPDF(rows, columns, `${report} Report`, `${report.toLowerCase()}_report`)}>PDF</button>
        </div>
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
