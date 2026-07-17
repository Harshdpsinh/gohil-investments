import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { usePolicies } from '../hooks/usePolicies'
import { useClients } from '../hooks/useClients'
import { fmtCurrency, fmtDate } from '../utils/dateUtils'
import { KNOWN_INSURERS } from '../utils/constants'
import { uploadSharedDocument } from '../firebase/storage'
import { useAuth } from '../hooks/useAuth'
import {
  addClient,
  addCommissionReconciliationRows,
  addCommissionImportTemplate,
  addCommissionTransaction,
  addPolicy,
  createCommissionReconciliationBatch,
  findCommissionBatchByFileHash,
  findClientByMobileOrName,
  getAllCommissionReconciliationBatches,
  getAllCommissionTransactions,
  getAllCommissionImportTemplates,
  getCommissionReconciliationRows,
  postCommissionReconciliation,
  updateCommissionReconciliationBatch,
  updateCommissionReconciliationRow,
} from '../firebase/firestore'
import {
  bestCommissionMatches,
  calculateCommission,
  hashCommissionFile,
  hashCommissionRow,
  parseCommissionFile,
  validateCommissionRow,
} from '../utils/commissionUtils'

function clean(value) {
  return String(value || '').trim()
}

function friendlyFirebaseError(err, fallback) {
  if (err?.code === 'permission-denied' || /permission/i.test(err?.message || '')) {
    return 'Permission blocked by Firebase rules. Publish the latest Firestore and Storage rules, then try again.'
  }
  return err?.message || fallback
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

const MAPPING_FIELDS = [
  ['clientName', 'Client name'], ['policyNumber', 'Policy number'], ['planName', 'Plan name'], ['insurer', 'Insurer'],
  ['category', 'Category'], ['premium', 'Premium'], ['commission', 'Gross commission'], ['commissionRate', 'Commission rate'],
  ['reward', 'Reward'], ['gst', 'GST'], ['tds', 'TDS'], ['deduction', 'Deduction'], ['netCommission', 'Net commission'],
  ['commissionDate', 'Commission date'], ['mobile', 'Mobile'], ['email', 'Email'], ['pan', 'PAN'], ['remarks', 'Remarks'],
]

const STATUS_STYLES = {
  'exact-match': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  'needs-confirmation': 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  duplicate: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  unmatched: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  error: 'bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-200',
  ignored: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  posted: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  review: 'bg-amber-100 text-amber-700',
}

function StatusChip({ status }) {
  return <span className={`commission-status capitalize ${STATUS_STYLES[status] || STATUS_STYLES.review}`}>{String(status || 'review').replace(/-/g, ' ')}</span>
}

export default function CommissionReconciliationPage() {
  const { policies } = usePolicies()
  const { clients } = useClients()
  const { isAdmin, user } = useAuth()
  const [batches, setBatches] = useState([])
  const [rows, setRows] = useState([])
  const [selectedBatch, setSelectedBatch] = useState('')
  const [file, setFile] = useState(null)
  const [insurer, setInsurer] = useState('')
  const [statementMonth, setStatementMonth] = useState('')
  const [progress, setProgress] = useState('')
  const [posting, setPosting] = useState('')
  const [queryText, setQueryText] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [confidenceMin, setConfidenceMin] = useState(0)
  const [expandedRow, setExpandedRow] = useState('')
  const [bulkPosting, setBulkPosting] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [existingTransactions, setExistingTransactions] = useState([])
  const [manualForm, setManualForm] = useState({ policyId: '', premium: '', commissionRate: '', grossCommission: '', rewardCommission: '', gst: '', tds: '', deduction: '', netReceived: '', payoutMonth: '', remarks: '' })
  const [mappingTemplates, setMappingTemplates] = useState([])
  const [mappingProfileId, setMappingProfileId] = useState('')
  const [mappingForm, setMappingForm] = useState({})
  const [showMapping, setShowMapping] = useState(false)
  const [loadingRows, setLoadingRows] = useState(false)
  const [pageError, setPageError] = useState('')
  const [includeRow, setIncludeRow] = useState(null)
  const [matchRow, setMatchRow] = useState(null)
  const [matchQuery, setMatchQuery] = useState('')
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

  const candidatePolicies = useMemo(() => {
    if (!matchRow) return []
    const q = clean(matchQuery).toLowerCase()
    const ranked = bestCommissionMatches(matchRow, policies, clients).map(match => match.policy)
    const searched = q ? policies.filter(policy => [policy.policyNumber, policy.clientName, policy.insurer, policy.planName, policy.premium].join(' ').toLowerCase().includes(q)) : []
    return Array.from(new Map([...ranked, ...searched].map(policy => [policy.id, policy])).values()).slice(0, 30)
  }, [matchRow, matchQuery, policies, clients])

  const loadBatches = async () => setBatches(await getAllCommissionReconciliationBatches())

  useEffect(() => {
    if (!isAdmin) return
    Promise.all([getAllCommissionReconciliationBatches(), getAllCommissionTransactions(), getAllCommissionImportTemplates()])
      .then(([batchRows, transactions, templates]) => { setBatches(batchRows); setExistingTransactions(transactions); setMappingTemplates(templates) })
      .catch(err => { const message = friendlyFirebaseError(err, 'Could not load reconciliation batches.'); setPageError(message); toast.error(message) })
  }, [isAdmin])

  const loadRows = async batchId => {
    setSelectedBatch(batchId)
    const batch = batches.find(item => item.id === batchId)
    if (batch) {
      setInsurer(batch.insurer || '')
      setStatementMonth(batch.statementMonth || '')
    }
    setLoadingRows(true)
    setPageError('')
    try { setRows(batchId ? await getCommissionReconciliationRows(batchId) : []) }
    catch (err) { const message = friendlyFirebaseError(err, 'Could not load reconciliation rows.'); setPageError(message); toast.error(message) }
    finally { setLoadingRows(false) }
  }

  const chooseMappingProfile = profileId => {
    setMappingProfileId(profileId)
    const profile = mappingTemplates.find(item => item.id === profileId)
    setMappingForm(profile?.fieldMap || {})
    if (profile?.insurer) setInsurer(profile.insurer)
  }

  const saveMappingProfile = async () => {
    if (!insurer.trim()) { toast.error('Select an insurer before saving a mapping.'); return }
    const usefulFields = Object.fromEntries(Object.entries(mappingForm).filter(([, header]) => clean(header)))
    if (!usefulFields.policyNumber && !usefulFields.clientName) { toast.error('Map at least Policy number or Client name.'); return }
    setProgress('Saving insurer mapping...')
    try {
      await addCommissionImportTemplate({ name: `${insurer} statement mapping`, insurer, fileType: 'statement', fieldMap: usefulFields, active: true })
      const templates = await getAllCommissionImportTemplates()
      setMappingTemplates(templates)
      const saved = templates.find(item => item.insurer === insurer && item.name === `${insurer} statement mapping`)
      if (saved) setMappingProfileId(saved.id)
      toast.success('Column mapping saved for future imports.')
    } catch (err) {
      toast.error(friendlyFirebaseError(err, 'Could not save mapping profile.'))
    } finally {
      setProgress('')
    }
  }

  const createBatch = async e => {
    e.preventDefault()
    if (!file) {
      toast.error('Select a statement file first.')
      return
    }
    if (!insurer.trim()) {
      toast.error('Select the insurer for this statement.')
      return
    }
    if (!statementMonth) {
      toast.error('Select the commission statement month.')
      return
    }
    setProgress('Creating reconciliation batch...')
    try {
      const fileHash = await hashCommissionFile(file)
      const existingBatch = await findCommissionBatchByFileHash(fileHash)
      if (existingBatch && !window.confirm(`This exact file was already uploaded on ${fmtDate(existingBatch.createdAt)}. Upload it again for review?`)) {
        setProgress('')
        await loadRows(existingBatch.id)
        return
      }
      const batchRef = await createCommissionReconciliationBatch({
        insurer,
        statementMonth,
        originalFileName: file.name,
        fileHash,
        fileType: file.name.split('.').pop()?.toLowerCase() || '',
        uploadedBy: user?.uid || '',
        uploadedByEmail: user?.email || '',
        mappingProfileId,
        status: 'review',
      })
      const batchId = batchRef.id
      let upload = { url: '' }
      let uploadError = ''
      try {
        upload = await uploadSharedDocument('commission', batchId, file, pct => setProgress(`Uploading statement ${pct}%...`))
      } catch (uploadErr) {
        uploadError = friendlyFirebaseError(uploadErr, 'Statement file could not be stored.')
        toast.error('File storage was skipped, but reconciliation will continue.')
      }

      const isPdf = /\.pdf$/i.test(file.name)
      const parsed = await parseCommissionFile(file, { insurer, statementMonth, fieldMap: mappingForm }, message => setProgress(message))
      const importedRows = parsed.rows

      if (importedRows.length === 0) {
        await updateCommissionReconciliationBatch(batchId, {
          originalFileUrl: upload.url,
          extractedText: parsed.extractedText || '',
          status: 'manual-review',
          summary: {
            rows: 0,
            note: uploadError
              ? `Manual entry/review needed. File storage issue: ${uploadError}`
              : isPdf
                ? 'PDF text/OCR was retained for manual review because no reliable table rows were detected.'
                : 'File uploaded. Manual entry/review needed for unrecognized statement format.',
          },
        })
      } else {
        const seenHashes = new Set()
        const preparedRows = []
        for (const importedRow of importedRows) {
          const rowHash = await hashCommissionRow(importedRow)
          const errors = validateCommissionRow(importedRow)
          const matches = bestCommissionMatches(importedRow, policies, clients)
          const best = matches[0]
          const duplicateInFile = seenHashes.has(rowHash)
          const duplicatePreviouslyPosted = existingTransactions.some(transaction => transaction.sourceRowHash === rowHash)
          seenHashes.add(rowHash)
          const status = duplicateInFile || duplicatePreviouslyPosted
            ? 'duplicate'
            : errors.length
              ? 'error'
              : best?.autoConfirmable
                ? 'exact-match'
                : best
                  ? 'needs-confirmation'
                  : 'unmatched'
          preparedRows.push({
            ...importedRow,
            batchId,
            rowHash,
            matchedPolicyId: best?.policy?.id || '',
            matchedPolicyNumber: best?.policy?.policyNumber || '',
            matchConfidence: best?.autoConfirmable ? 'high' : best ? 'suggested' : 'unmatched',
            matchScore: best?.score || 0,
            matchReason: best?.reason || 'No matching policy found',
            matchConflicts: best?.conflicts || [],
            candidatePolicyIds: matches.map(match => match.policy.id),
            status,
            note: errors.join('; '),
          })
        }
        await addCommissionReconciliationRows(preparedRows, (done, total) => setProgress(`Importing ${done}/${total} records...`))
        const countByStatus = status => preparedRows.filter(row => row.status === status).length
        await updateCommissionReconciliationBatch(batchId, {
          originalFileUrl: upload.url,
          extractedText: parsed.extractedText || '',
          status: 'review',
          summary: {
            rows: importedRows.length,
            exact: countByStatus('exact-match'),
            review: countByStatus('needs-confirmation'),
            duplicates: countByStatus('duplicate'),
            unmatched: countByStatus('unmatched'),
            errors: countByStatus('error'),
            posted: 0,
            uploadError,
          },
        })
      }

      await loadBatches()
      await loadRows(batchId)
      setFile(null)
      setProgress('')
      if (importedRows.length === 0 && isPdf) {
        toast.error('PDF saved for manual review; no reliable table rows were detected.')
      } else {
        toast.success('Commission statement ready for review.')
      }
    } catch (err) {
      setProgress('')
      const message = friendlyFirebaseError(err, 'Could not create reconciliation batch.')
      setPageError(message)
      toast.error(message)
    }
  }

  const acceptRow = async row => {
    if (!row.matchedPolicyId) {
      toast.error('This policy is not in CRM yet. Include it first, then reconcile.')
      return
    }
    if (row.status === 'error') {
      toast.error(row.note || 'Correct the row validation errors before posting.')
      return false
    }
    if (row.status === 'duplicate' && !window.confirm('A matching commission row already exists. Force import this duplicate?')) return false
    if (posting) return
    setPosting(row.id)
    try {
      const policy = policies.find(p => p.id === row.matchedPolicyId)
      if (!policy) throw new Error('The matched policy no longer exists.')
      const batch = batches.find(item => item.id === row.batchId)
      const rate = Number((Number(policy.policyYear || 1) > 1 ? policy.ryCommission : policy.fyCommission) || policy.fyCommission || policy.ryCommission || row.commissionRate || 0)
      const expected = Math.round(((Number(policy.premium) || 0) * rate) / 100)
      const calculation = calculateCommission(row)
      const received = Number(calculation.netPaid || calculation.grossCommission || 0)
      const errors = validateCommissionRow({ ...row, ...calculation })
      if (errors.length) throw new Error(errors.join('. '))
      const basePostingKey = `commission_${row.rowHash || row.id}`.replace(/[^a-zA-Z0-9_-]/g, '')
      const postingKey = row.postingKey || (row.status === 'duplicate' ? `${basePostingKey}_force_${Date.now()}` : basePostingKey)
      await postCommissionReconciliation({
        rowId: row.id,
        policyId: row.matchedPolicyId,
        transactionData: {
        policyId: row.matchedPolicyId,
        policyNumber: policy?.policyNumber || row.matchedPolicyNumber,
        clientId: policy?.clientId || '',
        clientName: policy?.clientName || row.uploadedClientName,
        insurer: policy?.insurer || insurer,
        premium: policy?.premium || row.uploadedPremium,
        expectedCommission: expected,
        receivedCommission: calculation.grossCommission,
        grossCommission: calculation.grossCommission,
        commissionRate: row.commissionRate || rate,
        rewardCommission: calculation.rewardCommission,
        deduction: calculation.deduction,
        tds: calculation.tds,
        gst: calculation.gst,
        netReceived: received,
        difference: received - expected,
        payoutMonth: row.statementMonth || batch?.statementMonth || '',
        status: received === expected ? 'exact matched' : received < expected ? 'short received' : 'excess received',
        reconciliationBatchId: row.batchId,
        reconciliationRowId: row.id,
        postingKey,
        matchingMethod: row.matchConfidence === 'manual' ? 'manual-confirmed' : 'auto-suggested-confirmed',
        sourceType: 'import',
        sourceFileName: batch?.originalFileName || '',
        sourceFileUrl: batch?.originalFileUrl || '',
        sourceFileHash: batch?.fileHash || '',
        sourceRowHash: row.rowHash || '',
        createdBy: user?.uid || '',
        createdByEmail: user?.email || '',
        remarks: row.remarks || row.note || '',
        },
        policySummary: {
          receivedCommission: received,
          pendingCommission: Math.max(0, expected - received),
          commissionStatus: received >= expected ? 'received' : 'partial',
          reconciliationBatchId: row.batchId,
          lastCommissionTransactionId: postingKey,
        },
      })
      const refreshedRows = await getCommissionReconciliationRows(row.batchId)
      setRows(refreshedRows)
      const postedCount = refreshedRows.filter(item => item.status === 'posted').length
      const ignoredCount = refreshedRows.filter(item => item.status === 'ignored').length
      await updateCommissionReconciliationBatch(row.batchId, {
        status: postedCount + ignoredCount >= refreshedRows.length ? 'completed' : 'review',
        summary: { ...(batch?.summary || {}), rows: refreshedRows.length, posted: postedCount, ignored: ignoredCount },
        ...(postedCount + ignoredCount >= refreshedRows.length ? { completedAt: new Date() } : {}),
      })
      await loadBatches()
      toast.success('Commission posted.')
      return true
    } catch (err) {
      toast.error(friendlyFirebaseError(err, 'Could not post commission.'))
      return false
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

  const openMatchPolicy = row => {
    setMatchRow(row)
    setMatchQuery(row.uploadedClientName || row.uploadedPolicyNumber || '')
  }

  const manualMatchPolicy = async policy => {
    if (!matchRow || !policy) return
    setPosting(matchRow.id)
    try {
      await updateCommissionReconciliationRow(matchRow.id, {
        matchedPolicyId: policy.id,
        matchedPolicyNumber: policy.policyNumber,
        matchConfidence: 'manual',
        matchScore: 100,
        matchReason: 'Policy selected manually',
        matchConflicts: [],
        status: 'needs-confirmation',
      })
      await loadRows(matchRow.batchId)
      setMatchRow(null)
      toast.success('Policy matched. You can reconcile this row now.')
    } catch (err) {
      toast.error(friendlyFirebaseError(err, 'Could not match policy.'))
    } finally {
      setPosting('')
    }
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
        matchScore: 100,
        matchReason: 'Policy created and selected manually',
        matchConflicts: [],
        status: 'needs-confirmation',
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

  const updateReviewRow = async (row, changes) => {
    if (posting) return
    setPosting(row.id)
    try {
      const calculated = calculateCommission({ ...row, ...changes })
      const payload = { ...changes, ...calculated }
      await updateCommissionReconciliationRow(row.id, payload)
      setRows(current => current.map(item => item.id === row.id ? { ...item, ...payload } : item))
      toast.success('Review row updated.')
    } catch (err) {
      toast.error(friendlyFirebaseError(err, 'Could not update this row.'))
    } finally {
      setPosting('')
    }
  }

  const setReviewStatus = async (row, status) => {
    await updateReviewRow(row, { status })
  }

  const confirmAllExact = async () => {
    const exactRows = rows.filter(row => row.status === 'exact-match' && row.matchedPolicyId)
    if (!exactRows.length) {
      toast.error('There are no unposted exact matches.')
      return
    }
    if (!window.confirm(`Post ${exactRows.length} exact commission matches?`)) return
    setBulkPosting(true)
    let completed = 0
    try {
      for (const row of exactRows) {
        if (await acceptRow(row)) completed += 1
      }
      toast.success(`${completed} exact matches posted.`)
    } finally {
      setBulkPosting(false)
    }
  }

  const saveManualCommission = async e => {
    e.preventDefault()
    const policy = policies.find(item => item.id === manualForm.policyId)
    if (!policy) { toast.error('Select a policy.'); return }
    if (!manualForm.payoutMonth) { toast.error('Select the commission month.'); return }
    const calculation = calculateCommission({
      uploadedPremium: manualForm.premium || policy.premium,
      commissionRate: manualForm.commissionRate,
      uploadedCommission: manualForm.grossCommission,
      rewardCommission: manualForm.rewardCommission,
      gst: manualForm.gst,
      tds: manualForm.tds,
      deduction: manualForm.deduction,
      netPaid: manualForm.netReceived,
    })
    const errors = validateCommissionRow({ ...calculation, uploadedPolicyNumber: policy.policyNumber, commissionRate: manualForm.commissionRate })
    if (errors.length) { toast.error(errors.join('. ')); return }
    setPosting('manual')
    try {
      const postingKey = `manual_${policy.id}_${manualForm.payoutMonth}_${calculation.netPaid}`.replace(/[^a-zA-Z0-9_-]/g, '')
      await addCommissionTransaction({
        policyId: policy.id, policyNumber: policy.policyNumber, clientId: policy.clientId || '', clientName: policy.clientName || '',
        insurer: policy.insurer || '', premium: Number(manualForm.premium || policy.premium || 0), expectedCommission: calculation.grossCommission,
        receivedCommission: calculation.grossCommission, grossCommission: calculation.grossCommission, commissionRate: Number(manualForm.commissionRate || 0),
        rewardCommission: calculation.rewardCommission, gst: calculation.gst, tds: calculation.tds, deduction: calculation.deduction,
        netReceived: calculation.netPaid, difference: 0, payoutMonth: manualForm.payoutMonth, status: 'manual entry', postingKey,
        matchingMethod: 'manual-entry', sourceType: 'manual', createdBy: user?.uid || '', createdByEmail: user?.email || '', remarks: manualForm.remarks,
      })
      toast.success('Manual commission saved.')
      setManualOpen(false)
      setManualForm({ policyId: '', premium: '', commissionRate: '', grossCommission: '', rewardCommission: '', gst: '', tds: '', deduction: '', netReceived: '', payoutMonth: '', remarks: '' })
    } catch (err) {
      toast.error(friendlyFirebaseError(err, 'Could not save manual commission.'))
    } finally {
      setPosting('')
    }
  }

  const filteredRows = useMemo(() => {
    const query = queryText.trim().toLowerCase()
    return rows.filter(row => {
      const searchable = [row.uploadedClientName, row.uploadedPolicyNumber, row.uploadedPlanName, row.uploadedInsurer, row.matchedPolicyNumber, row.status].join(' ').toLowerCase()
      return (!query || searchable.includes(query))
        && (statusFilter === 'all' || row.status === statusFilter)
        && Number(row.matchScore || 0) >= Number(confidenceMin || 0)
    })
  }, [rows, queryText, statusFilter, confidenceMin])

  const summary = useMemo(() => ({
    total: rows.length,
    high: rows.filter(r => r.status === 'exact-match').length,
    review: rows.filter(r => r.status === 'needs-confirmation').length,
    posted: rows.filter(r => r.status === 'posted').length,
  }), [rows])

  if (!isAdmin) return (
    <div className="p-8 text-center">
      <p className="text-gray-600 dark:text-gray-400 font-medium">Access restricted to administrators only.</p>
    </div>
  )

  return (
    <div className="fintech-page space-y-4 sm:space-y-5">
      <div className="fintech-header">
        <div><p className="fintech-kicker">Commission operations</p><h1 className="fintech-title">Commission Reconciliation</h1>
        <p className="fintech-subtitle">Upload insurer statements, review confidence and exceptions, then post confirmed commission.</p></div>
        <button type="button" className="btn-secondary" onClick={() => setManualOpen(true)}>+ Manual commission</button>
      </div>

      <div className="commission-workflow" aria-label="Reconciliation workflow">
        <div className={`commission-workflow-step ${!selectedBatch ? 'active' : ''}`}><span className="commission-step-number">1</span><span>Upload statement</span></div>
        <div className={`commission-workflow-step ${selectedBatch && summary.posted < summary.total ? 'active' : ''}`}><span className="commission-step-number">2</span><span>Review matches</span></div>
        <div className={`commission-workflow-step ${selectedBatch && summary.total > 0 && summary.posted === summary.total ? 'active' : ''}`}><span className="commission-step-number">3</span><span>Post commission</span></div>
      </div>

      {pageError && <div className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"><div><p className="font-bold">Commission data needs attention</p><p className="mt-0.5">{pageError}</p></div><button className="font-bold" onClick={() => { setPageError(''); loadBatches().catch(err => setPageError(friendlyFirebaseError(err, 'Retry failed.'))) }}>Retry</button></div>}

      <form onSubmit={createBatch} className="fintech-panel commission-upload-panel grid grid-cols-1 items-end gap-3 md:grid-cols-5">
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
        <select className="form-input" value={mappingProfileId} onChange={e => chooseMappingProfile(e.target.value)}>
          <option value="">Automatic column mapping</option>
          {mappingTemplates.filter(template => !insurer || template.insurer === insurer).map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
        <select className="form-input" value={statementMonth} onChange={e => setStatementMonth(e.target.value)}>
          <option value="">Select statement month</option>
          {statementMonthOptions.map(month => <option key={month.value} value={month.value}>{month.label}</option>)}
        </select>
        <input className="form-input md:col-span-2" type="file" accept=".csv,.xlsx,.xls,.pdf,.jpg,.jpeg,.png,.webp" onChange={e => setFile(e.target.files?.[0] || null)} />
        <button className="btn-primary" disabled={Boolean(progress)}>{progress ? 'Working...' : 'Upload & Review'}</button>
        <div className="md:col-span-5">
          <button type="button" className="text-sm font-semibold text-blue-600" onClick={() => setShowMapping(value => !value)}>{showMapping ? 'Hide custom column mapping' : 'Custom column mapping'}</button>
          {showMapping && (
            <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/20">
              <p className="mb-3 text-xs text-gray-500">Enter the exact header written in the insurer statement. Empty fields continue using automatic aliases.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{MAPPING_FIELDS.map(([field, label]) => <label key={field} className="text-xs font-semibold text-gray-600 dark:text-gray-300">{label}<input className="form-input mt-1" placeholder="Statement column header" value={mappingForm[field] || ''} onChange={e => setMappingForm(current => ({ ...current, [field]: e.target.value }))} /></label>)}</div>
              <button type="button" className="btn-secondary mt-4" disabled={Boolean(progress)} onClick={saveMappingProfile}>Save mapping for {insurer || 'insurer'}</button>
            </div>
          )}
        </div>
        {progress && (
          <div className="md:col-span-5 space-y-2" role="status" aria-live="polite">
            <div className="h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-950"><div className="h-full w-2/3 animate-pulse rounded-full bg-blue-600" /></div>
            <p className="text-sm font-medium text-blue-600">{progress}</p>
            <div className="grid grid-cols-3 gap-2" aria-hidden="true"><div className="commission-skeleton h-8" /><div className="commission-skeleton h-8" /><div className="commission-skeleton h-8" /></div>
          </div>
        )}
        <p className="md:col-span-5 text-xs text-gray-500">
          Excel and CSV statements are mapped locally. PDF text extraction and scanned-page OCR run locally with free open-source engines; every uncertain row still requires confirmation.
        </p>
      </form>

      <div className="commission-metric-grid">
        <div className="commission-metric"><p className="commission-metric-label">Rows detected</p><p className="commission-metric-value">{summary.total}</p><p className="commission-metric-note">Current statement</p></div>
        <div className="commission-metric"><p className="commission-metric-label">Exact matches</p><p className="commission-metric-value text-emerald-600">{summary.high}</p><p className="commission-metric-note">Ready for confirmation</p></div>
        <div className="commission-metric"><p className="commission-metric-label">Needs review</p><p className="commission-metric-value text-amber-600">{summary.review}</p><p className="commission-metric-note">Manual decision required</p></div>
        <div className="commission-metric"><p className="commission-metric-label">Posted</p><p className="commission-metric-value text-blue-600">{summary.posted}</p><p className="commission-metric-note">Written to ledger</p></div>
      </div>

      <div className="fintech-panel p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <select className="form-input max-w-xl" value={selectedBatch} onChange={e => loadRows(e.target.value)}>
          <option value="">Select reconciliation batch</option>
          {batches.map(b => <option key={b.id} value={b.id}>{fmtDate(b.createdAt)} - {b.insurer || 'Statement'} - {b.originalFileName || b.id}</option>)}
        </select>
        {selectedBatch && (() => {
          const batch = batches.find(item => item.id === selectedBatch)
          const total = Number(batch?.summary?.rows || rows.length || 0)
          const resolved = rows.filter(row => ['posted', 'ignored'].includes(row.status)).length
          return (
            <div className="min-w-64 space-y-1">
              <div className="flex justify-between text-xs font-semibold text-gray-500"><span>{resolved}/{total} resolved</span>{batch?.originalFileUrl && <a href={batch.originalFileUrl} target="_blank" rel="noreferrer" className="text-blue-600">Source file</a>}</div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700"><div className="h-full rounded-full bg-blue-600" style={{ width: `${total ? Math.round((resolved / total) * 100) : 0}%` }} /></div>
            </div>
          )
        })()}
        </div>
      </div>

      <div className="commission-toolbar">
        <input className="form-input flex-1" placeholder="Search client, policy, plan, insurer or status..." value={queryText} onChange={e => setQueryText(e.target.value)} />
        <select className="form-input lg:w-56" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {['exact-match', 'needs-confirmation', 'duplicate', 'unmatched', 'error', 'ignored', 'posted'].map(status => <option key={status} value={status}>{status.replace(/-/g, ' ')}</option>)}
        </select>
        <select className="form-input lg:w-48" value={confidenceMin} onChange={e => setConfidenceMin(Number(e.target.value))}>
          <option value={0}>Any confidence</option><option value={50}>50%+</option><option value={75}>75%+</option><option value={90}>90%+</option>
        </select>
        <button type="button" className="btn-primary whitespace-nowrap" disabled={bulkPosting} onClick={confirmAllExact}>{bulkPosting ? 'Posting...' : 'Confirm all exact'}</button>
      </div>

      {loadingRows && <div className="fintech-panel space-y-3 p-4" aria-label="Loading reconciliation rows"><div className="commission-skeleton h-5 w-40" /><div className="commission-skeleton h-16 w-full" /><div className="commission-skeleton h-16 w-full" /><div className="commission-skeleton h-16 w-full" /></div>}

      <div className={`${loadingRows ? 'hidden' : ''} space-y-3 md:hidden`}>
        {filteredRows.map(row => (
          <article key={row.id} data-status={row.status} className="commission-mobile-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="truncate font-bold text-gray-900 dark:text-white">{row.uploadedClientName || 'Unnamed client'}</p><p className="mt-1 break-all text-xs text-gray-500">{row.uploadedPolicyNumber || 'No policy number'} · {row.uploadedPlanName || 'Plan not supplied'}</p></div>
              <StatusChip status={row.status} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-gray-500">Insurer</p><p className="font-semibold">{row.uploadedInsurer || '-'}</p></div>
              <div><p className="text-xs text-gray-500">Confidence</p><p className="font-semibold">{Number(row.matchScore || 0)}%</p></div>
              <div><p className="text-xs text-gray-500">Premium</p><p className="font-semibold">{fmtCurrency(row.uploadedPremium)}</p></div>
              <div><p className="text-xs text-gray-500">Net commission</p><input className="form-input mt-1" type="number" min="0" value={row.netPaid || ''} onChange={e => setRows(current => current.map(item => item.id === row.id ? { ...item, netPaid: e.target.value } : item))} onBlur={() => updateReviewRow(row, { netPaid: Number(rows.find(item => item.id === row.id)?.netPaid || 0) })} /></div>
            </div>
            <p className="mt-3 text-xs text-gray-500">{row.matchReason || row.note || 'Manual review required.'}</p>
            {row.matchConflicts?.length > 0 && <p className="mt-1 text-xs font-semibold text-red-600">Check: {row.matchConflicts.join(', ')}</p>}
            <button type="button" className="mt-3 text-xs font-semibold text-blue-600" onClick={() => setExpandedRow(expandedRow === row.id ? '' : row.id)}>Calculation details</button>
            {expandedRow === row.id && <div className="mt-2 rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-900">Gross {fmtCurrency(row.grossCommission)} + Reward {fmtCurrency(row.rewardCommission)} + GST {fmtCurrency(row.gst)} - TDS {fmtCurrency(row.tds)} - Deduction {fmtCurrency(row.deduction)} = <strong>{fmtCurrency(row.netPaid)}</strong></div>}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" className="btn-secondary min-h-11" onClick={() => openMatchPolicy(row)}>Change policy</button>
              {row.matchedPolicyId && row.status !== 'posted' ? <button type="button" className="btn-primary min-h-11" disabled={posting === row.id} onClick={() => acceptRow(row)}>{posting === row.id ? 'Posting...' : 'Confirm & post'}</button> : <button type="button" className="btn-secondary min-h-11" onClick={() => openIncludePolicy(row)}>Include new</button>}
              {row.status !== 'posted' && <button type="button" className="btn-secondary min-h-11" onClick={() => setReviewStatus(row, 'unmatched')}>Mark unmatched</button>}
              {row.status !== 'posted' && <button type="button" className="btn-secondary min-h-11" onClick={() => setReviewStatus(row, 'ignored')}>Ignore</button>}
            </div>
          </article>
        ))}
        {!filteredRows.length && <div className="commission-empty"><span className="commission-empty-mark">0</span><p className="font-bold text-gray-700 dark:text-gray-200">No reconciliation rows</p><p className="mt-1 text-sm">Upload a statement or adjust the current filters.</p></div>}
      </div>

      <div className={`${loadingRows ? 'hidden' : ''} fintech-panel hidden overflow-auto md:block`}>
        <table className="commission-table min-w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 z-10 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Uploaded Client</th><th className="px-4 py-3 text-left">Uploaded Policy</th><th className="px-4 py-3 text-left">Matched Policy</th><th className="px-4 py-3 text-left">Premium</th><th className="px-4 py-3 text-left">Net Paid</th><th className="px-4 py-3 text-left">Confidence</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(row => (
              <tr key={row.id} className="border-t border-gray-100 dark:border-gray-700">
                <td className="px-4 py-3"><p className="font-semibold">{row.uploadedClientName || '-'}</p><p className="text-xs text-gray-500">{row.uploadedInsurer || '-'}</p></td>
                <td className="px-4 py-3"><p>{row.uploadedPolicyNumber || '-'}</p><p className="text-xs text-gray-500">{row.uploadedPlanName || '-'}</p></td>
                <td className="px-4 py-3">
                  {row.matchedPolicyNumber || '-'}
                  <button className="ml-2 text-xs text-purple-600 font-semibold" onClick={() => openMatchPolicy(row)}>
                    Match
                  </button>
                </td>
                <td className="px-4 py-3">{fmtCurrency(row.uploadedPremium)}</td>
                <td className="px-4 py-3"><input className="form-input min-w-32" type="number" min="0" value={row.netPaid || ''} onChange={e => setRows(current => current.map(item => item.id === row.id ? { ...item, netPaid: e.target.value } : item))} onBlur={() => updateReviewRow(row, { netPaid: Number(rows.find(item => item.id === row.id)?.netPaid || 0) })} /><button type="button" className="mt-1 text-xs text-blue-600" onClick={() => setExpandedRow(expandedRow === row.id ? '' : row.id)}>Breakdown</button>{expandedRow === row.id && <p className="mt-1 min-w-56 text-xs text-gray-500">Gross {fmtCurrency(row.grossCommission)} + Reward {fmtCurrency(row.rewardCommission)} + GST {fmtCurrency(row.gst)} - TDS {fmtCurrency(row.tds)} - Other {fmtCurrency(row.deduction)}</p>}</td>
                <td className="px-4 py-3"><span className="badge badge-blue" title={row.matchReason}>{Number(row.matchScore || 0)}%</span><p className="mt-1 max-w-48 text-xs text-gray-500">{row.matchReason}</p>{row.matchConflicts?.length > 0 && <p className="mt-1 text-xs font-semibold text-red-600">{row.matchConflicts.join(', ')}</p>}</td>
                <td className="px-4 py-3"><StatusChip status={row.status} /></td>
                <td className="px-4 py-3">
                  {row.matchedPolicyId ? (
                    <div className="flex min-w-44 flex-wrap gap-2"><button className="text-blue-600 font-semibold disabled:opacity-50" disabled={row.status === 'posted' || posting === row.id} onClick={() => acceptRow(row)}>{posting === row.id ? 'Posting...' : row.status === 'posted' ? 'Posted' : 'Confirm & post'}</button>{row.status !== 'posted' && <button className="text-red-600 font-semibold" onClick={() => setReviewStatus(row, 'unmatched')}>Unmatched</button>}{row.status !== 'posted' && <button className="text-gray-500 font-semibold" onClick={() => setReviewStatus(row, 'ignored')}>Ignore</button>}</div>
                  ) : (
                    <div className="flex gap-3">
                      <button className="text-purple-600 font-semibold disabled:opacity-50" disabled={posting === row.id} onClick={() => openMatchPolicy(row)}>
                        Match Existing
                      </button>
                      <button className="text-green-600 font-semibold disabled:opacity-50" disabled={posting === row.id} onClick={() => openIncludePolicy(row)}>
                        Include New
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filteredRows.length === 0 && <tr><td className="px-4 py-8 text-gray-400" colSpan="8">No rows selected or no rows match these filters.</td></tr>}
          </tbody>
        </table>
      </div>

      {manualOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/50 p-0 sm:items-center sm:justify-center sm:p-4">
          <form onSubmit={saveManualCommission} className="gi-standalone-modal max-h-[92dvh] w-full overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-3xl sm:rounded-2xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 p-4 dark:border-gray-700"><div><h2 className="text-lg font-bold">Manual Commission Entry</h2><p className="text-sm text-gray-500">Saved in the same ledger and reports as imported commission.</p></div><button type="button" className="btn-secondary" onClick={() => setManualOpen(false)}>Close</button></div>
            <div className="gi-standalone-modal-body grid grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3">
              <select className="form-input sm:col-span-2 lg:col-span-3" value={manualForm.policyId} onChange={e => { const policy = policies.find(item => item.id === e.target.value); setManualForm(current => ({ ...current, policyId: e.target.value, premium: policy?.premium || '', commissionRate: Number(policy?.policyYear || 1) > 1 ? policy?.ryCommission || '' : policy?.fyCommission || '' })) }} required><option value="">Select client and policy</option>{policies.map(policy => <option key={policy.id} value={policy.id}>{policy.clientName} · {policy.policyNumber} · {policy.insurer}</option>)}</select>
              <input className="form-input" type="number" min="0" placeholder="Premium" value={manualForm.premium} onChange={e => setManualForm({ ...manualForm, premium: e.target.value })} />
              <input className="form-input" type="number" min="0" max="100" step="0.01" placeholder="Commission rate %" value={manualForm.commissionRate} onChange={e => setManualForm({ ...manualForm, commissionRate: e.target.value })} />
              <input className="form-input" type="number" min="0" step="0.01" placeholder="Gross commission" value={manualForm.grossCommission} onChange={e => setManualForm({ ...manualForm, grossCommission: e.target.value })} />
              <input className="form-input" type="number" min="0" step="0.01" placeholder="Reward / incentive" value={manualForm.rewardCommission} onChange={e => setManualForm({ ...manualForm, rewardCommission: e.target.value })} />
              <input className="form-input" type="number" min="0" step="0.01" placeholder="GST" value={manualForm.gst} onChange={e => setManualForm({ ...manualForm, gst: e.target.value })} />
              <input className="form-input" type="number" min="0" step="0.01" placeholder="TDS" value={manualForm.tds} onChange={e => setManualForm({ ...manualForm, tds: e.target.value })} />
              <input className="form-input" type="number" min="0" step="0.01" placeholder="Other deduction" value={manualForm.deduction} onChange={e => setManualForm({ ...manualForm, deduction: e.target.value })} />
              <input className="form-input" type="number" min="0" step="0.01" placeholder="Net commission (optional)" value={manualForm.netReceived} onChange={e => setManualForm({ ...manualForm, netReceived: e.target.value })} />
              <select className="form-input" value={manualForm.payoutMonth} onChange={e => setManualForm({ ...manualForm, payoutMonth: e.target.value })} required><option value="">Commission month</option>{statementMonthOptions.map(month => <option key={month.value} value={month.value}>{month.label}</option>)}</select>
              <textarea className="form-input sm:col-span-2 lg:col-span-3" placeholder="Remarks" value={manualForm.remarks} onChange={e => setManualForm({ ...manualForm, remarks: e.target.value })} />
            </div>
            <div className="gi-modal-footer flex shrink-0 justify-end gap-2 border-t border-gray-200 p-4 dark:border-gray-700"><button type="button" className="btn-secondary" onClick={() => setManualOpen(false)}>Cancel</button><button className="btn-primary" disabled={posting === 'manual'}>{posting === 'manual' ? 'Saving...' : 'Save commission'}</button></div>
          </form>
        </div>
      )}

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

      {matchRow && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-3xl w-full p-5 space-y-4">
            <div className="flex justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Match Existing Policy</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Statement: {matchRow.uploadedClientName || '-'} | {matchRow.uploadedPolicyNumber || '-'} | {fmtCurrency(matchRow.uploadedPremium)}
                </p>
              </div>
              <button className="text-gray-500" onClick={() => setMatchRow(null)}>Close</button>
            </div>
            <input
              className="form-input"
              placeholder="Search policy number, client, insurer, plan, premium..."
              value={matchQuery}
              onChange={e => setMatchQuery(e.target.value)}
            />
            <div className="max-h-96 overflow-auto border border-gray-200 dark:border-gray-700 rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Policy</th>
                    <th className="px-3 py-2 text-left">Client</th>
                    <th className="px-3 py-2 text-left">Insurer</th>
                    <th className="px-3 py-2 text-left">Premium</th>
                    <th className="px-3 py-2 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {candidatePolicies.map(policy => (
                    <tr key={policy.id} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="px-3 py-2 font-semibold">{policy.policyNumber}</td>
                      <td className="px-3 py-2">{policy.clientName}</td>
                      <td className="px-3 py-2">{policy.insurer || '-'}</td>
                      <td className="px-3 py-2">{fmtCurrency(policy.premium)}</td>
                      <td className="px-3 py-2">
                        <button className="text-blue-600 font-semibold disabled:opacity-50" disabled={posting === matchRow.id} onClick={() => manualMatchPolicy(policy)}>
                          Select
                        </button>
                      </td>
                    </tr>
                  ))}
                  {candidatePolicies.length === 0 && (
                    <tr><td className="px-3 py-8 text-gray-400" colSpan="5">No existing policy found. Try a different search, or use Include New.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
