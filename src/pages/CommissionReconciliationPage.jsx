import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { usePolicies } from '../hooks/usePolicies'
import { parseImportFile } from '../utils/exportUtils'
import { fmtCurrency, fmtDate } from '../utils/dateUtils'
import { KNOWN_INSURERS } from '../utils/constants'
import { uploadSharedDocument } from '../firebase/storage'
import {
  addClient,
  addCommissionReconciliationRow,
  addCommissionTransaction,
  addPolicy,
  createCommissionReconciliationBatch,
  findClientByMobileOrName,
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

function friendlyFirebaseError(err, fallback) {
  if (err?.code === 'permission-denied' || /permission/i.test(err?.message || '')) {
    return 'Permission blocked by Firebase rules. Publish the latest Firestore and Storage rules, then try again.'
  }
  return err?.message || fallback
}

const AGENT_HEADER_WORDS = ['agent', 'advisor', 'adviser', 'broker', 'subbroker', 'sub broker', 'sm', 'sales manager', 'rm', 'relationship manager', 'posp']

function headerKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isAgentHeader(header) {
  const raw = String(header || '').toLowerCase()
  const compact = headerKey(header)
  return AGENT_HEADER_WORDS.some(word => raw.includes(word) || compact.includes(headerKey(word)))
}

function pick(row, names, { ignoreAgentColumns = false } = {}) {
  const keys = Object.keys(row || {})
  const wanted = names.map(headerKey)
  const key = keys.find(k => wanted.includes(headerKey(k)) && (!ignoreAgentColumns || !isAgentHeader(k)))
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

function monthOptions(count = 36) {
  const now = new Date()
  return Array.from({ length: count }, (_, index) => {
    const d = new Date(now.getFullYear(), now.getMonth() - index, 1)
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const value = `${d.getFullYear()}-${month}`
    const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    return { value, label }
  })
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
  const [includeRow, setIncludeRow] = useState(null)
  const [includeForm, setIncludeForm] = useState({
    clientName: '',
    policyNumber: '',
    insurer: '',
    premium: '',
    policyType: 'Health',
    planName: '',
  })

  const insurerOptions = useMemo(() => {
    const policyInsurers = policies.map(p => clean(p.insurer)).filter(Boolean)
    return Array.from(new Set([...KNOWN_INSURERS, ...policyInsurers])).sort((a, b) => a.localeCompare(b))
  }, [policies])

  const statementMonthOptions = useMemo(() => monthOptions(48), [])

  const loadBatches = async () => setBatches(await getAllCommissionReconciliationBatches())

  useEffect(() => {
    loadBatches().catch(err => toast.error(friendlyFirebaseError(err, 'Could not load reconciliation batches.')))
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
            uploadedClientName: pick(source, ['client', 'client name', 'customer name', 'insured name', 'policy holder', 'policyholder'], { ignoreAgentColumns: true }),
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
      toast.error(friendlyFirebaseError(err, 'Could not create reconciliation batch.'))
    }
  }

  const acceptRow = async row => {
    if (!row.matchedPolicyId) {
      toast.error('This policy is not in CRM yet. Include it first, then reconcile.')
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
      toast.error(friendlyFirebaseError(err, 'Could not post commission.'))
    } finally {
      setPosting('')
    }
  }

  const openIncludePolicy = row => {
    setIncludeRow(row)
    setIncludeForm({
      clientName: row.uploadedClientName || '',
      policyNumber: row.uploadedPolicyNumber || '',
      insurer: insurer || '',
      premium: row.uploadedPremium || '',
      policyType: 'Health',
      planName: '',
    })
  }

  const includeMissingPolicy = async e => {
    e.preventDefault()
    if (!includeRow || posting) return
    if (!includeForm.clientName.trim()) {
      toast.error('Client name is required to include this policy.')
      return
    }
    if (!includeForm.policyNumber.trim()) {
      toast.error('Policy number is required to include this policy.')
      return
    }
    setPosting(includeRow.id)
    try {
      const existingClient = await findClientByMobileOrName('', includeForm.clientName)
      const clientId = existingClient?.id || (await addClient({
        name: includeForm.clientName,
        mobile: '',
        email: '',
        kycStatus: 'Pending',
        notes: 'Created from commission reconciliation unmatched statement row.',
      })).id
      const policyRef = await addPolicy({
        policyNumber: includeForm.policyNumber,
        clientId,
        clientName: includeForm.clientName,
        policyType: includeForm.policyType,
        insurer: includeForm.insurer,
        planName: includeForm.planName,
        premium: includeForm.premium,
        frequency: 'Yearly',
        status: 'Active',
        notes: 'Included from commission statement before reconciliation.',
      })
      await updateCommissionReconciliationRow(includeRow.id, {
        matchedPolicyId: policyRef.id,
        matchedPolicyNumber: includeForm.policyNumber,
        matchConfidence: 'manual',
        status: 'review',
      })
      await loadRows(includeRow.batchId)
      setIncludeRow(null)
      toast.success('Policy included. You can reconcile this row now.')
    } catch (err) {
      toast.error(friendlyFirebaseError(err, 'Could not include missing policy.'))
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
        <div>
          <input
            className="form-input"
            list="commission-insurer-options"
            placeholder="Select insurer"
            value={insurer}
            onChange={e => setInsurer(e.target.value)}
          />
          <datalist id="commission-insurer-options">
            {insurerOptions.map(name => <option key={name} value={name} />)}
          </datalist>
        </div>
        <select className="form-input" value={statementMonth} onChange={e => setStatementMonth(e.target.value)}>
          <option value="">Select statement month</option>
          {statementMonthOptions.map(month => <option key={month.value} value={month.value}>{month.label}</option>)}
        </select>
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
                  {row.matchedPolicyId ? (
                    <button className="text-blue-600 font-semibold disabled:opacity-50" disabled={row.status === 'posted' || posting === row.id} onClick={() => acceptRow(row)}>
                      {posting === row.id ? 'Posting...' : row.status === 'posted' ? 'Posted' : 'Accept'}
                    </button>
                  ) : (
                    <button className="text-purple-600 font-semibold disabled:opacity-50" disabled={posting === row.id} onClick={() => openIncludePolicy(row)}>
                      Include Policy
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="px-4 py-8 text-gray-400" colSpan="8">No rows selected. Upload a statement or select a batch.</td></tr>}
          </tbody>
        </table>
      </div>

      {includeRow && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <form onSubmit={includeMissingPolicy} className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full p-5 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Include Missing Policy</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">This policy was found in the commission statement but not in CRM. Add it first, then reconcile the commission.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className="form-input" placeholder="Client name" value={includeForm.clientName} onChange={e => setIncludeForm({ ...includeForm, clientName: e.target.value })} />
              <input className="form-input" placeholder="Policy number" value={includeForm.policyNumber} onChange={e => setIncludeForm({ ...includeForm, policyNumber: e.target.value })} />
              <input className="form-input" list="include-insurer-options" placeholder="Insurer" value={includeForm.insurer} onChange={e => setIncludeForm({ ...includeForm, insurer: e.target.value })} />
              <datalist id="include-insurer-options">
                {insurerOptions.map(name => <option key={name} value={name} />)}
              </datalist>
              <select className="form-input" value={includeForm.policyType} onChange={e => setIncludeForm({ ...includeForm, policyType: e.target.value })}>
                {['Health', 'Life', 'Motor', 'Home', 'Travel', 'Marine', 'Fire', 'Other'].map(type => <option key={type}>{type}</option>)}
              </select>
              <input className="form-input" type="number" placeholder="Premium" value={includeForm.premium} onChange={e => setIncludeForm({ ...includeForm, premium: e.target.value })} />
              <input className="form-input sm:col-span-2" placeholder="Plan name" value={includeForm.planName} onChange={e => setIncludeForm({ ...includeForm, planName: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setIncludeRow(null)}>Cancel</button>
              <button className="btn-primary" disabled={posting === includeRow.id}>{posting === includeRow.id ? 'Including...' : 'Include Policy'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
