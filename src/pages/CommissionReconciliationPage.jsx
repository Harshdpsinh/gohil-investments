import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { usePolicies } from '../hooks/usePolicies'
import { parseImportFile } from '../utils/exportUtils'
import { fmtCurrency, fmtDate } from '../utils/dateUtils'
import { uploadSharedDocument } from '../firebase/storage'
import {
  addCommissionReconciliationRow,
  addCommissionTransaction,
  createCommissionReconciliationBatch,
  getAllCommissionReconciliationBatches,
  getCommissionReconciliationRows,
  updateCommissionReconciliationBatch,
  updateCommissionReconciliationRow,
  updatePolicy,
} from '../firebase/firestore'

function clean(value) {
  return String(value || '').trim()
}

function numberValue(value) {
  const n = Number(clean(value).replace(/[₹,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function pick(row, names) {
  const keys = Object.keys(row || {})
  const wanted = names.map(n => n.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const key = keys.find(k => wanted.includes(k.toLowerCase().replace(/[^a-z0-9]/g, '')))
  return key ? row[key] : ''
}

function confidenceFor(row, policies) {
  const policyNo = clean(row.uploadedPolicyNumber).toLowerCase()
  const client = clean(row.uploadedClientName).toLowerCase()
  const premium = Number(row.uploadedPremium || 0)
  if (!policyNo && !client) return { level: 'unmatched', policy: null }

  const exact = policies.find(p => clean(p.policyNumber).toLowerCase() === policyNo)
  if (exact) return { level: 'high', policy: exact }

  const partial = policyNo && policies.find(p => clean(p.policyNumber).toLowerCase().includes(policyNo) || policyNo.includes(clean(p.policyNumber).toLowerCase()))
  if (partial) return { level: 'medium', policy: partial }

  const fuzzy = policies.find(p => {
    const nameMatch = client && clean(p.clientName).toLowerCase().includes(client.split(' ')[0] || client)
    const premiumMatch = premium && Math.abs((Number(p.premium) || 0) - premium) <= Math.max(50, premium * 0.02)
    return nameMatch && premiumMatch
  })
  if (fuzzy) return { level: 'medium', policy: fuzzy }
  return { level: 'unmatched', policy: null }
}

export default function CommissionReconciliationPage() {
  const { policies } = usePolicies()
  const [batches, setBatches] = useState([])
  const [rows, setRows] = useState([])
  const [selectedBatch, setSelectedBatch] = useState('')
  const [file, setFile] = useState(null)
  const [insurer, setInsurer] = useState('')
  const [statementMonth, setStatementMonth] = useState('')
  const [progress, setProgress] = useState('')
  const [posting, setPosting] = useState('')

  const loadBatches = async () => setBatches(await getAllCommissionReconciliationBatches())

  useEffect(() => {
    loadBatches().catch(err => toast.error(err.message || 'Could not load reconciliation batches.'))
  }, [])

  const loadRows = async batchId => {
    setSelectedBatch(batchId)
    setRows(batchId ? await getCommissionReconciliationRows(batchId) : [])
  }

  const createBatch = async e => {
    e.preventDefault()
    if (!file) {
      toast.error('Select a statement file first.')
      return
    }
    setProgress('Creating reconciliation batch...')
    try {
      const batchRef = await createCommissionReconciliationBatch({
        insurer,
        statementMonth,
        originalFileName: file.name,
        status: 'review',
      })
      const batchId = batchRef.id
      const upload = await uploadSharedDocument('commission', batchId, file, pct => setProgress(`Uploading statement ${pct}%...`))

      let importedRows = []
      const canParse = /\.(csv|xlsx?|xls)$/i.test(file.name)
      if (canParse) {
        setProgress('Reading statement rows...')
        importedRows = await parseImportFile(file)
      }

      if (importedRows.length === 0) {
        await updateCommissionReconciliationBatch(batchId, {
          originalFileUrl: upload.url,
          status: 'manual-review',
          summary: { rows: 0, note: 'File uploaded. Manual entry/review needed for PDF or unrecognized statement.' },
        })
      } else {
        let count = 0
        for (const source of importedRows) {
          const draft = {
            batchId,
            uploadedClientName: pick(source, ['client', 'client name', 'customer name', 'insured name']),
            uploadedPolicyNumber: pick(source, ['policy number', 'policy no', 'policy']),
            uploadedProposalNumber: pick(source, ['proposal number', 'proposal no']),
            uploadedPremium: numberValue(pick(source, ['premium', 'net premium', 'gross premium'])),
            uploadedCommission: numberValue(pick(source, ['commission', 'gross commission', 'brokerage'])),
            tds: numberValue(pick(source, ['tds'])),
            gst: numberValue(pick(source, ['gst'])),
            netPaid: numberValue(pick(source, ['net paid', 'net amount', 'net commission'])),
          }
          const match = confidenceFor(draft, policies)
          await addCommissionReconciliationRow({
            ...draft,
            matchedPolicyId: match.policy?.id || '',
            matchedPolicyNumber: match.policy?.policyNumber || '',
            matchConfidence: match.level,
            status: match.level === 'high' ? 'suggested' : 'review',
          })
          count += 1
          if (count % 25 === 0) setProgress(`Imported ${count}/${importedRows.length} rows...`)
        }
        await updateCommissionReconciliationBatch(batchId, {
          originalFileUrl: upload.url,
          status: 'review',
          summary: { rows: importedRows.length },
        })
      }

      await loadBatches()
      await loadRows(batchId)
      setFile(null)
      setProgress('')
      toast.success('Commission statement ready for review.')
    } catch (err) {
      setProgress('')
      toast.error(err.message || 'Could not create reconciliation batch.')
    }
  }

  const acceptRow = async row => {
    if (!row.matchedPolicyId) {
      toast.error('Select or match a policy before accepting this row.')
      return
    }
    if (posting) return
    setPosting(row.id)
    try {
      const policy = policies.find(p => p.id === row.matchedPolicyId)
      const expected = Math.round(((Number(policy?.premium) || 0) * (Number(policy?.fyCommission || policy?.ryCommission) || 0)) / 100)
      const received = Number(row.netPaid || row.uploadedCommission || 0)
      await addCommissionTransaction({
        policyId: row.matchedPolicyId,
        policyNumber: policy?.policyNumber || row.matchedPolicyNumber,
        clientId: policy?.clientId || '',
        clientName: policy?.clientName || row.uploadedClientName,
        insurer: policy?.insurer || insurer,
        premium: policy?.premium || row.uploadedPremium,
        expectedCommission: expected,
        receivedCommission: Number(row.uploadedCommission || received),
        tds: row.tds,
        gst: row.gst,
        netReceived: received,
        difference: received - expected,
        payoutMonth: statementMonth,
        status: received === expected ? 'exact matched' : received < expected ? 'short received' : 'excess received',
        reconciliationBatchId: row.batchId,
      })
      await updatePolicy(row.matchedPolicyId, {
        receivedCommission: received,
        pendingCommission: Math.max(0, expected - received),
        commissionStatus: received >= expected ? 'received' : 'partial',
        reconciliationBatchId: row.batchId,
      })
      await updateCommissionReconciliationRow(row.id, { status: 'posted' })
      await loadRows(row.batchId)
      toast.success('Commission posted.')
    } catch (err) {
      toast.error(err.message || 'Could not post commission.')
    } finally {
      setPosting('')
    }
  }

  const summary = useMemo(() => ({
    total: rows.length,
    high: rows.filter(r => r.matchConfidence === 'high').length,
    review: rows.filter(r => r.status === 'review' || r.status === 'suggested').length,
    posted: rows.filter(r => r.status === 'posted').length,
  }), [rows])

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Commission Reconciliation</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Upload insurer statements, review matches, and post commission only after confirmation.</p>
      </div>

      <form onSubmit={createBatch} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <input className="form-input" placeholder="Insurer" value={insurer} onChange={e => setInsurer(e.target.value)} />
        <input className="form-input" placeholder="Statement month" value={statementMonth} onChange={e => setStatementMonth(e.target.value)} />
        <input className="form-input md:col-span-2" type="file" accept=".csv,.xlsx,.xls,.pdf,.jpg,.jpeg,.png,.webp" onChange={e => setFile(e.target.files?.[0] || null)} />
        <button className="btn-primary" disabled={Boolean(progress)}>{progress ? 'Working...' : 'Upload & Review'}</button>
        {progress && <p className="md:col-span-5 text-sm text-blue-600">{progress}</p>}
      </form>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="stat-card"><div><p className="text-xl font-bold">{summary.total}</p><p className="text-xs text-gray-500">Rows</p></div></div>
        <div className="stat-card"><div><p className="text-xl font-bold text-green-600">{summary.high}</p><p className="text-xs text-gray-500">High Match</p></div></div>
        <div className="stat-card"><div><p className="text-xl font-bold text-yellow-600">{summary.review}</p><p className="text-xs text-gray-500">Need Review</p></div></div>
        <div className="stat-card"><div><p className="text-xl font-bold text-blue-600">{summary.posted}</p><p className="text-xs text-gray-500">Posted</p></div></div>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <select className="form-input max-w-md" value={selectedBatch} onChange={e => loadRows(e.target.value)}>
          <option value="">Select reconciliation batch</option>
          {batches.map(b => <option key={b.id} value={b.id}>{fmtDate(b.createdAt)} - {b.insurer || 'Statement'} - {b.originalFileName || b.id}</option>)}
        </select>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 z-10 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Uploaded Client</th><th className="px-4 py-3 text-left">Uploaded Policy</th><th className="px-4 py-3 text-left">Matched Policy</th><th className="px-4 py-3 text-left">Premium</th><th className="px-4 py-3 text-left">Net Paid</th><th className="px-4 py-3 text-left">Confidence</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id} className="border-t border-gray-100 dark:border-gray-700">
                <td className="px-4 py-3">{row.uploadedClientName || '-'}</td>
                <td className="px-4 py-3">{row.uploadedPolicyNumber || '-'}</td>
                <td className="px-4 py-3">{row.matchedPolicyNumber || '-'}</td>
                <td className="px-4 py-3">{fmtCurrency(row.uploadedPremium)}</td>
                <td className="px-4 py-3">{fmtCurrency(row.netPaid || row.uploadedCommission)}</td>
                <td className="px-4 py-3"><span className="badge badge-blue">{row.matchConfidence}</span></td>
                <td className="px-4 py-3">{row.status}</td>
                <td className="px-4 py-3">
                  <button className="text-blue-600 font-semibold disabled:opacity-50" disabled={row.status === 'posted' || posting === row.id} onClick={() => acceptRow(row)}>
                    {posting === row.id ? 'Posting...' : row.status === 'posted' ? 'Posted' : 'Accept'}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="px-4 py-8 text-gray-400" colSpan="8">No rows selected. Upload a statement or select a batch.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
