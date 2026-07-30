// src/components/policies/ImportModals.jsx
// The bulk-import flow, extracted verbatim from PoliciesPage: the shared
// client-mapping step, the per-type import modal, and the type chooser that
// is the only entry point the page needs.
import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import DateInput from '../ui/DateInput'
import { addClient, checkDuplicate, findClientByMobileOrName, importPoliciesBatch } from '../../firebase/firestore'
import { parseAnyDate } from '../../utils/dateUtils'
import {
  downloadTemplate, parseImportFile,
  HEALTH_IMPORT_HEADERS, HEALTH_IMPORT_SAMPLE, parseHealthRow,
  LIFE_IMPORT_HEADERS,   LIFE_IMPORT_SAMPLE,   parseLifeRow,
  MOTOR_IMPORT_HEADERS,  MOTOR_IMPORT_SAMPLE,  parseMotorRow,
} from '../../utils/exportUtils'
import { buildImportClientReview } from '../../utils/policyImport'

// ── Shared client-mapping step (reused by all 3 import modals) ──
function ClientMappingStep({ unmapped, clients, onConfirm, onBack }) {
  const [resolution, setResolution] = useState({})
  const [saving, setSaving] = useState(false)
  const setRes = (name, val) => setResolution(p => ({ ...p, [name]: val }))

  const confirm = async () => {
    setSaving(true)
    const map = {}
    for (const name of unmapped) {
      const res = resolution[name] || { type: 'skip' }
      if (res.type === 'existing') {
        map[name] = { id: res.clientId, name: res.clientName }
      } else if (res.type === 'new') {
        try {
          const ref = await addClient({ name, mobile: '', email: '', kycStatus: 'Pending' })  // mobile added separately if available
          map[name] = { id: ref.id, name }
          toast.success(`"${name}" created`)
        } catch { map[name] = { id: '', name } }
      } else {
        map[name] = { id: '', name }
      }
    }
    setSaving(false)
    onConfirm(map)
  }

  return (
    <div className="space-y-4">
      <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-orange-700">⚠️ {unmapped.length} client name(s) not found in your database</p>
        <p className="text-xs text-orange-600 mt-1">For each name below — create a new client, map to existing, or skip.</p>
      </div>
      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
        {unmapped.map(name => {
          const res = resolution[name] || { type: 'skip' }
          return (
            <div key={name} className="border border-gray-200 rounded-xl p-3 bg-white">
              <p className="text-sm font-semibold text-gray-800 mb-2">&quot;{name}&quot;</p>
              <div className="flex gap-2 flex-wrap mb-2">
                <button onClick={() => setRes(name, { type: 'new' })}
                  className={`px-3 py-1 text-xs rounded-lg border font-medium ${res.type==='new'?'bg-blue-600 text-white border-blue-600':'bg-white text-blue-600 border-blue-300 hover:bg-blue-50'}`}>
                  ➕ Create new client
                </button>
                <button onClick={() => setRes(name, { type: 'skip' })}
                  className={`px-3 py-1 text-xs rounded-lg border font-medium ${res.type==='skip'?'bg-gray-500 text-white border-gray-500':'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'}`}>
                  ⏭ Import without linking
                </button>
              </div>
              <select
                value={res.type==='existing' ? res.clientId : ''}
                onChange={e => {
                  const id = e.target.value
                  if (!id) return
                  const cl = clients.find(c => c.id === id)
                  setRes(name, { type: 'existing', clientId: id, clientName: cl?.name || name })
                }}
                className="form-select text-xs w-full">
                <option value="">— Or map to existing client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {res.type === 'existing' && <p className="text-xs text-green-600 mt-1 font-medium">✅ Will be linked to: {res.clientName}</p>}
            </div>
          )
        })}
      </div>
      <div className="flex gap-3">
        <button onClick={confirm} disabled={saving} className="btn-primary">
          {saving ? '⏳ Creating clients…' : '✅ Confirm & Import'}
        </button>
        <button onClick={onBack} className="btn-secondary">← Back</button>
      </div>
    </div>
  )
}

