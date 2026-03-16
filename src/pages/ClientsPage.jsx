// src/pages/ClientsPage.jsx
import { useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClients }  from '../hooks/useClients'
import { usePolicies } from '../hooks/usePolicies'
import { addClient, cascadeUpdateClient, deleteClient, bulkDeleteClients, getDocMeta } from '../firebase/firestore'
import { uploadClientDocument, deleteClientDocument } from '../firebase/storage'
import { computeCoverageGaps } from '../utils/policySchemas'
import Modal        from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import SearchBar    from '../components/ui/SearchBar'
import { fmtDate, fmtDateTime, fmtCurrency } from '../utils/dateUtils'
import { exportToCSV, exportToExcel, exportToPDF, CLIENT_COLS } from '../utils/exportUtils'
import toast from 'react-hot-toast'
import { differenceInDays, parseISO } from 'date-fns'

const EMPTY = {
  name:'', mobile:'', email:'', pan:'', aadhar:'',
  dob:'', gender:'', address:'', city:'', state:'',
  occupation:'', employment:'', income:'',
  qualification:'', designation:'',
  kycStatus:'Pending', notes:''
}
const KYC_OPTIONS = ['Pending','In Progress','Complete']
const GENDERS     = ['Male','Female','Other']

function birthdayDays(dob) {
  if (!dob) return null
  try {
    const d   = parseISO(dob)
    const now = new Date()
    const bday = new Date(now.getFullYear(), d.getMonth(), d.getDate())
    const diff = differenceInDays(bday, now)
    return diff >= 0 && diff <= 30 ? diff : null
  } catch { return null }
}

