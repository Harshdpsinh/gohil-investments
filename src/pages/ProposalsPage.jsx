// src/pages/ProposalsPage.jsx
import { useState, useEffect } from 'react'
import { useClients }       from '../hooks/useClients'
import {
  addProposal, getAllProposals, deleteProposal,
  addClient, updateClient, findClientByMobileOrName
} from '../firebase/firestore'
import { generateProposalPDF } from '../utils/proposalPDF'
import Modal        from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { fmtDateTime } from '../utils/dateUtils'
import toast from 'react-hot-toast'

// ── Known insurers (shared with PoliciesPage) ─────────────────
const KNOWN_INSURERS_LIST = [
  'Star Health & Allied Insurance','New India Assurance','ICICI Lombard',
  'HDFC ERGO','Bajaj Allianz','Niva Bupa (Max Bupa)','Care Health Insurance',
  'Aditya Birla Health Insurance','Tata AIG','Oriental Insurance',
  'United India Insurance','National Insurance','LIC of India',
  'HDFC Life','ICICI Prudential Life','SBI Life','Max Life Insurance',
  'Bajaj Allianz Life','Kotak Life Insurance','Tata AIA Life',
  'HDFC ERGO Motor','Bajaj Allianz Motor','Digit Insurance',
]
function InsurerCombo({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [q, setQ]       = useState(value || '')
  const filtered = q.length >= 1
    ? KNOWN_INSURERS_LIST.filter(i => i.toLowerCase().includes(q.toLowerCase())).slice(0,8)
    : KNOWN_INSURERS_LIST.slice(0,8)
  const pick = name => { setQ(name); onChange(name); setOpen(false) }
  return (
    <div className="relative">
      <input type="text" value={q}
        onChange={e=>{ setQ(e.target.value); onChange(e.target.value); setOpen(true) }}
        onFocus={()=>setOpen(true)} onBlur={()=>setTimeout(()=>setOpen(false),150)}
        placeholder="Type or select insurer…" className="form-input" />
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {filtered.map(ins=>(
            <button key={ins} type="button" onMouseDown={()=>pick(ins)}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-900/30">{ins}</button>
          ))}
        </div>
      )}
    </div>
  )
}


const POLICY_TYPES = ['Health','Life','General']
const PLAN_TYPES   = ['Individual','Family Floater','Group']
const FREQS        = ['Yearly','Half-Yearly','Quarterly','Monthly']
const EMPLOYMENT   = ['Salaried','Self-Employed','Business','Other']

const EMPTY_FORM = {
  policyType:'Health', proposerName:'', dob:'', mobile:'', email:'',
  pan:'', aadhar:'', address:'', occupation:'', income:'',
  employment:'', qualification:'', designation:'',
  insurer:'', planName:'', sumAssured:'', premium:'',
  frequency:'Yearly', planType:'Family Floater',
  pastOperation:'No', existingIllness:'',
  bankName:'', bankAccount:'', ifsc:'',
  policyTerm:'', nomineeName:'', nomineeRelation:'', nomineePan:'',
  height:'', weight:'', motherName:'', familyIllness:'',
  members: Array.from({ length: 6 }, () => ({ name:'', height:'', weight:'', dob:'', diseases:'' })),
  notes:''
}

function MemberRow({ member, idx, onChange }) {
  const inp = (k, ph, w='w-32') => (
    <input type={k === 'dob' ? 'date' : 'text'} value={member[k] || ''}
           onChange={e => onChange(idx, k, e.target.value)}
           placeholder={k !== 'dob' ? ph : undefined}
           className={`form-input text-xs ${w}`} />
  )
  return (
    <tr>
      <td className="py-1 pr-2">{inp('name','Full Name','w-40')}</td>
      <td className="py-1 pr-2">{inp('height','cm')}</td>
      <td className="py-1 pr-2">{inp('weight','kg')}</td>
      <td className="py-1 pr-2">{inp('dob','')}</td>
      <td className="py-1">{inp('diseases','Nil / Diabetes…','w-44')}</td>
    </tr>
  )
}

