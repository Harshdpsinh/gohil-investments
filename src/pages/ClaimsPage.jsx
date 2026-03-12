// src/pages/ClaimsPage.jsx
import { useState, useMemo, useEffect } from 'react'
import { useClients }  from '../hooks/useClients'
import { usePolicies } from '../hooks/usePolicies'
import {
  subscribeClaims, addClaim, updateClaim, deleteClaim,
  CLAIM_STATUSES
} from '../firebase/firestore'
import Modal        from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { fmtDate, fmtCurrency, fmtDateTime } from '../utils/dateUtils'
import toast from 'react-hot-toast'

const CLAIM_TYPES   = ['Cashless','Reimbursement','OD Damage','Total Loss','Third Party','Death Benefit','Maturity','Other']
const STATUS_COLORS = {
  'Intimated':             'bg-gray-100 text-gray-700',
  'Documents Submitted':   'bg-blue-100 text-blue-700',
  'Under Review':          'bg-yellow-100 text-yellow-700',
  'Approved':              'bg-green-100 text-green-700',
  'Settled':               'bg-green-200 text-green-800',
  'Rejected':              'bg-red-100 text-red-700',
}
const STATUS_ICONS = {
  'Intimated':             '📋',
  'Documents Submitted':   '📤',
  'Under Review':          '🔍',
  'Approved':              '✅',
  'Settled':               '💰',
  'Rejected':              '❌',
}

const EMPTY_CLAIM = {
  clientId:'', clientName:'', policyId:'', policyNumber:'',
  claimNo:'', claimType:'Cashless', incidentDate:'', intimationDate:'',
  claimAmount:'', settledAmount:'',
  status:'Intimated', rejectionReason:'', notes:''
}

function turnaroundDays(claim) {
  if (!claim.intimationDate) return null
  const end = claim.status === 'Settled' || claim.status === 'Rejected'
    ? (claim.updatedAt?.toDate?.() || new Date())
    : new Date()
  const start = new Date(claim.intimationDate)
  return Math.ceil((end - start) / 86400000)
}

