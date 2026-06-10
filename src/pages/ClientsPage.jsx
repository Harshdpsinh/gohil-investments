// src/pages/ClientsPage.jsx
import { useState, useMemo, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useClients }  from '../hooks/useClients'
import { usePolicies } from '../hooks/usePolicies'
import { useAuth }     from '../hooks/useAuth'
import {
  addClient, cascadeUpdateClient, deleteClient,
  bulkDeleteClients, getDocMeta,
  mergeClients, bulkMergeClients
} from '../firebase/firestore'
import { uploadClientDocument, deleteClientDocument, deleteStorageObjectByPath } from '../firebase/storage'
import { computeCoverageGaps } from '../utils/policySchemas'
import Modal         from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import DateInput     from '../components/ui/DateInput'
import { fmtDate, fmtCurrency, parseAnyDate } from '../utils/dateUtils'
import { exportToCSV, exportToExcel, exportToPDF, CLIENT_COLS } from '../utils/exportUtils'
import { openWhatsAppLink } from '../services/whatsappService'
import toast from 'react-hot-toast'
import { differenceInDays } from 'date-fns'

const EMPTY = {
  name:'', mobile:'', email:'', pan:'', aadhar:'',
  dob:'', gender:'', address:'', city:'', state:'',
  occupation:'', employment:'', income:'',
  qualification:'', designation:'',
  kycStatus:'Pending', familyId:'', familyName:'', familyRole:'', notes:''
}
const CLIENT_FORM_FIELDS = Object.keys(EMPTY)
const KYC_OPTIONS = ['Pending','In Progress','Complete']
const GENDERS     = ['Male','Female','Other']
const PAGE_SIZE   = 50

function birthdayDays(dob) {
  if (!dob) return null
  try {
    const d = parseAnyDate(dob)
    if (!d) return null
    const now  = new Date()
    let bday = new Date(now.getFullYear(), d.getMonth(), d.getDate())
    // If this year's birthday already passed, check next year
    if (differenceInDays(bday, now) < 0) {
      bday = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate())
    }
    const diff = differenceInDays(bday, now)
    return diff >= 0 && diff <= 30 ? diff : null
  } catch { return null }
}

// ── Client Form ───────────────────────────────────────────────
function ClientForm({ initial, onSave, onCancel }) {
  const [form,   setForm]   = useState(() => ({
    ...EMPTY,
    ...Object.fromEntries(CLIENT_FORM_FIELDS.map(field => [field, initial?.[field] ?? EMPTY[field]])),
  }))
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setForm(p=>({...p,[k]:v}))

  const inp = (k,lbl,type='text',opts={}) => (
    <div><label className="form-label">{lbl}</label>
      {type === 'date'
        ? <DateInput value={form[k]||''} onChange={v=>set(k,v)} className="form-input" {...opts} />
        : <input type={type} value={form[k]||''} onChange={e=>set(k,e.target.value)} className="form-input" {...opts} />}
    </div>
  )

  const onSubmit = async e => {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Name is required'); return }
    if (form.mobile && !/^[6-9]\d{9}$/.test(form.mobile.replace(/\D/g, '').slice(-10))) {
      toast.error('Enter a valid 10 digit Indian mobile number'); return
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast.error('Enter a valid email address'); return
    }
    if (form.pan && !/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/.test(form.pan.trim())) {
      toast.error('PAN must be in format ABCDE1234F'); return
    }
    if (form.aadhar && form.aadhar.replace(/\D/g, '').length !== 12) {
      toast.error('Aadhar must contain exactly 12 digits'); return
    }
    if (form.income && Number(form.income) < 0) {
      toast.error('Annual income cannot be negative'); return
    }
    setSaving(true)
    const cleanForm = Object.fromEntries(CLIENT_FORM_FIELDS.map(field => [field, form[field] ?? '']))
    try { await onSave(cleanForm) }
    catch(err) { toast.error('Save failed: ' + (err.message || 'Unknown error')) }
    finally { setSaving(false) }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Personal Details</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {inp('name','Full Name *','text',{required:true,placeholder:'e.g. Hemrajsinh Chudasama'})}
        {inp('dob','Date of Birth','date')}
        <div><label className="form-label">Gender</label>
          <select value={form.gender||''} onChange={e=>set('gender',e.target.value)} className="form-select">
            <option value="">— Select —</option>
            {GENDERS.map(g=><option key={g}>{g}</option>)}
          </select></div>
        {inp('mobile','Mobile','tel',{placeholder:'9714805805'})}
        {inp('email','Email','email')}
        {inp('pan','PAN Number','text',{placeholder:'AGAPC6211B'})}
        {inp('aadhar','Aadhar Number')}
      </div>
      {inp('address','Address')}
      <div className="grid grid-cols-2 gap-4">{inp('city','City')}{inp('state','State')}</div>
      <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider mt-2">Professional</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {inp('occupation','Occupation')}
        {inp('employment','Employment Type')}
        {inp('income','Annual Income (₹)','number')}
        {inp('qualification','Qualification')}
        {inp('designation','Designation')}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className="form-label">KYC Status</label>
          <select value={form.kycStatus} onChange={e=>set('kycStatus',e.target.value)} className="form-select">
            {KYC_OPTIONS.map(o=><option key={o}>{o}</option>)}
          </select></div>
      </div>
      <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider mt-2">Family Unit</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {inp('familyName','Family Name','text',{placeholder:'e.g. Gohil Family'})}
        {inp('familyId','Family ID','text',{placeholder:'e.g. FAM-GOHIL-001'})}
        {inp('familyRole','Family Role','text',{placeholder:'Self, Spouse, Child'})}
      </div>
      <div><label className="form-label">Notes</label>
        <textarea rows={2} value={form.notes||''} onChange={e=>set('notes',e.target.value)} className="form-input" /></div>
      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={saving} className="btn-primary">{saving?'⏳ Saving…':'💾 Save Client'}</button>
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </form>
  )
}

