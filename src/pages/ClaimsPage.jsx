// src/pages/ClaimsPage.jsx
import { useState, useMemo, useEffect } from 'react'
import { useClients }  from '../hooks/useClients'
import { usePolicies } from '../hooks/usePolicies'
import { useAuth }     from '../hooks/useAuth'
import {
  addClaim, updateClaim, deleteClaim, subscribeClaims, CLAIM_STATUSES
} from '../firebase/firestore'
import Modal         from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import SearchBar     from '../components/ui/SearchBar'
import { exportToCSV, exportToExcel, exportToPDF } from '../utils/exportUtils'
import { fmtDate, fmtCurrency } from '../utils/dateUtils'
import { openWhatsAppLink } from '../services/whatsappService'
import toast from 'react-hot-toast'

const CLAIM_TYPES  = ['Cashless','Reimbursement','Death','Maturity','Motor Accident','Motor Theft','Other']
const STATUS_COLORS = {
  'Intimated':            'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  'Documents Submitted':  'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  'Under Review':         'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200',
  'Approved':             'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  'Settled':              'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  'Rejected':             'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
}
const STATUS_ICONS = {
  'Intimated':'📋','Documents Submitted':'📂','Under Review':'🔍',
  'Approved':'✅','Settled':'💰','Rejected':'❌'
}
const CLAIM_COLS = [
  { header:'Claim No',     accessor: r => r.claimNumber  },
  { header:'Client',       accessor: r => r.clientName   },
  { header:'Policy No',    accessor: r => r.policyNumber },
  { header:'Type',         accessor: r => r.claimType    },
  { header:'Insurer',      accessor: r => r.insurer      },
  { header:'Intimation',   accessor: r => fmtDate(r.intimationDate) },
  { header:'Claimed ₹',    accessor: r => r.claimedAmount },
  { header:'Approved ₹',   accessor: r => r.approvedAmount },
  { header:'Status',       accessor: r => r.status       },
  { header:'Hospital',     accessor: r => r.hospitalName },
]