// ── Client Form ───────────────────────────────────────────────
function ClientForm({ initial, onSave, onCancel }) {
  const [form, setForm]   = useState(initial || EMPTY)
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setForm(p=>({...p,[k]:v}))

  const inp = (k,lbl,type='text',opts={}) => (
    <div><label className="form-label">{lbl}</label>
      <input type={type} value={form[k]||''} onChange={e=>set(k,e.target.value)} className="form-input" {...opts} /></div>
  )

  const onSubmit = async e => {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    try { await onSave(form) }
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
function DocumentManager({ clientId }) {
  const [docs,      setDocs]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [progress,  setProgress]  = useState(0)
  const fileRef = useRef()

  const load = async () => {
    setLoading(true)
    const data = await getDocMeta(clientId)
    setDocs(data)
    setLoading(false)
  }
  useState(() => { load() }, [])

  const onFile = async e => {
    const file = e.target.files?.[0]; if (!file) return
    if (file.size > 10*1024*1024) { toast.error('File must be < 10 MB'); return }
    setUploading(true); setProgress(0)
    try { await uploadClientDocument(clientId, file, setProgress); toast.success(`${file.name} uploaded`); await load() }
    catch(err) { toast.error(err.message) }
    finally { setUploading(false); fileRef.current.value='' }
  }
  const onDelete = async doc => {
    if (!confirm(`Delete "${doc.name}"?`)) return
    try { await deleteClientDocument(clientId, doc.id); toast.success('File deleted'); setDocs(p=>p.filter(d=>d.id!==doc.id)) }
    catch(err) { toast.error(err.message) }
  }

  if (loading) return <p className="text-gray-400 text-sm">Loading documents…</p>
  return (
    <div className="space-y-3 mt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">📎 Documents</p>
        <button onClick={()=>fileRef.current.click()} disabled={uploading} className="btn-secondary text-xs">
          {uploading?`⏳ ${progress}%`:'+ Upload PDF/Image'}
        </button>
        <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={onFile} />
      </div>
      {docs.length===0
        ? <p className="text-xs text-gray-400">No documents uploaded yet.</p>
        : <ul className="divide-y divide-gray-100 border rounded-lg overflow-hidden">
            {docs.map(d=>(
              <li key={d.id} className="flex items-center justify-between px-3 py-2 bg-white hover:bg-gray-50">
                <a href={d.url} target="_blank" rel="noreferrer"
                   className="text-sm text-blue-600 hover:underline truncate max-w-[70%]">📄 {d.name}</a>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{Math.round(d.size/1024)} KB</span>
                  <button onClick={()=>onDelete(d)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                </div>
              </li>
            ))}
          </ul>
      }
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function ClientsPage() {
  const { clients, loading } = useClients()
  const { policies }         = usePolicies()
  const navigate = useNavigate()
  const [search,    setSearch]    = useState('')
  const [kycFilter, setKycFilter] = useState('All')
  const [modal,     setModal]     = useState(null)
  const [selected,  setSelected]  = useState(null)
  const [delOpen,   setDelOpen]   = useState(false)
  const [showGapsOnly, setShowGapsOnly] = useState(false)
  // Bulk select state
  const [selectedIds,  setSelectedIds]  = useState(new Set())
  const [bulkDelOpen,  setBulkDelOpen]  = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  // Birthday greeting
  const [greetingClient, setGreetingClient] = useState(null)
  const [greetingMsg,    setGreetingMsg]    = useState('')

  // Pre-compute per-client data
  const clientData = useMemo(() =>
    clients.map(c => {
      const cp   = policies.filter(p => p.clientId === c.id)
      const gaps = computeCoverageGaps(cp)
      const bday = birthdayDays(c.dob)
      const activePolicies = cp.filter(p=>p.status==='Active').length
      return { ...c, _gaps: gaps, _bday: bday, _policyCount: activePolicies }
    }),
    [clients, policies]
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return clientData.filter(c => {
      const mQ = !q || c.name?.toLowerCase().includes(q) || c.mobile?.includes(q) || c.pan?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)
      const mKyc = kycFilter==='All' || c.kycStatus===kycFilter
      const mGaps = !showGapsOnly || c._gaps.length > 0
      return mQ && mKyc && mGaps
    })
  }, [clientData, search, kycFilter, showGapsOnly])

  const kycBadge = s => s==='Complete'?'badge-green':s==='In Progress'?'badge-yellow':'badge-red'

  const onAdd    = async form => { await addClient(form);                       toast.success('Client added!');   setModal(null) }
  const onEdit   = async form => { await cascadeUpdateClient(selected.id,form); toast.success('Client updated — changes reflected everywhere!'); setModal(null) }
  const onDelete = async ()   => { await deleteClient(selected.id);             toast.success('Client deleted') }

  // ── Birthday greeting generator ──────────────────────────
  const openGreeting = (client) => {
    const policies_count = policies.filter(p => p.clientId === client.id && p.status === 'Active').length
    const msg = `🎂 Dear ${client.name},\n\nWishing you a very Happy Birthday! 🎉\n\nMay this special day bring you joy, good health, and prosperity.\n\nThank you for trusting *Gohil Investments* with your financial and insurance needs. We are committed to protecting what matters most to you.\n\nYou currently have ${policies_count} active polic${policies_count===1?'y':'ies'} with us. If you need any assistance or wish to review your coverage, we are always here to help.\n\nOnce again, Happy Birthday! 🎈\n\n*Harshdip Gohil*\n*Gohil Investments*\nWealth Management & Insurance Advisory\n📍 Bhavnagar, Gujarat`
    setGreetingClient(client)
    setGreetingMsg(msg)
    setModal('greeting')
  }

  const sendBirthdayWA = () => {
    const mobile = greetingClient?.mobile?.replace(/\D/g,'')
    if (!mobile) { toast.error('No mobile number'); return }
    window.open(`https://wa.me/91${mobile}?text=${encodeURIComponent(greetingMsg)}`, '_blank')
  }

  // Bulk select helpers
  const allFilteredIds = filtered.map(c => c.id)
  const allSelected    = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedIds.has(id))
  const someSelected   = allFilteredIds.some(id => selectedIds.has(id))

  const toggleOne = id => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(prev => { const n=new Set(prev); allFilteredIds.forEach(id=>n.delete(id)); return n })
    } else {
      setSelectedIds(prev => { const n=new Set(prev); allFilteredIds.forEach(id=>n.add(id)); return n })
    }
  }
  const clearSelection = () => setSelectedIds(new Set())

  const onBulkDelete = async () => {
    setBulkDeleting(true)
    try {
      await bulkDeleteClients([...selectedIds])
      toast.success(`✅ ${selectedIds.size} client(s) deleted`)
      clearSelection()
      setBulkDelOpen(false)
    } catch(err) { toast.error(err.message) }
    finally { setBulkDeleting(false) }
  }

  if (loading) return (
    <div className="p-8 text-gray-400 flex items-center gap-2">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      Loading clients…
    </div>
  )

  const gapCount = clientData.filter(c=>c._gaps.length>0).length

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clients</h1>
          <p className="text-sm text-gray-500">{clients.length} total · {gapCount} with coverage gaps</p>
        </div>
        <button className="btn-primary" onClick={()=>{setSelected(null);setModal('add')}}>+ Add Client</button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by name, mobile, PAN…" />
        <div className="flex gap-2 flex-wrap">
          {['All',...KYC_OPTIONS].map(o=>(
            <button key={o} onClick={()=>setKycFilter(o)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                kycFilter===o?'bg-blue-600 text-white':'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}>{o}</button>
          ))}
          <button onClick={()=>setShowGapsOnly(p=>!p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              showGapsOnly?'bg-orange-500 text-white border-orange-500':'bg-white text-orange-600 border-orange-300 hover:bg-orange-50'
            }`}>
            🎯 Gaps Only {gapCount>0&&`(${gapCount})`}
          </button>
        </div>
        <div className="flex gap-2 ml-auto flex-wrap">
          <button onClick={()=>exportToCSV(filtered,CLIENT_COLS,'clients')} className="btn-secondary text-xs">⬇ CSV</button>
          <button onClick={()=>exportToExcel(filtered,CLIENT_COLS,'Clients','clients')} className="btn-secondary text-xs">⬇ Excel</button>
          <button onClick={()=>exportToPDF(filtered,CLIENT_COLS,'Client List','clients')} className="btn-secondary text-xs">⬇ PDF</button>
        </div>
      </div>

      {/* Bulk delete action bar — appears when any row is selected */}
      {someSelected && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <span className="text-sm font-semibold text-red-700">
            {selectedIds.size} client{selectedIds.size > 1 ? 's' : ''} selected
          </span>
          <button onClick={() => setBulkDelOpen(true)}
                  className="px-4 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700">
            🗑️ Delete Selected
          </button>
          <button onClick={clearSelection}
                  className="px-3 py-1.5 bg-white border border-red-200 text-red-600 text-xs font-semibold rounded-lg hover:bg-red-50">
            ✕ Clear Selection
          </button>
          <span className="text-xs text-red-500 ml-auto">
            ⚠️ This will also delete all linked policies
          </span>
        </div>
      )}

      {/* Table */}
      <div className="table-container">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className="table-header w-10">
                <input type="checkbox"
                       checked={allSelected}
                       onChange={toggleAll}
                       className="w-4 h-4 cursor-pointer"
                       title={allSelected ? 'Deselect all' : 'Select all visible'} />
              </th>
              {['Name','Mobile','Email','PAN','Policies','KYC','Birthday','Coverage Gaps','Actions'].map(h=>(
                <th key={h} className="table-header">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white">
            {filtered.length===0
              ? <tr><td colSpan={9} className="text-center text-gray-400 py-10">No clients found</td></tr>
              : filtered.map(c=>(
                <tr key={c.id} className={`table-row ${selectedIds.has(c.id)?'bg-blue-50':c._bday!==null?'bg-pink-50/40':''}`}>
                  <td className="table-cell">
                    <input type="checkbox"
                           checked={selectedIds.has(c.id)}
                           onChange={()=>toggleOne(c.id)}
                           className="w-4 h-4 cursor-pointer" />
                  </td>
                  <td className="table-cell">
                    <span className="font-semibold text-gray-900 cursor-pointer hover:text-blue-600"
                          onClick={()=>{setSelected(c);setModal('view')}}>{c.name}</span>
                  </td>
                  <td className="table-cell">{c.mobile||'—'}</td>
                  <td className="table-cell">{c.email||'—'}</td>
                  <td className="table-cell font-mono text-xs">{c.pan||'—'}</td>
                  <td className="table-cell text-center">
                    <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                      {c._policyCount}
                    </span>
                  </td>
                  <td className="table-cell"><span className={kycBadge(c.kycStatus)}>{c.kycStatus||'Pending'}</span></td>
                  <td className="table-cell text-center">
                    {c._bday !== null
                      ? <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${c._bday===0?'bg-pink-500 text-white':'bg-pink-100 text-pink-700'}`}>
                          {c._bday===0?'🎂 Today!':c._bday===0?'🎂':'🎂 '+c._bday+'d'}
                        </span>
                      : <span className="text-xs text-gray-300">—</span>
                    }
                  </td>
                  <td className="table-cell">
                    {c._gaps.length>0
                      ? <div className="flex gap-1 flex-wrap">
                          {c._gaps.map(g=>(
                            <span key={g.id} className={`text-xs px-1.5 py-0.5 rounded font-medium ${g.color}`}>{g.label}</span>
                          ))}
                        </div>
                      : <span className="text-xs text-green-600 font-semibold">✅ All covered</span>
                    }
                  </td>
                  <td className="table-cell">
                    <div className="flex gap-1">
                      <button onClick={()=>{setSelected(c);setModal('edit')}} className="px-2 py-1 text-xs bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-100">Edit</button>
                      {c._bday !== null && c._bday <= 7 && (
                        <button onClick={()=>openGreeting(c)} className="px-2 py-1 text-xs bg-pink-50 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300 rounded hover:bg-pink-100" title="Send Birthday Greeting">🎂</button>
                      )}
                      <button onClick={()=>{setSelected(c);setDelOpen(true)}} className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded hover:bg-red-100">Del</button>
                    </div>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      {/* Modals */}
      <Modal open={modal==='add'} onClose={()=>setModal(null)} title="Add New Client" size="lg">
        <ClientForm onSave={onAdd} onCancel={()=>setModal(null)} />
      </Modal>
      <Modal open={modal==='edit'} onClose={()=>setModal(null)} title="Edit Client" size="lg">
        {selected&&<ClientForm initial={selected} onSave={onEdit} onCancel={()=>setModal(null)} />}
      </Modal>
      <Modal open={modal==='view'} onClose={()=>setModal(null)} title={selected?.name||'Client Details'} size="lg">
        {selected&&(
          <div className="space-y-4">
            {/* Coverage gaps */}
            {selected._gaps?.length>0&&(
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-orange-700 mb-2">🎯 Coverage Gaps — Cross-sell Opportunities</p>
                <div className="flex gap-2 flex-wrap">
                  {selected._gaps.map(g=><span key={g.id} className={`text-xs px-2 py-1 rounded-full font-medium ${g.color}`}>{g.label}</span>)}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[['Mobile',selected.mobile],['Email',selected.email],['PAN',selected.pan],['Aadhar',selected.aadhar],
                ['Date of Birth',fmtDate(selected.dob)],['Gender',selected.gender],['Occupation',selected.occupation],
                ['Income',selected.income?`₹${parseInt(selected.income).toLocaleString('en-IN')}`:null],
                ['KYC Status',selected.kycStatus],['City',selected.city],['State',selected.state],['Address',selected.address],['Notes',selected.notes],
              ].filter(([,v])=>v).map(([k,v])=>(
                <div key={k}><p className="text-xs text-gray-400 font-medium">{k}</p><p className="text-gray-800 font-medium">{v}</p></div>
              ))}
            </div>
            {/* Linked policies */}
            {(() => {
              const cp = policies.filter(p=>p.clientId===selected.id)
              return cp.length>0?(
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">📋 Policies ({cp.length})</p>
                  <div className="space-y-1">
                    {cp.map(p=>(
                      <div key={p.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-xs">
                        <span className="font-mono font-semibold">{p.policyNumber}</span>
                        <span className="text-gray-500">{p.policyType} · {p.insurer}</span>
                        <span className={p.status==='Active'?'text-green-600 font-semibold':'text-gray-400'}>{p.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ):null
            })()}
            <DocumentManager clientId={selected.id} />
          </div>
        )}
      </Modal>
      <ConfirmDialog open={delOpen} onClose={()=>setDelOpen(false)} onConfirm={onDelete}
                     title="Delete Client?"
                     message={`This will permanently delete "${selected?.name}" and all linked policies.`} danger />

      {/* Birthday greeting modal */}
      <Modal open={modal==='greeting'} onClose={()=>setModal(null)} title={`🎂 Birthday Greeting — ${greetingClient?.name}`} size="lg">
        <div className="space-y-4">
          <div className="bg-pink-50 dark:bg-pink-900/20 border border-pink-200 dark:border-pink-800 rounded-xl p-3">
            <p className="text-xs text-pink-700 dark:text-pink-300 font-semibold">
              🎈 {greetingClient?._bday === 0 ? "Today is their birthday!" : `Birthday in ${greetingClient?._bday} day(s)`}
            </p>
          </div>
          <div>
            <label className="form-label">WhatsApp Message</label>
            <textarea
              value={greetingMsg}
              onChange={e => setGreetingMsg(e.target.value)}
              className="form-input font-mono text-xs"
              rows={14}
            />
          </div>
          <div className="flex gap-3">
            <button onClick={sendBirthdayWA} className="btn-whatsapp text-sm px-4 py-2">
              📱 Send via WhatsApp
            </button>
            <button onClick={() => { navigator.clipboard.writeText(greetingMsg); toast.success('Copied!') }}
                    className="btn-secondary">
              📋 Copy Message
            </button>
            <button onClick={() => setModal(null)} className="btn-secondary">Close</button>
          </div>
        </div>
      </Modal>

      {/* Bulk delete confirm */}
      <ConfirmDialog
        open={bulkDelOpen}
        onClose={()=>setBulkDelOpen(false)}
        onConfirm={onBulkDelete}
        title={`Delete ${selectedIds.size} Client${selectedIds.size>1?'s':''}?`}
        message={`This will permanently delete ${selectedIds.size} client${selectedIds.size>1?'s':''} and ALL their linked policies. This cannot be undone.`}
        danger
      />
    </div>
  )
}