// ── Claim Form ────────────────────────────────────────────────
function ClaimForm({ initial, clients, policies, onSave, onCancel }) {
  const [form, setForm]   = useState(initial || EMPTY_CLAIM)
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setForm(p=>({...p,[k]:v}))

  const clientPolicies = useMemo(() =>
    policies.filter(p => p.clientId === form.clientId),
    [policies, form.clientId]
  )

  const onClientChange = e => {
    const id  = e.target.value
    const cl  = clients.find(c=>c.id===id)
    set('clientId',   id)
    set('clientName', cl?.name || '')
    set('policyId',   '')
    set('policyNumber','')
  }
  const onPolicyChange = e => {
    const id = e.target.value
    const pol = policies.find(p=>p.id===id)
    set('policyId',     id)
    set('policyNumber', pol?.policyNumber || '')
  }

  const inp = (k,lbl,type='text',opts={}) => (
    <div><label className="form-label">{lbl}</label>
      <input type={type} value={form[k]||''} onChange={e=>set(k,e.target.value)} className="form-input" {...opts} /></div>
  )
  const sel = (k,lbl,options) => (
    <div><label className="form-label">{lbl}</label>
      <select value={form[k]||''} onChange={e=>set(k,e.target.value)} className="form-select">
        <option value="">— Select —</option>
        {options.map(o=><option key={o}>{o}</option>)}
      </select></div>
  )

  const onSubmit = async () => {
    if (!form.clientId)   { toast.error('Client is required');   return }
    if (!form.claimType)  { toast.error('Claim type is required'); return }
    if (!form.incidentDate) { toast.error('Incident date is required'); return }
    setSaving(true)
    try { await onSave(form) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className="form-label">Client *</label>
          <select value={form.clientId||''} onChange={onClientChange} className="form-select">
            <option value="">— Select Client —</option>
            {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div><label className="form-label">Linked Policy</label>
          <select value={form.policyId||''} onChange={onPolicyChange} className="form-select">
            <option value="">— Select Policy —</option>
            {clientPolicies.map(p=><option key={p.id} value={p.id}>{p.policyNumber} · {p.policyType} · {p.insurer}</option>)}
          </select></div>
        {inp('claimNo','Claim Number (from insurer)')}
        {sel('claimType','Claim Type',CLAIM_TYPES)}
        {inp('incidentDate','Date of Incident *','date')}
        {inp('intimationDate','Date of Intimation','date')}
        {inp('claimAmount','Claim Amount (₹)','number')}
        {inp('settledAmount','Settled Amount (₹)','number')}
        {sel('status','Current Status',CLAIM_STATUSES)}
      </div>
      {form.status === 'Rejected' && (
        <div><label className="form-label">Rejection Reason</label>
          <textarea rows={2} value={form.rejectionReason||''} onChange={e=>set('rejectionReason',e.target.value)} className="form-input" /></div>
      )}
      <div><label className="form-label">Notes</label>
        <textarea rows={2} value={form.notes||''} onChange={e=>set('notes',e.target.value)} className="form-input" /></div>
      <div className="flex gap-3 pt-2">
        <button onClick={onSubmit} disabled={saving} className="btn-primary">{saving?'⏳ Saving…':'💾 Save Claim'}</button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  )
}

// ── Pipeline Column ───────────────────────────────────────────
function PipelineView({ claims }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {CLAIM_STATUSES.map(status => {
        const group = claims.filter(c=>c.status===status)
        return (
          <div key={status} className="bg-gray-50 rounded-xl p-3 min-h-24">
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs px-2 py-0.5 rounded font-semibold ${STATUS_COLORS[status]}`}>
                {STATUS_ICONS[status]} {status}
              </span>
              <span className="text-xs text-gray-400 font-bold">{group.length}</span>
            </div>
            {group.map(c=>(
              <div key={c.id} className="bg-white rounded-lg p-2 mb-1.5 shadow-sm border border-gray-100 text-xs">
                <p className="font-semibold text-gray-800 truncate">{c.clientName||'—'}</p>
                <p className="text-gray-500 truncate">{c.policyNumber||c.claimType}</p>
                {c.claimAmount && <p className="text-blue-600 font-semibold">{fmtCurrency(c.claimAmount)}</p>}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function ClaimsPage() {
  const { clients }  = useClients()
  const { policies } = usePolicies()
  const [claims,    setClaims]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [view,      setView]      = useState('table') // 'table' | 'pipeline'
  const [search,    setSearch]    = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [modal,     setModal]     = useState(null)
  const [selected,  setSelected]  = useState(null)
  const [delOpen,   setDelOpen]   = useState(false)

  useEffect(() => {
    const unsub = subscribeClaims(data => { setClaims(data); setLoading(false) })
    return unsub
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return claims.filter(c => {
      const mQ = !q || c.clientName?.toLowerCase().includes(q) || c.claimNo?.toLowerCase().includes(q) || c.policyNumber?.toLowerCase().includes(q)
      const mS = statusFilter === 'All' || c.status === statusFilter
      return mQ && mS
    })
  }, [claims, search, statusFilter])

  const stats = useMemo(() => ({
    open:      claims.filter(c=>!['Settled','Rejected'].includes(c.status)).length,
    settled:   claims.filter(c=>c.status==='Settled').length,
    rejected:  claims.filter(c=>c.status==='Rejected').length,
    totalClaimed:  claims.reduce((s,c)=>s+(parseFloat(c.claimAmount)||0),0),
    totalSettled:  claims.filter(c=>c.status==='Settled').reduce((s,c)=>s+(parseFloat(c.settledAmount)||0),0),
  }), [claims])

  const onAdd    = async form => { await addClaim(form);                toast.success('Claim added!');   setModal(null) }
  const onEdit   = async form => { await updateClaim(selected.id,form); toast.success('Claim updated!'); setModal(null) }
  const onDelete = async ()   => { await deleteClaim(selected.id);      toast.success('Claim deleted') }

  const onStatusChange = async (claim, newStatus) => {
    await updateClaim(claim.id, { status: newStatus })
    toast.success(`Status → ${newStatus}`)
  }

  if (loading) return (
    <div className="p-8 text-gray-400 flex items-center gap-2">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      Loading claims…
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Claims Tracker</h1>
          <p className="text-sm text-gray-500">{claims.length} total claims</p>
        </div>
        <div className="flex gap-2">
          <button onClick={()=>setView(v=>v==='table'?'pipeline':'table')}
                  className="btn-secondary text-xs">{view==='table'?'🗂️ Pipeline View':'📋 Table View'}</button>
          <button onClick={()=>{setSelected(null);setModal('add')}} className="btn-primary">+ New Claim</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label:'Open Claims',       value:stats.open,                    color:'bg-blue-50 text-blue-700'   },
          { label:'Settled',           value:stats.settled,                 color:'bg-green-50 text-green-700' },
          { label:'Rejected',          value:stats.rejected,                color:'bg-red-50 text-red-700'     },
          { label:'Total Claimed',     value:fmtCurrency(stats.totalClaimed), color:'bg-yellow-50 text-yellow-700' },
          { label:'Total Settled',     value:fmtCurrency(stats.totalSettled), color:'bg-purple-50 text-purple-700' },
        ].map(s=>(
          <div key={s.label} className={`rounded-xl p-3 ${s.color}`}>
            <p className="text-xl font-bold">{s.value}</p>
            <p className="text-xs font-medium mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Pipeline view */}
      {view === 'pipeline' && <PipelineView claims={filtered} />}

      {/* Table view */}
      {view === 'table' && (
        <>
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
            <input type="search" placeholder="Search client, claim no, policy…"
                   value={search} onChange={e=>setSearch(e.target.value)} className="form-input w-64" />
            <div className="flex gap-1 flex-wrap">
              {['All',...CLAIM_STATUSES].map(s=>(
                <button key={s} onClick={()=>setStatusFilter(s)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    statusFilter===s?'bg-blue-600 text-white':'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>{STATUS_ICONS[s]||''} {s}</button>
              ))}
            </div>
          </div>

          <div className="table-container">
            <table className="min-w-full">
              <thead>
                <tr>
                  {['Client','Claim No','Type','Policy','Incident','Claim ₹','Settled ₹','TAT','Status','Actions'].map(h=>(
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white">
                {filtered.length===0
                  ? <tr><td colSpan={10} className="text-center py-12 text-gray-400">No claims found</td></tr>
                  : filtered.map(c=>(
                    <tr key={c.id} className="table-row">
                      <td className="table-cell font-semibold">{c.clientName||'—'}</td>
                      <td className="table-cell font-mono text-xs">{c.claimNo||'—'}</td>
                      <td className="table-cell text-xs">{c.claimType}</td>
                      <td className="table-cell font-mono text-xs">{c.policyNumber||'—'}</td>
                      <td className="table-cell">{fmtDate(c.incidentDate)}</td>
                      <td className="table-cell">{c.claimAmount?fmtCurrency(c.claimAmount):'—'}</td>
                      <td className="table-cell">{c.settledAmount?fmtCurrency(c.settledAmount):'—'}</td>
                      <td className="table-cell text-xs text-center">
                        {turnaroundDays(c)!==null?`${turnaroundDays(c)}d`:'—'}
                      </td>
                      <td className="table-cell">
                        <select value={c.status||'Intimated'}
                                onChange={e=>onStatusChange(c,e.target.value)}
                                className={`text-xs px-2 py-1 rounded-lg border-0 font-semibold cursor-pointer ${STATUS_COLORS[c.status]||'bg-gray-100'}`}>
                          {CLAIM_STATUSES.map(s=><option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="table-cell">
                        <div className="flex gap-1">
                          <button onClick={()=>{setSelected(c);setModal('edit')}}
                                  className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100">Edit</button>
                          <button onClick={()=>{setSelected(c);setDelOpen(true)}}
                                  className="px-2 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100">Del</button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Modal open={modal==='add'} onClose={()=>setModal(null)} title="New Claim" size="lg">
        <ClaimForm clients={clients} policies={policies} onSave={onAdd} onCancel={()=>setModal(null)} />
      </Modal>
      <Modal open={modal==='edit'} onClose={()=>setModal(null)} title="Edit Claim" size="lg">
        {selected&&<ClaimForm initial={selected} clients={clients} policies={policies} onSave={onEdit} onCancel={()=>setModal(null)} />}
      </Modal>
      <ConfirmDialog open={delOpen} onClose={()=>setDelOpen(false)} onConfirm={onDelete}
                     title="Delete Claim?" message={`Delete claim "${selected?.claimNo||selected?.claimType}" for "${selected?.clientName}"?`} danger />
    </div>
  )
}