// ── Document Manager ──────────────────────────────────────────
// Fix: was using useState for side effect — changed to useEffect
function DocumentManager({ clientId }) {
  const { isAdmin } = useAuth()
  const [docs,      setDocs]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [progress,  setProgress]  = useState(0)
  const fileRef = useRef()

  const load = async () => {
    setLoading(true)
    try {
      const data = await getDocMeta(clientId)
      setDocs(data)
    } catch { setDocs([]) }
    finally { setLoading(false) }
  }

  // Fix: was `useState(() => { load() }, [])` — should be useEffect
  useEffect(() => { if (clientId) load() }, [clientId])

  const onFile = async e => {
    const file = e.target.files?.[0]; if (!file) return
    if (file.size > 10*1024*1024) { toast.error('File must be < 10 MB'); return }
    setUploading(true); setProgress(0)
    try {
      await uploadClientDocument(clientId, file, setProgress)
      toast.success(`${file.name} uploaded`)
      await load()
    } catch(err) {
      const message = err?.code === 'storage/unauthorized'
        ? 'Document upload blocked by Firebase Storage rules. Deploy storage.rules, then try again.'
        : err?.code === 'storage/quota-exceeded'
          ? 'Firebase Storage quota is full. Free space or upgrade the plan.'
          : err?.code === 'storage/timeout'
            ? 'Document upload is taking too long. Check internet, try a smaller file, or upload from a newer browser.'
            : err?.code === 'storage/canceled'
              ? 'Document upload was cancelled because it took too long. Please try again.'
              : err.message || 'Document upload failed. Please try again.'
      toast.error(message)
    }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const onDelete = async docItem => {
    // Use toast confirmation instead of blocking window.confirm
    toast((t) => (
      <span className="flex items-center gap-3 text-sm">
        Delete <strong>{docItem.name}</strong>?
        <button
          onClick={async () => {
            toast.dismiss(t.id)
            try {
              await deleteClientDocument(clientId, docItem.id)
              toast.success('File deleted')
              setDocs(p => p.filter(d => d.id !== docItem.id))
            } catch(err) { toast.error(err.message) }
          }}
          className="px-2 py-1 bg-red-600 text-white text-xs rounded font-semibold">
          Delete
        </button>
        <button onClick={() => toast.dismiss(t.id)}
                className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded font-semibold">
          Cancel
        </button>
      </span>
    ), { duration: 6000 })
  }

  if (loading) return <p className="text-gray-400 dark:text-gray-500 text-sm">Loading documents…</p>
  return (
    <div className="space-y-3 mt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">📎 Documents</p>
        <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-secondary text-xs">
          {uploading ? `⏳ ${progress}%` : '+ Upload PDF/Image'}
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={onFile} />
      </div>
      {/* Side-scrollable document list */}
      <div className="overflow-x-auto">
        {docs.length === 0
          ? <p className="text-xs text-gray-400 dark:text-gray-500">No documents uploaded yet.</p>
          : <ul className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden min-w-[420px]">
              {docs.map(d => (
                <li key={d.id} className="flex items-center justify-between px-3 py-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700">
                  <a href={d.url} target="_blank" rel="noreferrer"
                     className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[70%]">📄 {d.name}</a>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-gray-400 dark:text-gray-500">{Math.round((d.size||0)/1024)} KB</span>
                    {isAdmin && (
                      <button onClick={() => onDelete(d)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
        }
      </div>
    </div>
  )
}

// ── CliMer — Client Merger UI ─────────────────────────────────
function CliMerModal({ clients, onClose, onMerged }) {
  const [mode,        setMode]        = useState('suggest') // 'suggest' | 'single' | 'bulk'
  const [masterId,    setMasterId]    = useState('')
  const [dupId,       setDupId]       = useState('')
  const [dupIds,      setDupIds]      = useState([])
  const [merging,     setMerging]     = useState(false)
  const [results,     setResults]     = useState(null)
  const [search,      setSearch]      = useState('')

  const sortedClients = useMemo(() =>
    [...clients].sort((a,b) => a.name.localeCompare(b.name)),
    [clients]
  )
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return !q ? sortedClients : sortedClients.filter(c =>
      c.name.toLowerCase().includes(q) || (c.mobile||'').includes(q)
    )
  }, [sortedClients, search])

  // Auto-detect duplicate pairs: same mobile OR name similarity (first 6 chars match)
  const suggestedPairs = useMemo(() => {
    const pairs = []
    const seen  = new Set()
    for (let i = 0; i < clients.length; i++) {
      for (let j = i + 1; j < clients.length; j++) {
        const a = clients[i], b = clients[j]
        const key = [a.id, b.id].sort().join('|')
        if (seen.has(key)) continue
        const aMob = (a.mobile||'').replace(/\D/g,'')
        const bMob = (b.mobile||'').replace(/\D/g,'')
        const sameMobile = aMob.length >= 8 && aMob === bMob
        const aName = a.name.toLowerCase().replace(/\s+/g,'')
        const bName = b.name.toLowerCase().replace(/\s+/g,'')
        const nameSim = aName.length >= 5 && bName.length >= 5 &&
          (aName.startsWith(bName.slice(0,6)) || bName.startsWith(aName.slice(0,6)) ||
           aName.includes(bName.slice(0,5)) || bName.includes(aName.slice(0,5)))
        if (sameMobile || nameSim) {
          seen.add(key)
          pairs.push({ a, b, reason: sameMobile ? '📱 Same mobile' : '👤 Similar name' })
        }
      }
    }
    return pairs
  }, [clients])

  const toggleDup = id => {
    setDupIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const quickMerge = async (dupClientId, masterClientId) => {
    setMerging(true)
    try {
      const r = await mergeClients(dupClientId, masterClientId)
      toast.success(`✅ Merged! ${r.policiesMoved} policies, ${r.claimsMoved} claims, ${r.tasksMoved} tasks moved.`)
      onMerged()
    } catch(err) { toast.error('Merge failed: ' + err.message) }
    finally { setMerging(false) }
  }

  const doSingleMerge = async () => {
    if (!masterId) { toast.error('Select a master client'); return }
    if (!dupId)    { toast.error('Select a duplicate client'); return }
    if (dupId === masterId) { toast.error('Master and duplicate cannot be the same'); return }
    setMerging(true)
    try {
      const r = await mergeClients(dupId, masterId)
      toast.success(`✅ Merged! ${r.policiesMoved} policies, ${r.claimsMoved} claims, ${r.tasksMoved} tasks, ${r.docsMoved} docs moved.`)
      onMerged()
      onClose()
    } catch(err) { toast.error('Merge failed: ' + err.message) }
    finally { setMerging(false) }
  }

  const doBulkMerge = async () => {
    if (!masterId)       { toast.error('Select a master client'); return }
    if (!dupIds.length)  { toast.error('Select at least one duplicate'); return }
    if (dupIds.includes(masterId)) { toast.error('Master cannot be in duplicates list'); return }
    setMerging(true)
    try {
      const res = await bulkMergeClients(dupIds, masterId)
      setResults(res)
      const ok  = res.filter(r => r.success).length
      const err = res.filter(r => !r.success).length
      toast.success(`✅ Bulk merge complete: ${ok} merged${err>0?`, ${err} failed`:''}`)
      onMerged()
    } catch(err) { toast.error('Bulk merge failed: ' + err.message) }
    finally { setMerging(false) }
  }

  const masterClient = clients.find(c => c.id === masterId)
  const dupClient    = clients.find(c => c.id === dupId)

  return (
    <div className="space-y-5">
      {/* Mode tabs */}
      <div className="flex gap-2 flex-wrap">
        {[['suggest',`🔍 Suggested (${suggestedPairs.length})`],['single','🔀 Single Merge'],['bulk','🔀 Bulk Merge']].map(([m,l]) => (
          <button key={m} onClick={() => { setMode(m); setResults(null) }}
                  className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${mode===m?'bg-blue-600 text-white':'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3 text-xs text-blue-700 dark:text-blue-300">
        <p className="font-semibold">How CliMer works:</p>
        <p className="mt-1">All policies, claims, tasks, and documents from the <strong>duplicate</strong> client are moved to the <strong>master</strong> client. The duplicate is then permanently deleted. This cannot be undone.</p>
      </div>

      {/* ── SUGGESTED DUPLICATES TAB ── */}
      {mode === 'suggest' && (
        <>
          {suggestedPairs.length === 0 ? (
            <div className="text-center py-10 text-gray-400 dark:text-gray-500">
              <p className="text-2xl mb-2">✅</p>
              <p className="font-semibold">No duplicate clients detected</p>
              <p className="text-xs mt-1">No clients share a mobile number or a similar name.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {suggestedPairs.length} possible duplicate pair{suggestedPairs.length!==1?'s':''} found. For each pair, click <strong>Keep →</strong> to set that side as master and merge the other into it.
              </p>
              {suggestedPairs.map(({ a, b, reason }) => (
                <div key={`${a.id}|${b.id}`} className="border border-orange-200 dark:border-orange-800 rounded-xl p-3 bg-orange-50 dark:bg-orange-900/20">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-semibold text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-900/40 px-2 py-0.5 rounded-full">{reason}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-2 border border-gray-200 dark:border-gray-700">
                      <p className="font-semibold text-gray-800 dark:text-gray-200">{a.name}</p>
                      <p className="text-gray-400 dark:text-gray-500 mt-0.5">{a.mobile||'No mobile'}</p>
                      <button onClick={() => quickMerge(b.id, a.id)} disabled={merging}
                              className="mt-2 w-full px-2 py-1 bg-green-600 text-white rounded text-xs font-semibold hover:bg-green-700 disabled:opacity-50">
                        Keep this → merge other
                      </button>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-2 border border-gray-200 dark:border-gray-700">
                      <p className="font-semibold text-gray-800 dark:text-gray-200">{b.name}</p>
                      <p className="text-gray-400 dark:text-gray-500 mt-0.5">{b.mobile||'No mobile'}</p>
                      <button onClick={() => quickMerge(a.id, b.id)} disabled={merging}
                              className="mt-2 w-full px-2 py-1 bg-green-600 text-white rounded text-xs font-semibold hover:bg-green-700 disabled:opacity-50">
                        Keep this → merge other
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── SINGLE / BULK TABS ── */}
      {mode !== 'suggest' && (
        <>
          {/* Master client selector */}
          <div>
            <label className="form-label">✅ Master Client (keep this one)</label>
            <input type="text" placeholder="Search…" value={search}
                   onChange={e => setSearch(e.target.value)} className="form-input mb-2" />
            <select value={masterId} onChange={e => { setMasterId(e.target.value); setDupId('') }}
                    className="form-select" size={5}>
              <option value="">— Select master —</option>
              {filtered.map(c => (
                <option key={c.id} value={c.id}>{c.name} {c.mobile ? `· ${c.mobile}` : ''}</option>
              ))}
            </select>
            {masterClient && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-1 font-semibold">
                ✅ Master: {masterClient.name} {masterClient.mobile ? `(${masterClient.mobile})` : ''}
              </p>
            )}
          </div>

          {mode === 'single' ? (
            <>
              <div>
                <label className="form-label">🗑️ Duplicate Client (will be deleted)</label>
                <select value={dupId} onChange={e => setDupId(e.target.value)}
                        className="form-select" size={5}>
                  <option value="">— Select duplicate —</option>
                  {filtered.filter(c => c.id !== masterId).map(c => (
                    <option key={c.id} value={c.id}>{c.name} {c.mobile ? `· ${c.mobile}` : ''}</option>
                  ))}
                </select>
                {dupClient && (
                  <p className="text-xs text-orange-600 dark:text-orange-400 mt-1 font-semibold">
                    ⚠️ Duplicate: {dupClient.name} — will be permanently deleted after merge
                  </p>
                )}
              </div>

              {masterId && dupId && masterId !== dupId && (
                <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-3 text-sm">
                  <p className="font-semibold text-orange-700 dark:text-orange-300">Confirm merge:</p>
                  <p className="text-orange-600 dark:text-orange-400 mt-1">
                    Move all data from <strong>{dupClient?.name}</strong> → <strong>{masterClient?.name}</strong> then delete {dupClient?.name}.
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={doSingleMerge} disabled={merging || !masterId || !dupId || dupId===masterId}
                        className="btn-primary">
                  {merging ? '⏳ Merging…' : '🔀 Merge Now'}
                </button>
                <button onClick={onClose} className="btn-secondary">Cancel</button>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="form-label">🗑️ Duplicate Clients (select all to merge into master)</label>
                <div className="max-h-52 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-xl divide-y divide-gray-100 dark:divide-gray-700">
                  {filtered.filter(c => c.id !== masterId).map(c => (
                    <label key={c.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 ${dupIds.includes(c.id) ? 'bg-orange-50 dark:bg-orange-900/20' : 'bg-white dark:bg-gray-800'}`}>
                      <input type="checkbox" checked={dupIds.includes(c.id)}
                             onChange={() => toggleDup(c.id)} className="w-4 h-4 cursor-pointer" />
                      <span className="text-sm text-gray-800 dark:text-gray-200">
                        {c.name} {c.mobile ? <span className="text-gray-400 dark:text-gray-500">· {c.mobile}</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
                {dupIds.length > 0 && (
                  <p className="text-xs text-orange-600 dark:text-orange-400 mt-1 font-semibold">
                    {dupIds.length} client(s) selected for deletion after merge
                  </p>
                )}
              </div>

              {results && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 px-3 py-2 bg-gray-50 dark:bg-gray-700">Merge Results</p>
                  {results.map(r => {
                    const c = clients.find(x => x.id === r.duplicateId)
                    return (
                      <div key={r.duplicateId} className={`px-3 py-2 text-xs border-t border-gray-100 dark:border-gray-700 ${r.success ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
                        {r.success
                          ? `✅ ${c?.name||r.duplicateId}: ${r.policiesMoved} policies, ${r.claimsMoved} claims, ${r.docsMoved} docs moved`
                          : `❌ ${c?.name||r.duplicateId}: ${r.error}`}
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={doBulkMerge} disabled={merging || !masterId || !dupIds.length}
                        className="btn-primary">
                  {merging ? '⏳ Merging…' : `🔀 Bulk Merge ${dupIds.length} Client${dupIds.length!==1?'s':''}`}
                </button>
                <button onClick={onClose} className="btn-secondary">Cancel</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function ClientsPage() {
  const { clients, loading } = useClients()
  const { policies }         = usePolicies()
  const { isAdmin }          = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [search,       setSearch]       = useState('')
  const [kycFilter,    setKycFilter]    = useState('All')
  const [modal,        setModal]        = useState(null)
  const [selected,     setSelected]     = useState(null)
  const [delOpen,      setDelOpen]      = useState(false)
  const [showGapsOnly, setShowGapsOnly] = useState(false)
  const [selectedIds,  setSelectedIds]  = useState(new Set())
  const [bulkDelOpen,  setBulkDelOpen]  = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [greetingClient, setGreetingClient] = useState(null)
  const [greetingMsg,    setGreetingMsg]    = useState('')
  const [page,           setPage]           = useState(1)

  // Pre-compute per-client data
  const clientData = useMemo(() =>
    clients.map(c => {
      const cp             = policies.filter(p => p.clientId === c.id)
      const gaps           = computeCoverageGaps(cp)
      const bday           = birthdayDays(c.dob)
      const activePolicies = cp.filter(p =>
        !['Renewed-Out','Cancelled','Matured'].includes((p.status||'').trim())
      ).length
      return { ...c, _gaps: gaps, _bday: bday, _policyCount: activePolicies }
    }),
    [clients, policies]
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return clientData.filter(c => {
      const mQ    = !q || c.name?.toLowerCase().includes(q) || c.mobile?.includes(q) || c.pan?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)
      const mKyc  = kycFilter==='All' || c.kycStatus===kycFilter
      const mGaps = !showGapsOnly || c._gaps.length > 0
      return mQ && mKyc && mGaps
    })
  }, [clientData, search, kycFilter, showGapsOnly])

  useEffect(() => { setPage(1) }, [search, kycFilter, showGapsOnly])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedClients = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage]
  )
  useEffect(() => {
    if (page !== safePage) setPage(safePage)
  }, [page, safePage])

  useEffect(() => {
    const editClientId = location.state?.editClientId
    if (!editClientId || loading) return
    const client = clients.find(c => c.id === editClientId)
    if (!client) {
      toast.error('Client not found for editing.')
      navigate('/clients', { replace: true, state: null })
      return
    }
    setSelected(client)
    setModal('edit')
    navigate('/clients', { replace: true, state: null })
  }, [clients, loading, location.state, navigate])

  const kycBadge = s => s==='Complete'?'badge-green':s==='In Progress'?'badge-yellow':'badge-red'

  const onAdd    = async form => { await addClient(form); toast.success('Client added!'); setModal(null) }
  const onEdit   = async form => {
    await cascadeUpdateClient(selected.id, form)
    toast.success('Client updated — changes reflected everywhere!')
    setModal(null)
  }
  const deleteClientStorageDocs = async (clientId) => {
    const docs = await getDocMeta(clientId)
    await Promise.all(docs.map(d => deleteStorageObjectByPath(d.storagePath)))
  }
  const onDelete = async () => {
    try {
      await deleteClientStorageDocs(selected.id)
      await deleteClient(selected.id)
      toast.success('Client deleted')
      setDelOpen(false)
      setSelected(null)
    } catch (err) {
      const message = err?.code === 'permission-denied'
        ? 'You do not have permission to delete this client. Sign in as Admin, then try again.'
        : err?.message || 'Client could not be deleted. Please try again.'
      toast.error(message)
    }
  }

  const openGreeting = client => {
    const count = policies.filter(p =>
      p.clientId === client.id &&
      !['Renewed-Out','Cancelled','Matured'].includes((p.status||'').trim())
    ).length
    const msg = `🎂 Dear ${client.name},\n\nWishing you a very Happy Birthday! 🎉\n\nMay this special day bring you joy, good health, and prosperity.\n\nThank you for trusting *Gohil Investments* with your financial and insurance needs. We are committed to protecting what matters most to you.\n\nYou currently have ${count} active polic${count===1?'y':'ies'} with us. If you need any assistance or wish to review your coverage, we are always here to help.\n\nOnce again, Happy Birthday! 🎈\n\n*Gohil Investments*\nWealth Management & Insurance Advisory\n📞 *Harshdipsinh Gohil* — 7698997894\n📞 Pradipsinh Gohil — 9426204547\n📍 Bhavnagar, Gujarat`
    setGreetingClient(client)
    setGreetingMsg(msg)
    setModal('greeting')
  }

  const sendBirthdayWA = () => {
    try {
      openWhatsAppLink({ mobile: greetingClient?.mobile, message: greetingMsg })
    } catch (err) {
      toast.error(err.message)
    }
  }

  const allFilteredIds = pagedClients.map(c => c.id)
  const allSelected    = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedIds.has(id))
  const someSelected   = selectedIds.size > 0

  const toggleOne = id => setSelectedIds(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n })
  const toggleAll = () => {
    if (allSelected) setSelectedIds(prev => { const n=new Set(prev); allFilteredIds.forEach(id=>n.delete(id)); return n })
    else             setSelectedIds(prev => { const n=new Set(prev); allFilteredIds.forEach(id=>n.add(id));    return n })
  }
  const clearSelection = () => setSelectedIds(new Set())

  const onBulkDelete = async () => {
    setBulkDeleting(true)
    try {
      const count = selectedIds.size
      await Promise.all([...selectedIds].map(id => deleteClientStorageDocs(id)))
      await bulkDeleteClients([...selectedIds])
      toast.success(`${count} client(s) deleted`)
      clearSelection()
      setBulkDelOpen(false)
    } catch(err) {
      const message = err?.code === 'permission-denied'
        ? 'You do not have permission to delete these clients. Sign in as Admin, then try again.'
        : err?.message || 'Selected clients could not be deleted. Please try again.'
      toast.error(message)
    }
    finally { setBulkDeleting(false) }
  }

  if (loading) return (
    <div className="p-8 text-gray-400 dark:text-gray-500 flex items-center gap-2">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      Loading clients…
    </div>
  )

  const gapCount = clientData.filter(c => c._gaps.length > 0).length

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Clients</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{clients.length} total · {gapCount} with coverage gaps</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-primary" onClick={() => { setSelected(null); setModal('add') }}>+ Add Client</button>
          {isAdmin && (
            <button
              className="px-4 py-2 text-sm font-semibold bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              onClick={() => setModal('climer')}
              title="Merge duplicate clients">
              🔀 CliMer
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
        {/* Inline search (no separate SearchBar component needed) */}
        <input
          type="search"
          placeholder="Search by name, mobile, PAN…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="form-input w-64"
        />
        <div className="flex gap-2 flex-wrap">
          {['All',...KYC_OPTIONS].map(o=>(
            <button key={o} onClick={() => setKycFilter(o)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                kycFilter===o?'bg-blue-600 text-white':'bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}>{o}</button>
          ))}
          <button onClick={() => setShowGapsOnly(p=>!p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              showGapsOnly?'bg-orange-500 text-white border-orange-500':'bg-white dark:bg-gray-700 text-orange-600 dark:text-orange-400 border-orange-300 dark:border-orange-700 hover:bg-orange-50 dark:hover:bg-orange-900/20'
            }`}>
            🎯 Gaps Only {gapCount>0&&`(${gapCount})`}
          </button>
        </div>
        <div className="flex gap-2 ml-auto flex-wrap">
          <button onClick={() => exportToCSV(filtered,CLIENT_COLS,'clients')} className="btn-secondary text-xs">⬇ CSV</button>
          <button onClick={() => exportToExcel(filtered,CLIENT_COLS,'Clients','clients')} className="btn-secondary text-xs">⬇ Excel</button>
          <button onClick={async () => await exportToPDF(filtered,CLIENT_COLS,'Client List','clients')} className="btn-secondary text-xs">⬇ PDF</button>
        </div>
      </div>

      {/* Bulk action bar */}
      {isAdmin && someSelected && (
        <div className="flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
          <span className="text-sm font-semibold text-red-700 dark:text-red-300">
            {selectedIds.size} client{selectedIds.size > 1 ? 's' : ''} selected
          </span>
          <button onClick={() => setBulkDelOpen(true)}
                  className="px-4 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700">
            🗑️ Delete Selected
          </button>
          <button onClick={clearSelection}
                  className="px-3 py-1.5 bg-white dark:bg-gray-700 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-semibold rounded-lg hover:bg-red-50">
            ✕ Clear
          </button>
          <span className="text-xs text-red-500 dark:text-red-400 ml-auto">
            ⚠️ This will also delete all linked policies
          </span>
        </div>
      )}

      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-xs">
          <span className="text-gray-500 dark:text-gray-400">
            Showing {(safePage - 1) * PAGE_SIZE + 1}-{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length} clients
          </span>
          <div className="flex items-center gap-2">
            <button className="btn-secondary text-xs" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
            <span className="text-gray-600 dark:text-gray-300 font-semibold">Page {safePage} / {totalPages}</span>
            <button className="btn-secondary text-xs" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</button>
          </div>
        </div>
      )}

      {/* Side-scrollable table */}
      <div className="table-container">
        <table className="min-w-full" style={{ minWidth: '900px' }}>
          <thead>
            <tr>
              <th className="table-header w-10">
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                       className="w-4 h-4 cursor-pointer" title={allSelected?'Deselect all':'Select all visible'} />
              </th>
              {['Name','Mobile','Email','PAN','Policies','KYC','Birthday','Coverage Gaps'].map(h=>(
                <th key={h} className="table-header">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800">
            {filtered.length === 0
              ? <tr><td colSpan={9} className="text-center text-gray-400 dark:text-gray-500 py-10">No clients found</td></tr>
              : pagedClients.map(c => (
                <tr key={c.id} className={`table-row ${selectedIds.has(c.id)?'bg-blue-50 dark:bg-blue-900/20':c._bday!==null?'bg-pink-50/40 dark:bg-pink-900/10':''}`}>
                  <td className="table-cell">
                    <input type="checkbox" checked={selectedIds.has(c.id)}
                           onChange={() => toggleOne(c.id)} className="w-4 h-4 cursor-pointer" />
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 dark:text-gray-100 cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
                            onClick={() => { setSelected(c); setModal('view') }}>{c.name}</span>
                      <button onClick={() => { setSelected(c); setModal('edit') }}
                              className="px-2 py-1 text-xs bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-100">Edit</button>
                      {c._bday !== null && c._bday <= 7 && (
                        <button onClick={() => openGreeting(c)}
                                className="px-2 py-1 text-xs bg-pink-50 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300 rounded hover:bg-pink-100"
                                title="Send Birthday Greeting">Bday</button>
                      )}
                      {isAdmin && (
                        <button onClick={() => { setSelected(c); setDelOpen(true) }}
                                className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded hover:bg-red-100">Del</button>
                      )}
                    </div>
                  </td>
                  <td className="table-cell">
                    {c.mobile
                      ? <span className="text-gray-700 dark:text-gray-300">{c.mobile}</span>
                      : <span className="text-orange-500 dark:text-orange-400 text-xs font-semibold" title="Add mobile for WhatsApp">⚠️ Missing</span>}
                  </td>
                  <td className="table-cell text-gray-600 dark:text-gray-400">{c.email||'—'}</td>
                  <td className="table-cell font-mono text-xs text-gray-600 dark:text-gray-400">{c.pan||'—'}</td>
                  <td className="table-cell text-center">
                    <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded">
                      {c._policyCount}
                    </span>
                  </td>
                  <td className="table-cell"><span className={kycBadge(c.kycStatus)}>{c.kycStatus||'Pending'}</span></td>
                  <td className="table-cell text-center">
                    {c._bday !== null
                      ? <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${c._bday===0?'bg-pink-500 text-white':'bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300'}`}>
                          {c._bday===0 ? '🎂 Today!' : `🎂 ${c._bday}d`}
                        </span>
                      : <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                    }
                  </td>
                  <td className="table-cell">
                    {c._gaps.length > 0
                      ? <div className="flex gap-1 flex-wrap">
                          {c._gaps.map(g=>(
                            <span key={g.id} className={`text-xs px-1.5 py-0.5 rounded font-medium ${g.color}`}>{g.label}</span>
                          ))}
                        </div>
                      : <span className="text-xs text-green-600 dark:text-green-400 font-semibold">✅ All covered</span>
                    }
                  </td>

                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {/* Modals */}
      <Modal open={modal==='add'}  onClose={() => setModal(null)} title="Add New Client" size="lg">
        <ClientForm onSave={onAdd} onCancel={() => setModal(null)} />
      </Modal>
      <Modal open={modal==='edit'} onClose={() => setModal(null)} title="Edit Client" size="lg">
        {selected && <ClientForm initial={selected} onSave={onEdit} onCancel={() => setModal(null)} />}
      </Modal>

      {/* View client modal */}
      <Modal open={modal==='view'} onClose={() => setModal(null)} title={selected?.name||'Client Details'} size="lg">
        {selected && (
          <div className="space-y-4">
            {selected._gaps?.length > 0 && (
              <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-3">
                <p className="text-xs font-semibold text-orange-700 dark:text-orange-300 mb-2">🎯 Coverage Gaps</p>
                <div className="flex gap-2 flex-wrap">
                  {selected._gaps.map(g => <span key={g.id} className={`text-xs px-2 py-1 rounded-full font-medium ${g.color}`}>{g.label}</span>)}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['Mobile',   selected.mobile || <span className="text-orange-500 text-xs">⚠️ Not set — add for WhatsApp</span>],
                ['Email',    selected.email],
                ['PAN',      selected.pan],
                ['Aadhar',   selected.aadhar],
                ['Date of Birth', fmtDate(selected.dob)],
                ['Gender',   selected.gender],
                ['Occupation', selected.occupation],
                ['Income',   selected.income ? `₹${parseInt(selected.income).toLocaleString('en-IN')}` : null],
                ['KYC Status', selected.kycStatus],
                ['City',     selected.city],
                ['State',    selected.state],
                ['Family',   selected.familyName || selected.familyId],
                ['Family Role', selected.familyRole],
                ['Address',  selected.address],
                ['Notes',    selected.notes],
              ].filter(([,v]) => v).map(([k,v]) => (
                <div key={k}>
                  <p className="text-xs text-gray-400 dark:text-gray-500 font-medium">{k}</p>
                  <p className="text-gray-800 dark:text-gray-200 font-medium">{v}</p>
                </div>
              ))}
            </div>
            {(() => {
              const cp = policies.filter(p => p.clientId === selected.id)
              return cp.length > 0 ? (
                <div>
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">📋 Policies ({cp.length})</p>
                  {/* Side-scrollable policy mini-table */}
                  <div className="overflow-x-auto">
                    <div className="min-w-[500px] space-y-1">
                      {cp.map(p => (
                        <div key={p.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2 text-xs">
                          <span className="font-mono font-semibold text-gray-700 dark:text-gray-300">{p.policyNumber}</span>
                          <span className="text-gray-500 dark:text-gray-400">{p.policyType} · {p.insurer}</span>
                          <span className={!['Renewed-Out','Cancelled','Matured'].includes(p.status||'')?'text-green-600 dark:text-green-400 font-semibold':'text-gray-400'}>{p.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null
            })()}
            <DocumentManager clientId={selected.id} />
          </div>
        )}
      </Modal>

      {/* CliMer modal */}
      <Modal open={modal==='climer'} onClose={() => setModal(null)} title="🔀 CliMer — Client Merger" size="lg">
        <CliMerModal
          clients={clients}
          onClose={() => setModal(null)}
          onMerged={() => {}}
        />
      </Modal>

      <ConfirmDialog open={delOpen} onClose={() => setDelOpen(false)} onConfirm={onDelete}
                     title="Delete Client?"
                     message={`Permanently delete "${selected?.name}" and all linked policies?`} danger />

      {/* Birthday greeting modal */}
      <Modal open={modal==='greeting'} onClose={() => setModal(null)}
             title={`🎂 Birthday Greeting — ${greetingClient?.name}`} size="lg">
        <div className="space-y-4">
          <div className="bg-pink-50 dark:bg-pink-900/20 border border-pink-200 dark:border-pink-800 rounded-xl p-3">
            <p className="text-xs text-pink-700 dark:text-pink-300 font-semibold">
              🎈 {greetingClient?._bday === 0 ? "Today is their birthday!" : `Birthday in ${greetingClient?._bday} day(s)`}
            </p>
          </div>
          <div>
            <label className="form-label">WhatsApp Message</label>
            <textarea value={greetingMsg} onChange={e => setGreetingMsg(e.target.value)}
                      className="form-input font-mono text-xs" rows={14} />
          </div>
          <div className="flex gap-3">
            <button onClick={sendBirthdayWA} className="btn-whatsapp text-sm px-4 py-2">📱 Send via WhatsApp</button>
            <button onClick={() => { navigator.clipboard.writeText(greetingMsg); toast.success('Copied!') }}
                    className="btn-secondary">📋 Copy</button>
            <button onClick={() => setModal(null)} className="btn-secondary">Close</button>
          </div>
        </div>
      </Modal>

      {/* Bulk delete confirm */}
      <ConfirmDialog
        open={bulkDelOpen}
        onClose={() => setBulkDelOpen(false)}
        onConfirm={onBulkDelete}
        title={`Delete ${selectedIds.size} Client${selectedIds.size>1?'s':''}?`}
        message={`Permanently delete ${selectedIds.size} client${selectedIds.size>1?'s':''} and ALL their linked policies. Cannot be undone.`}
        danger
      />
    </div>
  )
}