// ── Upsert result indicator ───────────────────────────────────
function UpsertBadge({ status }) {
  if (!status) return null
  const config = {
    checking: { bg: 'bg-blue-50  border-blue-200  text-blue-700',  icon: '🔍', text: 'Checking for existing client…' },
    found:    { bg: 'bg-green-50 border-green-200 text-green-700', icon: '✅', text: 'Existing client found — proposal will be linked to their account.' },
    creating: { bg: 'bg-blue-50  border-blue-200  text-blue-700',  icon: '⏳', text: 'No existing client found — creating new client record…' },
    created:  { bg: 'bg-purple-50 border-purple-200 text-purple-700', icon: '🆕', text: 'New client created and proposal linked.' },
    linked:   { bg: 'bg-green-50 border-green-200 text-green-700', icon: '🔗', text: 'Proposal saved and linked to existing client.' },
  }
  const c = config[status]
  if (!c) return null
  return (
    <div className={`border rounded-xl p-3 text-xs font-medium flex items-center gap-2 ${c.bg}`}>
      <span>{c.icon}</span>{c.text}
    </div>
  )
}

function ProposalForm({ clients, initial, onSave, onCancel }) {
  const [form, setForm]     = useState(initial || EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [upsertStatus, setUpsertStatus] = useState(null)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const setMember = (idx, k, v) => setForm(p => {
    const members = [...p.members]; members[idx] = { ...members[idx], [k]: v }; return { ...p, members }
  })

  const onClientSelect = e => {
    const cl = clients.find(c => c.id === e.target.value)
    if (!cl) return
    setForm(p => ({
      ...p, clientId: cl.id,
      proposerName: cl.name || '', mobile: cl.mobile || '', email: cl.email || '',
      pan: cl.pan || '', aadhar: cl.aadhar || '', dob: cl.dob || '',
      address: cl.address || '', occupation: cl.occupation || '',
      income: cl.income || '', employment: cl.employment || '',
      qualification: cl.qualification || '', designation: cl.designation || '',
    }))
  }

  const inp = (k, lbl, type='text', opts={}) => (
    <div>
      <label className="form-label">{lbl}</label>
      <input type={type} value={form[k] || ''} onChange={e => set(k, e.target.value)} className="form-input" {...opts} />
    </div>
  )
  const sel = (k, lbl, opts) => (
    <div>
      <label className="form-label">{lbl}</label>
      <select value={form[k] || ''} onChange={e => set(k, e.target.value)} className="form-select">
        {opts.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  )

  // ── Upsert logic on submit ──────────────────────────────────
  const onSubmit = async e => {
    e.preventDefault()
    if (!form.proposerName.trim()) { toast.error('Proposer name is required'); return }
    setSaving(true)
    setUpsertStatus('checking')

    try {
      let clientId   = form.clientId || null
      let clientName = form.proposerName

      // Only run upsert lookup if not already linked from dropdown
      if (!clientId) {
        const existing = await findClientByMobileOrName(form.mobile, form.proposerName)

        if (existing) {
          // Found by mobile or name — link to existing
          clientId   = existing.id
          clientName = existing.name
          setUpsertStatus('found')

          // Optionally update client record with any new info from the form
          await updateClient(existing.id, {
            ...(form.mobile && { mobile: form.mobile }),
            ...(form.email  && { email:  form.email  }),
          })
        } else {
          // Not found — create new client record first
          setUpsertStatus('creating')
          const ref = await addClient({
            name:       form.proposerName,
            mobile:     form.mobile     || '',
            email:      form.email      || '',
            pan:        form.pan        || '',
            aadhar:     form.aadhar     || '',
            dob:        form.dob        || '',
            address:    form.address    || '',
            occupation: form.occupation || '',
            income:     form.income     || '',
            employment: form.employment || '',
            qualification: form.qualification || '',
            designation:   form.designation   || '',
            kycStatus: 'Pending',
          })
          clientId = ref.id
          setUpsertStatus('created')
          toast(`🆕 New client "${form.proposerName}" created`, { icon: '✅' })
        }
      }

      // Save the proposal with the resolved clientId
      await onSave({ ...form, clientId, clientName })
      setUpsertStatus(clientId && !form.clientId ? 'created' : 'linked')

    } catch (err) {
      toast.error(err.message)
      setUpsertStatus(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Auto-fill from client */}
      <div>
        <label className="form-label">Auto-fill from existing client (optional)</label>
        <select onChange={onClientSelect} className="form-select">
          <option value="">— Select client to auto-fill —</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Upsert status badge */}
      <UpsertBadge status={upsertStatus} />

      {/* Upsert info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
        <p className="font-semibold mb-1">ℹ️ Smart Client Linking</p>
        <p>When you submit, the app automatically checks if a client with this <strong>mobile number</strong> or <strong>name</strong> already exists.
        If found, the proposal is linked to them. If not, a new client record is created instantly.</p>
      </div>

      {/* Policy type tabs */}
      <div className="flex gap-2">
        {POLICY_TYPES.map(t => (
          <button key={t} type="button" onClick={() => set('policyType', t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              form.policyType === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>{t}</button>
        ))}
      </div>

      {/* Section 1: KYC */}
      <fieldset className="border border-gray-200 rounded-xl p-4 space-y-3">
        <legend className="text-xs font-bold text-blue-700 uppercase px-2">1. Client / KYC Details</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {inp('proposerName','Proposer Name *','text',{ required:true })}
          {inp('dob','Date of Birth','date')}
          {inp('mobile','Mobile','tel')}
          {inp('email','Email','email')}
          {inp('pan','PAN')}
          {inp('aadhar','Aadhar')}
        </div>
        {inp('address','Address')}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {inp('occupation','Occupation')}
          {inp('income','Annual Income (₹)','number')}
          {sel('employment','Employment Type',EMPLOYMENT)}
          {inp('qualification','Qualification')}
          {inp('designation','Designation')}
        </div>
      </fieldset>

      {/* Section 2: Plan */}
      <fieldset className="border border-gray-200 rounded-xl p-4 space-y-3">
        <legend className="text-xs font-bold text-blue-700 uppercase px-2">2. Plan Summary</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="form-label">Insurance Company</label>
            <InsurerCombo value={form.insurer||''} onChange={v=>setForm(p=>({...p,insurer:v}))} />
          </div>
          {inp('planName','Plan Name')}
          {inp('sumAssured','Sum Insured/Assured (₹)','number')}
          {inp('premium','Annual Premium (₹)','number')}
          {sel('frequency','Payment Frequency',FREQS)}
        </div>
      </fieldset>

      {/* Section 3: Health */}
      {form.policyType === 'Health' && (
        <fieldset className="border border-gray-200 rounded-xl p-4 space-y-3">
          <legend className="text-xs font-bold text-blue-700 uppercase px-2">3. Health Details</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {sel('planType','Plan Type',PLAN_TYPES)}
            {inp('pastOperation','Any Past Operation','text',{ placeholder:'No / Yes (details)' })}
            {inp('existingIllness','Existing Illness')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {inp('bankName','Bank Name')}
            {inp('bankAccount','Account Number')}
            {inp('ifsc','IFSC Code')}
          </div>
          <div>
            <p className="form-label mb-2">Family Members (for Family Floater)</p>
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr className="text-gray-500">
                    <th className="text-left pb-1 pr-2">Name</th>
                    <th className="text-left pb-1 pr-2">Height cm</th>
                    <th className="text-left pb-1 pr-2">Weight kg</th>
                    <th className="text-left pb-1 pr-2">Birth Date</th>
                    <th className="text-left pb-1">Diseases</th>
                  </tr>
                </thead>
                <tbody>
                  {form.members.map((m,i) => <MemberRow key={i} member={m} idx={i} onChange={setMember} />)}
                </tbody>
              </table>
            </div>
          </div>
        </fieldset>
      )}

      {/* Section 3: Life */}
      {form.policyType === 'Life' && (
        <fieldset className="border border-gray-200 rounded-xl p-4 space-y-3">
          <legend className="text-xs font-bold text-blue-700 uppercase px-2">3. Life Details</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {inp('policyTerm','Policy Term (years)','number')}
            {inp('nomineeName','Nominee Name')}
            {inp('nomineeRelation','Nominee Relation')}
            {inp('nomineePan','Nominee PAN / Aadhar')}
            {inp('height','Height (cm)','number')}
            {inp('weight','Weight (kg)','number')}
            {inp('motherName',"Mother's Name")}
            {inp('familyIllness','Family Illness')}
          </div>
        </fieldset>
      )}

      <div>
        <label className="form-label">Notes</label>
        <textarea rows={2} value={form.notes || ''} onChange={e => set('notes', e.target.value)} className="form-input" />
      </div>

      <div className="flex gap-3 pt-2 flex-wrap">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? '⏳ Saving…' : '💾 Save Proposal'}
        </button>
        <button type="button" onClick={() => generateProposalPDF(form)} className="btn-success">
          📄 Download PDF
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </form>
  )
}

export default function ProposalsPage() {
  const { clients }               = useClients()
  const [proposals, setProposals] = useState([])
  const [loading, setLoading]     = useState(true)
  const [modal,    setModal]      = useState(null)
  const [selected, setSelected]   = useState(null)
  const [delOpen,  setDelOpen]    = useState(false)

  const load = async () => {
    setLoading(true)
    const data = await getAllProposals()
    setProposals(data)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const onAdd = async form => {
    await addProposal(form)
    toast.success('Proposal saved!')
    setModal(null)
    load()
  }
  const onDelete = async () => {
    await deleteProposal(selected.id)
    toast.success('Proposal deleted')
    load()
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Proposals</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{proposals.length} saved proposals</p>
        </div>
        <button className="btn-primary" onClick={() => { setSelected(null); setModal('add') }}>
          + New Proposal
        </button>
      </div>

      {loading
        ? <div className="text-gray-400 flex items-center gap-2 p-4">
            <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />Loading…
          </div>
        : (
          <div className="table-container">
            <table className="min-w-full">
              <thead>
                <tr>
                  {['Proposer','Type','Insurer','Plan','Premium','Client Linked','Created','Actions'].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800">
                {proposals.length === 0
                  ? <tr><td colSpan={8} className="text-center py-12 text-gray-400">No proposals yet.</td></tr>
                  : proposals.map(p => (
                    <tr key={p.id} className="table-row">
                      <td className="table-cell font-semibold">{p.proposerName}</td>
                      <td className="table-cell"><span className="badge-blue">{p.policyType}</span></td>
                      <td className="table-cell">{p.insurer || '—'}</td>
                      <td className="table-cell">{p.planName || '—'}</td>
                      <td className="table-cell">{p.premium ? `₹${parseInt(p.premium).toLocaleString('en-IN')}` : '—'}</td>
                      <td className="table-cell">
                        {p.clientId
                          ? <span className="text-xs text-green-600 font-semibold">✅ {p.clientName || 'Linked'}</span>
                          : <span className="text-xs text-gray-400">—</span>
                        }
                      </td>
                      <td className="table-cell text-xs text-gray-400">{fmtDateTime(p.createdAt)}</td>
                      <td className="table-cell">
                        <div className="flex gap-1">
                          <button onClick={() => generateProposalPDF(p)}
                                  className="px-2 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100">📄 PDF</button>
                          <button onClick={() => { setSelected(p); setDelOpen(true) }}
                                  className="px-2 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100">Del</button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )
      }

      <Modal open={modal === 'add'} onClose={() => setModal(null)} title="New Insurance Proposal" size="xl">
        <ProposalForm clients={clients} onSave={onAdd} onCancel={() => setModal(null)} />
      </Modal>
      <ConfirmDialog
        open={delOpen} onClose={() => setDelOpen(false)} onConfirm={onDelete}
        title="Delete Proposal?"
        message={`Delete proposal for "${selected?.proposerName}"?`}
        danger
      />
    </div>
  )
}