// ── Claim form ────────────────────────────────────────────────
function ClaimForm({ initial, clients, policies, onSave, onCancel }) {
  const blank = {
    claimNumber:'', clientId:'', clientName:'', policyId:'', policyNumber:'',
    insurer:'', claimType:'Cashless', intimationDate:'', claimedAmount:'',
    approvedAmount:'', status:'Intimated', hospitalName:'', remarks:'',
    docs: { discharge: false, bills: false, idProof: false, form: false, fir: false, other: false }
  }
  const [form, setForm] = useState({ ...blank, ...(initial || {}) })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const setDoc = (k, v) => setForm(p => ({ ...p, docs: { ...p.docs, [k]: v } }))

  // Only match by clientId — avoids false positives when clientName is blank
  const clientPolicies = useMemo(() =>
    form.clientId ? policies.filter(p => p.clientId === form.clientId) : [],
    [policies, form.clientId]
  )

  const onClientChange = (clientId) => {
    const c = clients.find(x => x.id === clientId)
    setForm(p => ({
      ...p,
      clientId,
      clientName:   c?.name || '',
      policyId:     '',
      policyNumber: '',
      insurer:      '',
    }))
  }

  const onPolicyChange = (policyId) => {
    const p = policies.find(x => x.id === policyId)
    setForm(prev => ({
      ...prev,
      policyId,
      policyNumber: p?.policyNumber || '',
      insurer:      p?.insurer      || '',
    }))
  }

  const inp = (k, label, type='text', extra={}) => (
    <div>
      <label className="form-label">{label}</label>
      <input type={type} value={form[k]||''} onChange={e=>set(k,e.target.value)}
             className="form-input" {...extra} />
    </div>
  )

  const submit = async () => {
    if (!form.clientName) { toast.error('Client required'); return }
    if (!form.policyNumber && !form.insurer) { toast.error('Policy or Insurer required'); return }
    if (form.claimedAmount && Number(form.claimedAmount) < 0) { toast.error('Claimed amount cannot be negative'); return }
    if (form.approvedAmount && Number(form.approvedAmount) < 0) { toast.error('Approved amount cannot be negative'); return }
    if (form.claimedAmount && form.approvedAmount && Number(form.approvedAmount) > Number(form.claimedAmount)) {
      toast.error('Approved amount cannot be greater than claimed amount'); return
    }
    setSaving(true)
    try { await onSave(form) } catch(err) { toast.error(err.message || 'Could not save claim. Please check the details.') } finally { setSaving(false) }
  }

  return (
    <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
      {/* Basic info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {inp('claimNumber', 'Claim Number', 'text', { placeholder: 'CLM-2024-001' })}
        <div>
          <label className="form-label">Client *</label>
          <select value={form.clientId} onChange={e=>onClientChange(e.target.value)} className="form-select">
            <option value="">— Select Client —</option>
            {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Policy</label>
          <select value={form.policyId} onChange={e=>onPolicyChange(e.target.value)} className="form-select">
            <option value="">— Select Policy —</option>
            {clientPolicies.map(p=><option key={p.id} value={p.id}>{p.policyNumber} — {p.insurer}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Claim Type</label>
          <select value={form.claimType} onChange={e=>set('claimType',e.target.value)} className="form-select">
            {CLAIM_TYPES.map(t=><option key={t}>{t}</option>)}
          </select>
        </div>
        {inp('insurer','Insurer')}
        {inp('intimationDate','Date of Intimation','date')}
        {inp('claimedAmount','Claimed Amount (₹)','number',{placeholder:'0'})}
        {inp('approvedAmount','Approved Amount (₹)','number',{placeholder:'0'})}
        <div>
          <label className="form-label">Status</label>
          <select value={form.status} onChange={e=>set('status',e.target.value)} className="form-select">
            {CLAIM_STATUSES.map(s=><option key={s}>{s}</option>)}
          </select>
        </div>
        {inp('hospitalName','Hospital / Workshop Name')}
      </div>

      {/* Documents checklist */}
      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">📎 Documents Received</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            ['discharge','Discharge Summary'],['bills','Medical Bills'],
            ['idProof','ID Proof'],['form','Claim Form'],
            ['fir','FIR (if applicable)'],['other','Other Documents']
          ].map(([k,label])=>(
            <label key={k} className="flex items-center gap-2 text-sm cursor-pointer text-gray-600 dark:text-gray-300">
              <input type="checkbox" checked={!!form.docs?.[k]} onChange={e=>setDoc(k,e.target.checked)} className="w-4 h-4" />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Remarks */}
      <div>
        <label className="form-label">Remarks / Notes</label>
        <textarea value={form.remarks||''} onChange={e=>set('remarks',e.target.value)}
                  className="form-input" rows={3} placeholder="Any notes about the claim…" />
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={submit} disabled={saving} className="btn-primary">
          {saving ? '⏳ Saving…' : initial ? '💾 Save Changes' : '✅ Add Claim'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  )
}

// ── Pipeline view ─────────────────────────────────────────────
function PipelineView({ claims, onEdit, onStatusChange }) {
  // Precompute once — avoids 6 separate filter passes per render
  const grouped = useMemo(() => {
    const map = {}
    CLAIM_STATUSES.forEach(s => { map[s] = [] })
    claims.forEach(c => { if (map[c.status]) map[c.status].push(c) })
    return map
  }, [claims])
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {CLAIM_STATUSES.map(status => {
        const cols = grouped[status] || []
        return (
          <div key={status} className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-3 min-h-[200px]">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-gray-600 dark:text-gray-400 leading-tight">
                {STATUS_ICONS[status]} {status}
              </p>
              <span className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full px-2 py-0.5 font-semibold">
                {cols.length}
              </span>
            </div>
            <div className="space-y-2">
              {cols.map(c => (
                <div key={c.id} className="pipeline-card" onClick={() => onEdit(c)}>
                  <p className="text-xs font-bold text-gray-800 dark:text-gray-200 truncate">{c.clientName}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{c.policyNumber || c.insurer}</p>
                  <p className="text-xs text-blue-600 dark:text-blue-400 font-medium mt-1">{c.claimType}</p>
                  {c.claimedAmount && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">₹{Number(c.claimedAmount).toLocaleString('en-IN')}</p>
                  )}
                  {/* Quick status advance */}
                  {status !== 'Settled' && status !== 'Rejected' && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {CLAIM_STATUSES.indexOf(status) < CLAIM_STATUSES.length - 2 && (
                        <button
                          onClick={e => { e.stopPropagation(); onStatusChange(c.id, CLAIM_STATUSES[CLAIM_STATUSES.indexOf(status)+1]) }}
                          className="text-xs px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 rounded hover:bg-blue-100">
                          → Next
                        </button>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); onStatusChange(c.id,'Rejected') }}
                        className="text-xs px-1.5 py-0.5 bg-red-50 dark:bg-red-900/40 text-red-500 dark:text-red-400 rounded hover:bg-red-100">
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────
export default function ClaimsPage() {
  const { clients }  = useClients()
  const { policies } = usePolicies()
  const { isAdmin }  = useAuth()
  const [claims,  setClaims]  = useState([])
  const [loading, setLoading] = useState(true)
  const [view,    setView]    = useState('table')   // 'table' | 'pipeline'
  const [search,  setSearch]  = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [modal,    setModal]   = useState(null)
  const [selected, setSelected] = useState(null)
  const [delOpen,  setDelOpen]  = useState(false)

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeClaims(
      data => { setClaims(data); setLoading(false) },
      err => {
        toast.error('Could not load claims: ' + (err.message || 'Unknown error'))
        setLoading(false)
      }
    )
    return () => unsub()
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return claims.filter(c => {
      const mQ = !q || c.clientName?.toLowerCase().includes(q) ||
                       c.policyNumber?.toLowerCase().includes(q) ||
                       c.claimNumber?.toLowerCase().includes(q) ||
                       c.insurer?.toLowerCase().includes(q)
      const mS = statusFilter === 'All' || c.status === statusFilter
      return mQ && mS
    })
  }, [claims, search, statusFilter])

  // Stats
  const stats = useMemo(() => ({
    total:     claims.length,
    active:    claims.filter(c => !['Settled','Rejected'].includes(c.status)).length,
    settled:   claims.filter(c => c.status === 'Settled').length,
    rejected:  claims.filter(c => c.status === 'Rejected').length,
    totalClaimed:  claims.reduce((s,c) => s + (Number(c.claimedAmount)||0), 0),
    totalApproved: claims.reduce((s,c) => s + (Number(c.approvedAmount)||0), 0),
  }), [claims])

  const onAdd    = async form => {
    try { await addClaim(form);                toast.success('Claim added!');   setModal(null) }
    catch(err) { toast.error('Failed to add claim: ' + err.message) }
  }
  const onEdit   = async form => {
    try { await updateClaim(selected.id, form); toast.success('Claim updated!'); setModal(null) }
    catch(err) { toast.error('Failed to update claim: ' + err.message) }
  }
  const onDelete = async () => {
    try { await deleteClaim(selected.id); toast.success('Claim deleted'); setDelOpen(false) }
    catch(err) { toast.error('Failed to delete: ' + err.message) }
  }
  const onStatusChange = async (id, status) => {
    try {
      await updateClaim(id, { status })
      toast.success(`Status changed to ${status}`)
      return
    toast.success(`Status → ${status}`)
    } catch (err) {
      toast.error(err.message || 'Could not update claim status.')
    }
  }

  // WhatsApp for claim update
  const openWhatsApp = (claim) => {
    // Try clientId first, then name fallback for imported claims
    let client = clients.find(c => c.id === claim.clientId)
    if (!client?.mobile && claim.clientName) {
      client = clients.find(c => c.name.toLowerCase().trim() === (claim.clientName||'').toLowerCase().trim())
    }
    const mobile = client?.mobile?.replace(/\D/g,'')
    if (!mobile) {
      toast.error('No mobile for ' + (claim.clientName || 'this client') + ' - add it in Clients page')
      return
    }
    const safeMsg =
      `Dear ${claim.clientName || 'Client'},\n\n` +
      `Update on your insurance claim:\n\n` +
      `Claim No: ${claim.claimNumber || 'N/A'}\n` +
      `Insurer: ${claim.insurer || 'N/A'}\n` +
      `Status: ${claim.status || 'N/A'}\n` +
      `${claim.approvedAmount ? `Approved Amount: ${fmtCurrency(claim.approvedAmount)}\n` : ''}\n` +
      `For any queries, please contact us.\n\n` +
      `Gohil Investments\n` +
      `Wealth Management & Insurance Advisory\n` +
      `Harshdipsinh Gohil - 7698997894\n` +
      `Pradipsinh Gohil - 9426204547\n` +
      `Bhavnagar, Gujarat`
    try {
      openWhatsAppLink({ mobile: client?.mobile, message: safeMsg })
    } catch (err) {
      toast.error(err.message || 'Could not open WhatsApp.')
    }
    return
    if (!mobile) { toast.error('No mobile for ' + (claim.clientName||'this client') + ' — add it in Clients page'); return }
    const msg = encodeURIComponent(
      `Dear ${claim.clientName},\n\nUpdate on your insurance claim:\n\n📋 Claim No: ${claim.claimNumber || 'N/A'}\n🏢 Insurer: ${claim.insurer}\n📊 Status: *${claim.status}*\n${claim.approvedAmount ? `💰 Approved Amount: ₹${Number(claim.approvedAmount).toLocaleString('en-IN')}` : ''}\n\nFor any queries, please contact us.\n\n*Gohil Investments*
Wealth Management & Insurance Advisory
📞 *Harshdipsinh Gohil* — 7698997894
📞 Pradipsinh Gohil — 9426204547
📍 Bhavnagar, Gujarat`
    )
    window.open(`https://wa.me/91${mobile}?text=${msg}`, '_blank')
  }

  if (loading) return (
    <div className="p-8 text-gray-400 dark:text-gray-500 flex items-center gap-2">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />Loading claims…
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Claims</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{claims.length} total claims</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={()=>setView(v=>v==='table'?'pipeline':'table')}
                  className="btn-secondary">
            {view==='table' ? '🔀 Pipeline View' : '📋 Table View'}
          </button>
          <button className="btn-primary" onClick={()=>{setSelected(null);setModal('add')}}>+ Add Claim</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label:'Total',    val: stats.total,    color:'blue'    },
          { label:'Active',   val: stats.active,   color:'yellow'  },
          { label:'Settled',  val: stats.settled,  color:'green'   },
          { label:'Rejected', val: stats.rejected, color:'red'     },
          { label:'Claimed',  val: `₹${(stats.totalClaimed/1000).toFixed(0)}K`,  color:'purple' },
          { label:'Approved', val: `₹${(stats.totalApproved/1000).toFixed(0)}K`, color:'emerald'},
        ].map(({ label, val, color }) => (
          <div key={label} className="card-sm text-center">
            <p className={`text-2xl font-bold text-${color}-600 dark:text-${color}-400`}>{val}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
        <SearchBar value={search} onChange={setSearch} placeholder="Client, policy no, insurer…" />
        <div className="flex gap-1 flex-wrap">
          {['All', ...CLAIM_STATUSES].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
                      ${statusFilter===s
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
              {STATUS_ICONS[s] || ''} {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2 ml-auto flex-wrap">
          <button onClick={()=>exportToCSV(filtered,CLAIM_COLS,'claims')} className="btn-secondary text-xs">⬇ CSV</button>
          <button onClick={()=>exportToExcel(filtered,CLAIM_COLS,'Claims','claims')} className="btn-secondary text-xs">⬇ Excel</button>
          <button onClick={async()=>await exportToPDF(filtered,CLAIM_COLS,'Claims Register','claims')} className="btn-secondary text-xs">⬇ PDF</button>
        </div>
      </div>

      {/* Pipeline or Table */}
      {view === 'pipeline' ? (
        <PipelineView
          claims={filtered}
          onEdit={c => { setSelected(c); setModal('edit') }}
          onStatusChange={onStatusChange}
        />
      ) : (
        <div className="table-container">
          <table className="min-w-full">
            <thead><tr>
              {['Claim No','Client','Policy No','Type','Insurer','Intimation','Claimed ₹','Approved ₹','Status','Hospital','Docs'].map(h=>(
                <th key={h} className="table-header">{h}</th>
              ))}
            </tr></thead>
            <tbody className="bg-white dark:bg-gray-800">
              {filtered.length === 0
                ? <tr><td colSpan={11} className="text-center text-gray-400 dark:text-gray-500 py-10">No claims found</td></tr>
                : filtered.map(c => {
                  const docsCount = Object.values(c.docs||{}).filter(Boolean).length
                  const docsTotal = 6
                  return (
                    <tr key={c.id} className="table-row">
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold">{c.claimNumber || '?'}</span>
                          <button onClick={()=>{setSelected(c);setModal('edit')}}
                                  className="px-2 py-1 text-xs bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-100">Edit</button>
                          <button onClick={()=>openWhatsApp(c)}
                                  className="px-2 py-1 text-xs bg-green-50 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded hover:bg-green-100">WA</button>
                          {isAdmin && (
                            <button onClick={()=>{setSelected(c);setDelOpen(true)}}
                                    className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded hover:bg-red-100">Del</button>
                          )}
                        </div>
                      </td>
                      <td className="table-cell font-medium">{c.clientName || '?'}</td>
                      <td className="table-cell text-xs">{c.policyNumber || '?'}</td>
                      <td className="table-cell"><span className="badge-blue text-xs">{c.claimType}</span></td>
                      <td className="table-cell text-xs">{c.insurer || '?'}</td>
                      <td className="table-cell">{fmtDate(c.intimationDate)}</td>
                      <td className="table-cell text-right">{c.claimedAmount ? `?${Number(c.claimedAmount).toLocaleString('en-IN')}` : '?'}</td>
                      <td className="table-cell text-right">{c.approvedAmount ? `?${Number(c.approvedAmount).toLocaleString('en-IN')}` : '?'}</td>
                      <td className="table-cell">
                        <select value={c.status}
                                onChange={e => onStatusChange(c.id, e.target.value)}
                                className={`text-xs font-semibold rounded-lg px-2 py-1 border-0 cursor-pointer ${STATUS_COLORS[c.status]||''}`}>
                          {CLAIM_STATUSES.map(s=><option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="table-cell text-xs">{c.hospitalName || '?'}</td>
                      <td className="table-cell text-center">
                        <span className={`text-xs font-semibold ${docsCount===docsTotal?'text-green-600':'text-orange-500'}`}>
                          {docsCount}/{docsTotal}
                        </span>
                      </td>
                    </tr>
                  )
                })
              }
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modal==='add'} onClose={()=>setModal(null)} title="🔍 Add New Claim" size="xl">
        <ClaimForm clients={clients} policies={policies} onSave={onAdd} onCancel={()=>setModal(null)} />
      </Modal>
      <Modal open={modal==='edit'} onClose={()=>setModal(null)} title="Edit Claim" size="xl">
        {selected && <ClaimForm initial={selected} clients={clients} policies={policies} onSave={onEdit} onCancel={()=>setModal(null)} />}
      </Modal>
      <ConfirmDialog open={delOpen} onClose={()=>setDelOpen(false)} onConfirm={onDelete}
                     title="Delete Claim?" message={`Delete claim for "${selected?.clientName}"?`} danger />
    </div>
  )
}