// ── Generic typed import modal ────────────────────────────────
function TypedImportModal({ policyType, icon, color, headers, sample, parseRow, clients, onClose, onImported }) {
  const fileRef   = useRef()
  const [step,       setStep]       = useState('upload') // upload | mapping | dup_review | lapse_review
  const [rows,       setRows]       = useState(null)
  const [unmapped,   setUnmapped]   = useState([])
  const [importing,   setImporting]   = useState(false)
  const [preflighting,setPreflighting] = useState(false)  // scanning for dups/lapsed
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 })
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const [errors,      setErrors]      = useState([])
  const [autoAssign, setAutoAssign] = useState(true)
  // Duplicate review state
  const [dupRows,    setDupRows]    = useState([])   // [{rowIndex, data, pNo}]
  const [dupChoices, setDupChoices] = useState({})   // {pNo: 'skip'|'overwrite'|'new'}
  // Existing-client match review state
  const [clientMatchRows, setClientMatchRows] = useState([])
  const [clientMatchChoices, setClientMatchChoices] = useState({})
  // Lapsed policy review state
  const [lapseRows,  setLapseRows]  = useState([])   // [{rowIndex, data, daysAgo}]
  const [lapseChoices, setLapseChoices] = useState({}) // {pNo: {action:'skip'|'import', newExpiry, newStart}}
  // Pending rows waiting for review decisions
  const [pendingRows,  setPendingRows]  = useState([])
  const [pendingOverrides, setPendingOverrides] = useState({})
  const [pendingAutoCreate, setPendingAutoCreate] = useState(false)

  const onFileChange = async e => {
    const file = e.target.files[0]; if (!file) return
    try {
      const raw = await parseImportFile(file)
      setRows(raw); setErrors([])
      toast.success(`${raw.length} rows loaded`)
    } catch(err) { toast.error(err.message) }
  }

  const onClickImport = () => {
    if (!rows?.length) return
    if (preflighting || importing) return
    setErrors([])

    const rowErrors = []
    rows.forEach((r, i) => {
      try { parseRow(r) }
      catch (err) { rowErrors.push(`Row ${i + 2}: ${err.message}`) }
    })
    if (rowErrors.length > 0) {
      setErrors(rowErrors)
      toast.error('Fix date format before importing. Use dd/mm/yyyy.')
      return
    }

    setPreflighting(true)

    const names = [...new Set(rows.map(r => String(r['Client Name']||'').trim()).filter(Boolean))]
    const unmatched = names.filter(n => !clients.some(c => c.name.toLowerCase().trim() === n.toLowerCase()))

    if (autoAssign) {
      preflight({}, true)
    } else {
      if (unmatched.length > 0) {
        setPreflighting(false)
        setUnmapped(unmatched)
        setStep('mapping')
      } else {
        preflight({}, false)
      }
    }
  }

  const findImportClientMatch = (data = {}) => {
    const importedName = String(data.clientName || '').trim().toLowerCase()
    const importedMobile = String(data.clientMobile || '').replace(/\D/g, '').slice(-10)
    const importedEmail = String(data.clientEmail || '').trim().toLowerCase()
    if (!importedName && !importedMobile && !importedEmail) return null
    return clients.find(c => {
      const name = String(c.name || '').trim().toLowerCase()
      const mobile = String(c.mobile || '').replace(/\D/g, '').slice(-10)
      const email = String(c.email || '').trim().toLowerCase()
      return Boolean(
        (importedMobile && mobile && importedMobile === mobile) ||
        (importedEmail && email && importedEmail === email) ||
        (importedName && name && importedName === name)
      )
    }) || null
  }

  // ── Pre-flight scan: find dups + client matches + lapsed before importing ────
  const preflight = async (overrides, autoCreate) => {
    // Note: setPreflighting(true) is called by onClickImport before this
    // to lock the button immediately on first click
    try {
    const today = new Date()
    const dups = [], lapses = [], clientMatches = []

    for (const [i, r] of rows.entries()) {
      let data
      try { data = parseRow(r) }
      catch (err) { setErrors([`Row ${i + 2}: ${err.message}`]); throw err }
      const pNo  = data.policyNumber
      if (!pNo) continue
      const matchedClient = findImportClientMatch(data)
      if (matchedClient) clientMatches.push({ rowIndex: i, data, pNo, matchedClient })

      // Only a fully identical row is a duplicate; one changed field is allowed.
      const dupResult = await checkDuplicate(data)
      if (dupResult.isDup) dups.push({ rowIndex: i, data, pNo, reason: dupResult.reason, existing: dupResult.existing })

      // Check lapsed (expiry more than 30 days in the past)
      if (data.expiryDate && !dupResult.isDup) {
        const exp  = parseAnyDate(data.expiryDate)
        if (!exp) throw new Error(`Row ${i + 2}: Policy End Date is invalid.`)
        const daysAgo = Math.ceil((today - exp) / (1000 * 60 * 60 * 24))
        if (daysAgo > 30) lapses.push({ rowIndex: i, data, pNo, daysAgo })
      }
    }

    setPendingRows(rows)
    setPendingOverrides(overrides)
    setPendingAutoCreate(autoCreate)

    if (dups.length > 0) {
      setDupRows(dups)
      setDupChoices(Object.fromEntries(dups.map(d => [d.pNo, 'skip'])))
      setStep('dup_review')
    } else if (clientMatches.length > 0) {
      setClientMatchRows(clientMatches)
      setClientMatchChoices(Object.fromEntries(clientMatches.map(m => [m.pNo, 'family'])))
      setStep('client_match_review')
    } else if (lapses.length > 0) {
      setLapseRows(lapses)
      setLapseChoices(Object.fromEntries(lapses.map(l => [l.pNo, { action: 'skip', newStart: '', newExpiry: '' }])))
      setStep('lapse_review')
    } else {
      doImport(overrides, autoCreate, {}, {})
    }
    } catch(err) {
      toast.error('Scan failed: ' + err.message)
    } finally {
      setPreflighting(false)
    }
  }

  const afterDupReview = () => {
    if (reviewSubmitting || importing) return
    setReviewSubmitting(true)
    const today = new Date()
    const lapses = []
    for (const [i, r] of pendingRows.entries()) {
      let data
      try { data = parseRow(r) }
      catch (err) {
        setErrors([`Row ${i + 2}: ${err.message}`])
        toast.error(err.message)
        setReviewSubmitting(false)
        return
      }
      const pNo  = data.policyNumber
      if (!pNo) continue
      const isDup = dupRows.some(d => d.pNo === pNo)
      if (isDup) continue  // already handled
      if (data.expiryDate) {
        const exp = parseAnyDate(data.expiryDate)
        if (!exp) {
          setErrors([`Row ${i + 2}: Policy End Date is invalid.`])
          toast.error(`Row ${i + 2}: Policy End Date is invalid.`)
          setReviewSubmitting(false)
          return
        }
        const daysAgo = Math.ceil((today - exp) / (1000 * 60 * 60 * 24))
        if (daysAgo > 30) lapses.push({ rowIndex: i, data, pNo, daysAgo })
      }
    }
    const clientMatches = []
    for (const [i, r] of pendingRows.entries()) {
      const data = parseRow(r)
      const pNo = data.policyNumber
      if (!pNo || dupRows.some(d => d.pNo === pNo)) continue
      const matchedClient = findImportClientMatch(data)
      if (matchedClient) clientMatches.push({ rowIndex: i, data, pNo, matchedClient })
    }
    if (clientMatches.length > 0) {
      setClientMatchRows(clientMatches)
      setClientMatchChoices(Object.fromEntries(clientMatches.map(m => [m.pNo, 'family'])))
      setStep('client_match_review')
      setReviewSubmitting(false)
    } else if (lapses.length > 0) {
      setLapseRows(lapses)
      setLapseChoices(Object.fromEntries(lapses.map(l => [l.pNo, { action: 'skip', newStart: '', newExpiry: '' }])))
      setStep('lapse_review')
      setReviewSubmitting(false)
    } else {
      toast.loading('Import is working. Please wait...', { id: 'policy-import-working' })
      doImport(pendingOverrides, pendingAutoCreate, dupChoices, {})
    }
  }

  const afterClientMatchReview = () => {
    if (reviewSubmitting || importing) return
    setReviewSubmitting(true)
    const today = new Date()
    const lapses = []
    for (const [i, r] of pendingRows.entries()) {
      let data
      try { data = parseRow(r) }
      catch (err) {
        setErrors([`Row ${i + 2}: ${err.message}`])
        toast.error(err.message)
        setReviewSubmitting(false)
        return
      }
      const pNo = data.policyNumber
      if (!pNo) continue
      if (data.expiryDate) {
        const exp = parseAnyDate(data.expiryDate)
        if (!exp) {
          setErrors([`Row ${i + 2}: Policy End Date is invalid.`])
          toast.error(`Row ${i + 2}: Policy End Date is invalid.`)
          setReviewSubmitting(false)
          return
        }
        const daysAgo = Math.ceil((today - exp) / (1000 * 60 * 60 * 24))
        if (daysAgo > 30) lapses.push({ rowIndex: i, data, pNo, daysAgo })
      }
    }
    if (lapses.length > 0) {
      setLapseRows(lapses)
      setLapseChoices(Object.fromEntries(lapses.map(l => [l.pNo, { action: 'skip', newStart: '', newExpiry: '' }])))
      setStep('lapse_review')
      setReviewSubmitting(false)
    } else {
      toast.loading('Import is working. Please wait...', { id: 'policy-import-working' })
      doImport(pendingOverrides, pendingAutoCreate, dupChoices, {})
    }
  }

  const doImport = async (overrides, autoCreate, dupResolutions, lapseResolutions) => {
    toast.loading('Import is working. Please wait...', { id: 'policy-import-working' })
    setImporting(true)
    setImportProgress({ done: 0, total: 0 })
    const errs = []
    const autoCreated = {}
    const preparedPolicies = []

    for (const [i, r] of (pendingRows.length ? pendingRows : rows).entries()) {
      let data
      try { data = parseRow(r) }
      catch (err) { errs.push(`Row ${i+2}: ${err.message}`); continue }
      const pNo  = data.policyNumber
      if (!pNo) { errs.push(`Row ${i+2}: Missing Policy Number`); continue }

      const eName = data.clientName
      const matchChoice = clientMatchChoices[pNo]
      let mc = clients.find(c => c.name.toLowerCase().trim() === eName.toLowerCase())
      if (!mc && (data.clientMobile || eName)) {
        try {
          mc = await findClientByMobileOrName(data.clientMobile, eName)
        } catch (err) {
          errs.push(`Row ${i + 2}: Could not match client "${eName}" - ${err.message}`)
        }
      }
      const ov = overrides[eName]
      if (!mc && ov?.id) {
        const mapped = clients.find(c => c.id === ov.id)
        mc = mapped || { id: ov.id, name: ov.name }
      }

      if (matchChoice === 'new_profile') {
        mc = null
      }

      if (!mc && (autoCreate || matchChoice === 'new_profile') && eName) {
        const createKey = `${matchChoice === 'new_profile' ? 'new:' : ''}${eName.toLowerCase()}`
        if (autoCreated[createKey]) {
          mc = autoCreated[createKey]
        } else {
          try {
            const ref = await addClient({ name: eName, mobile: data.clientMobile || '', email: data.clientEmail || '', kycStatus: 'Pending' })
            mc = { id: ref.id, name: eName, mobile: data.clientMobile || '', email: data.clientEmail || '' }
            autoCreated[createKey] = mc
          } catch(err) {
            errs.push(`Row ${i+2}: Could not create client "${eName}" - ${err.message}`)
            continue
          }
        }
      }

      const reviewFlag = buildImportClientReview(data, mc)
      data.clientId   = mc?.id   || ''
      data.clientName = eName || mc?.name || ''
      data.clientMobile = data.clientMobile || mc?.mobile || ''
      data.clientEmail  = data.clientEmail  || mc?.email  || ''
      if (reviewFlag) {
        Object.assign(data, reviewFlag)
        errs.push(`Row ${i+2}: Existing client matched but details differ. Imported policy was flagged for manual review; client record was not changed.`)
      }
      if (matchChoice === 'family' && mc?.id) {
        data.importClientMatchDecision = 'family'
        data.importMatchedClientId = mc.id
        data.familyId = mc.familyId || data.familyId || ''
        data.familyName = mc.familyName || data.familyName || ''
      } else if (matchChoice === 'new_profile') {
        data.importClientMatchDecision = 'new_profile'
      }
      data.clientMobile = data.clientMobile || mc?.mobile || ''
      data.clientEmail = data.clientEmail || mc?.email || ''

      const dupChoice = dupResolutions[pNo]
      if (dupChoice === 'skip') continue

      const lapseChoice = lapseResolutions[pNo]
      if (lapseChoice?.action === 'skip') continue
      if (lapseChoice?.action === 'import') {
        if (lapseChoice.newStart)  data.startDate  = lapseChoice.newStart
        if (lapseChoice.newExpiry) data.expiryDate = lapseChoice.newExpiry
        data.status = 'Active'
      }

      if (dupChoice === 'overwrite') {
        data.policyNumber = pNo + '_v2_' + Date.now().toString().slice(-4)
        toast(`Info: ${pNo} imported as ${data.policyNumber}`)
      }

      preparedPolicies.push(data)
    }

    try {
      setImportProgress({ done: 0, total: preparedPolicies.length })
      const ok = await importPoliciesBatch(preparedPolicies, (done, total) => setImportProgress({ done, total }))
      setErrors(errs)
      if (ok > 0) {
        const created = Object.keys(autoCreated).length
        let msg = `${ok} policies imported!`
        if (created > 0) msg += ` ${created} new clients auto-created.`
        toast.success(msg, { id: 'policy-import-working' })
        onImported()
        if (!errs.length) onClose()
        else setStep('upload')
      } else if (errs.length) {
        toast.error('Import failed - see errors below', { id: 'policy-import-working' })
      }
    } catch(err) {
      setErrors([...errs, err.message || 'Import failed'])
      toast.error('Import failed - see errors below', { id: 'policy-import-working' })
    } finally {
      setImporting(false)
      setReviewSubmitting(false)
      setImportProgress({ done: 0, total: 0 })
    }
  }

  const colorMap = {
    green:  { bg:'bg-green-50',  border:'border-green-200',  text:'text-green-700'  },
    purple: { bg:'bg-purple-50', border:'border-purple-200', text:'text-purple-700' },
    orange: { bg:'bg-orange-50', border:'border-orange-200', text:'text-orange-700' },
  }
  const c = colorMap[color] || colorMap.green

  if (step === 'client_match_review') return (
    <div className="space-y-4">
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
        <p className="text-sm font-bold text-blue-700 dark:text-blue-300">
          Review {clientMatchRows.length} existing client match{clientMatchRows.length !== 1 ? 'es' : ''}
        </p>
        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
          The import found clients with the same name, mobile, or email. Choose how to handle each one. Existing client details will not be overwritten.
        </p>
      </div>
      <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
        {clientMatchRows.map(({ pNo, data, matchedClient }) => {
          const choice = clientMatchChoices[pNo] || 'family'
          return (
            <div key={pNo} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-white dark:bg-gray-800">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Imported Policy</p>
                  <p className="text-sm font-bold text-gray-900 dark:text-white mt-1">{data.clientName || 'Unnamed client'}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{data.clientMobile || 'No mobile'} - {data.clientEmail || 'No email'}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Policy: {pNo}</p>
                </div>
                <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/20 p-3">
                  <p className="text-xs font-bold text-blue-600 dark:text-blue-300 uppercase">Existing Match</p>
                  <p className="text-sm font-bold text-gray-900 dark:text-white mt-1">{matchedClient.name || 'Unnamed client'}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{matchedClient.mobile || 'No mobile'} - {matchedClient.email || 'No email'}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Family: {matchedClient.familyName || 'Not grouped yet'}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={reviewSubmitting || importing}
                  onClick={() => setClientMatchChoices(p => ({ ...p, [pNo]: 'family' }))}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50 ${choice === 'family'
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white dark:bg-gray-700 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'}`}>
                  Add/link to current family
                </button>
                <button type="button" disabled={reviewSubmitting || importing}
                  onClick={() => setClientMatchChoices(p => ({ ...p, [pNo]: 'new_profile' }))}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50 ${choice === 'new_profile'
                    ? 'bg-green-600 border-green-600 text-white'
                    : 'bg-white dark:bg-gray-700 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300'}`}>
                  Create separate new profile
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex gap-3">
        <button onClick={afterClientMatchReview} disabled={reviewSubmitting || importing} className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed">
          {reviewSubmitting || importing ? `Working... ${importProgress.total ? `${importProgress.done}/${importProgress.total}` : ''}` : 'Confirm & Continue'}
        </button>
        <button onClick={() => setStep('upload')} disabled={reviewSubmitting || importing} className="btn-secondary disabled:opacity-60">Back</button>
      </div>
    </div>
  )

  // ── Duplicate review step ───────────────────────────────────
  if (step === 'dup_review') return (
    <div className="space-y-4">
      <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-4">
        <p className="text-sm font-bold text-orange-700 dark:text-orange-300">
          ⚠️ {dupRows.length} duplicate policy number(s) found
        </p>
        <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
          These policy numbers already exist in your database. Choose what to do with each one.
        </p>
      </div>
      <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
        {dupRows.map(({ pNo, data, reason }) => {
          const choice = dupChoices[pNo] || 'skip'
          return (
            <div key={pNo} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-white dark:bg-gray-800">
              <p className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-1">
                📋 {pNo} — <span className="text-gray-500 dark:text-gray-400 font-normal">{data.clientName} · {data.insurer}</span>
              </p>
              <p className="text-xs text-orange-600 dark:text-orange-400 mb-2">⚠️ {reason}</p>
              <div className="flex gap-2 flex-wrap">
                {[
                  { val:'skip',      label:'⏭ Skip — do not import',          cls: choice==='skip'      ? 'bg-gray-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600' },
                  { val:'overwrite', label:'🔄 Import as new version',         cls: choice==='overwrite' ? 'bg-blue-600 text-white'  : 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-600'  },
                  { val:'new',       label:'➕ Import as completely new entry', cls: choice==='new'       ? 'bg-green-600 text-white' : 'bg-white dark:bg-gray-700 text-green-600 dark:text-green-400 border border-green-300 dark:border-green-600' },
                ].map(({ val, label, cls }) => (
                  <button key={val} type="button"
                    disabled={reviewSubmitting || importing}
                    onClick={() => setDupChoices(p => ({ ...p, [pNo]: val }))}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${cls}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex gap-3">
        <button onClick={afterDupReview} disabled={reviewSubmitting || importing} className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed">
          {reviewSubmitting || importing ? `Working... ${importProgress.total ? `${importProgress.done}/${importProgress.total}` : ''}` : 'Confirm & Continue'}
        </button>
        <button onClick={() => setStep('upload')} disabled={reviewSubmitting || importing} className="btn-secondary disabled:opacity-60">Back</button>
      </div>
    </div>
  )

  // ── Lapsed policy review step ────────────────────────────────
  if (step === 'lapse_review') return (
    <div className="space-y-4">
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
        <p className="text-sm font-bold text-red-700 dark:text-red-300">
          ⏰ {lapseRows.length} lapsed policy/policies found (expired more than 30 days ago)
        </p>
        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
          For each lapsed policy: choose to skip, OR confirm it has been renewed by entering new dates.
        </p>
      </div>
      <div className="space-y-4 max-h-80 overflow-y-auto pr-1">
        {lapseRows.map(({ pNo, data, daysAgo }) => {
          const choice = lapseChoices[pNo] || { action: 'skip', newStart: '', newExpiry: '' }
          const setChoice = (updates) => setLapseChoices(p => ({ ...p, [pNo]: { ...choice, ...updates } }))
          return (
            <div key={pNo} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-white dark:bg-gray-800">
              <p className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-1">
                📋 {pNo}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                {data.clientName} · {data.insurer} · Expired <span className="text-red-600 dark:text-red-400 font-semibold">{daysAgo} days ago</span>
              </p>
              <div className="flex gap-2 mb-3">
                <button type="button" disabled={reviewSubmitting || importing} onClick={() => setChoice({ action: 'skip' })}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${choice.action==='skip' ? 'bg-gray-600 text-white' : 'bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}>
                  ⏭ Skip — do not import
                </button>
                <button type="button" disabled={reviewSubmitting || importing} onClick={() => setChoice({ action: 'import' })}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${choice.action==='import' ? 'bg-green-600 text-white' : 'bg-white dark:bg-gray-700 border border-green-300 dark:border-green-600 text-green-600 dark:text-green-400'}`}>
                  ✅ Yes — it has been renewed
                </button>
              </div>
              {choice.action === 'import' && (
                <div className="grid grid-cols-2 gap-3 bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                  <div>
                    <label className="form-label">New Start Date *</label>
                    <DateInput value={choice.newStart||''}
                           onChange={v => setChoice({ newStart: v })}
                           disabled={reviewSubmitting || importing}
                           className="form-input text-sm" />
                  </div>
                  <div>
                    <label className="form-label">New Expiry Date *</label>
                    <DateInput value={choice.newExpiry||''}
                           onChange={v => setChoice({ newExpiry: v })}
                           disabled={reviewSubmitting || importing}
                           className="form-input text-sm" />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex gap-3">
        <button onClick={() => {
          const invalid = lapseRows.filter(({ pNo }) => {
            const ch = lapseChoices[pNo]
            return ch?.action === 'import' && (!ch.newStart || !ch.newExpiry)
          })
          if (invalid.length > 0) {
            toast.error(`Please enter new start & expiry dates for ${invalid.length} policy/policies`)
            return
          }
          setReviewSubmitting(true)
          doImport(pendingOverrides, pendingAutoCreate, dupChoices, lapseChoices)
        }} disabled={reviewSubmitting || importing} className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed">
          {reviewSubmitting || importing ? `Working... ${importProgress.total ? `${importProgress.done}/${importProgress.total}` : ''}` : 'Confirm & Import'}
        </button>
        <button onClick={() => setStep('upload')} disabled={reviewSubmitting || importing} className="btn-secondary disabled:opacity-60">Back</button>
      </div>
    </div>
  )

  if (step === 'mapping') return (
    <ClientMappingStep
      unmapped={unmapped} clients={clients}
      onConfirm={map => { setStep('upload'); preflight(map, pendingAutoCreate) }}
      onBack={() => setStep('upload')}
    />
  )

  return (
    <div className="space-y-4">
      {/* Auto-assign toggle */}
      <div className={`rounded-xl p-3 border flex items-start gap-3 ${autoAssign?'bg-green-50 border-green-200':'bg-gray-50 border-gray-200'}`}>
        <input type="checkbox" checked={autoAssign} onChange={e=>setAutoAssign(e.target.checked)}
               className="w-5 h-5 mt-0.5 cursor-pointer flex-shrink-0" />
        <div>
          <p className={`text-sm font-semibold ${autoAssign?'text-green-700':'text-gray-600'}`}>
            ⚡ Auto-Assign Clients {autoAssign?'(ON — Recommended)':'(OFF)'}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {autoAssign
              ? 'Existing clients will be linked only; saved client details will not be overwritten. If imported details differ, the policy is flagged for manual review. New names are created as clients.'
              : 'You will be shown a mapping screen for any client names not found in your database.'}
          </p>
        </div>
      </div>

      {/* Step 1 */}
      <div className={`${c.bg} border ${c.border} rounded-xl p-4`}>
        <p className={`text-sm font-semibold ${c.text} mb-2`}>
          Step 1 — Download the {icon} {policyType} template
        </p>
        <p className="text-xs text-gray-500 mb-3">
          Fill in the template with your policy data. The first row is the header — do not change column names.
          The second row is a sample — replace it with your data.
        </p>
        <button
          onClick={() => downloadTemplate(headers, `${policyType} Policies`, `${policyType.toLowerCase()}_policies_import`, sample)}
          className="btn-primary text-sm">
          ⬇ Download {policyType} Template ({headers.length} columns)
        </button>
      </div>

      {/* Step 2 */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-blue-700 mb-2">Step 2 — Upload your filled file</p>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFileChange} className="text-sm" />
        {rows && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-1 rounded">
              ✅ {rows.length} {policyType} rows ready to import
            </span>
            <button onClick={() => { setRows(null); if(fileRef.current) fileRef.current.value='' }}
                    className="text-xs text-gray-400 hover:text-red-500">✕ Clear</button>
          </div>
        )}
      </div>

      {/* Column preview */}
      <details className="bg-gray-50 border border-gray-200 rounded-xl">
        <summary className="px-4 py-2 text-xs font-semibold text-gray-600 cursor-pointer">
          📋 View all {headers.length} columns in this template
        </summary>
        <div className="px-4 pb-3 pt-1">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-48 overflow-y-auto">
            {headers.map((h, i) => (
              <div key={h} className="flex items-center gap-1.5 text-xs text-gray-600">
                <span className="text-gray-300 font-mono w-4 text-right flex-shrink-0">{i+1}</span>
                <span className="truncate">{h}</span>
              </div>
            ))}
          </div>
        </div>
      </details>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 max-h-40 overflow-y-auto">
          <p className="text-xs font-semibold text-red-700 mb-1">⚠️ Import errors:</p>
          {errors.map((e, i) => <p key={i} className="text-xs text-red-600">• {e}</p>)}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onClickImport}
          disabled={!rows || importing || preflighting}
          className="btn-primary">
          {preflighting
            ? <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>Scanning {rows?.length||0} rows for duplicates…</span>
            : importing
            ? <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>Importing…</span>
            : `✅ Import ${rows?.length || 0} ${policyType} Policies`}
        </button>
        <button onClick={onClose} disabled={importing || preflighting} className="btn-secondary">Cancel</button>
      </div>
      {importing && importProgress.total > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs font-semibold text-blue-700">
            <span>Importing {importProgress.done}/{importProgress.total} records...</span>
            <span>{Math.round((importProgress.done / importProgress.total) * 100)}%</span>
          </div>
          <div className="h-2 rounded-full bg-blue-100 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all"
              style={{ width: `${Math.round((importProgress.done / importProgress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Import type selector modal ────────────────────────────────
function ImportModal({ clients, onClose, onImported }) {
  const [type, setType] = useState(null) // null | 'Health' | 'Life' | 'Motor'

  if (type === 'Health') return (
    <TypedImportModal policyType="Health" icon="🏥" color="green"
      headers={HEALTH_IMPORT_HEADERS} sample={HEALTH_IMPORT_SAMPLE} parseRow={parseHealthRow}
      clients={clients} onClose={onClose} onImported={onImported} />
  )
  if (type === 'Life') return (
    <TypedImportModal policyType="Life" icon="🛡️" color="purple"
      headers={LIFE_IMPORT_HEADERS} sample={LIFE_IMPORT_SAMPLE} parseRow={parseLifeRow}
      clients={clients} onClose={onClose} onImported={onImported} />
  )
  if (type === 'Motor') return (
    <TypedImportModal policyType="Motor" icon="🚗" color="orange"
      headers={MOTOR_IMPORT_HEADERS} sample={MOTOR_IMPORT_SAMPLE} parseRow={parseMotorRow}
      clients={clients} onClose={onClose} onImported={onImported} />
  )

  // Type selector screen
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">Choose the type of policies you want to import. Each type has its own template with the correct columns.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { type:'Health', icon:'🏥', color:'green',  desc:'Sum Insured, Members, Coverage details',    cols: HEALTH_IMPORT_HEADERS.length },
          { type:'Life',   icon:'🛡️', color:'purple', desc:'Sum Assured, PPT, Policy Term, Sub-type',   cols: LIFE_IMPORT_HEADERS.length   },
          { type:'Motor',  icon:'🚗', color:'orange', desc:'Registration No, IDV, NCB, Vehicle details', cols: MOTOR_IMPORT_HEADERS.length  },
        ].map(({ type: t, icon, color, desc, cols }) => {
          const bg = { green:'bg-green-50 border-green-200 hover:bg-green-100', purple:'bg-purple-50 border-purple-200 hover:bg-purple-100', orange:'bg-orange-50 border-orange-200 hover:bg-orange-100' }[color]
          const tx = { green:'text-green-700', purple:'text-purple-700', orange:'text-orange-700' }[color]
          return (
            <button key={t} onClick={() => setType(t)}
                    className={`${bg} border rounded-2xl p-5 text-left transition-all hover:shadow-md cursor-pointer`}>
              <p className="text-3xl mb-2">{icon}</p>
              <p className={`font-bold text-base ${tx}`}>{t} Policies</p>
              <p className="text-xs text-gray-500 mt-1">{desc}</p>
              <p className="text-xs text-gray-400 mt-2">{cols} columns</p>
            </button>
          )
        })}
      </div>
      <button onClick={onClose} className="btn-secondary w-full">Cancel</button>
    </div>
  )
}

export default ImportModal
