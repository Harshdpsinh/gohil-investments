// src/pages/PoliciesPage.jsx
import { useState, useMemo, useRef } from 'react'
import { useClients }  from '../hooks/useClients'
import { usePolicies } from '../hooks/usePolicies'
import { useAuth }     from '../hooks/useAuth'
import { addPolicy, updatePolicy, deletePolicy, addClient, savePolicyPdfUrl } from '../firebase/firestore'
import { uploadPolicyPdf } from '../firebase/storage'
import {
  HEALTH_DEFAULTS, LIFE_DEFAULTS, MOTOR_DEFAULTS,
  HEALTH_RELATIONSHIPS, MOTOR_NCB_OPTIONS, MOTOR_COVER_TYPES,
  MOTOR_VEHICLE_TYPES, MOTOR_FUEL_TYPES, LIFE_SUBTYPES,
  getTypeDefaults
} from '../utils/policySchemas'
import Modal        from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import SearchBar    from '../components/ui/SearchBar'
import { fmtDate, fmtCurrency, daysUntil, renewalStatus } from '../utils/dateUtils'
import {
  exportToCSV, exportToExcel, exportToPDF, POLICY_COLS,
  downloadTemplate, parseImportFile, normaliseDate,
  POLICY_IMPORT_HEADERS, POLICY_IMPORT_SAMPLE
} from '../utils/exportUtils'
import toast from 'react-hot-toast'

const TYPES  = ['Health','Life','Motor','Home','Travel','Marine','Fire','Other']
const FREQS  = ['Yearly','Half-Yearly','Quarterly','Monthly']
const STATUS = ['Active','Lapsed','Cancelled','Matured','Renewed-Out']
const ADDONS = [
  ['zeroDep','Zero Dep'],['engineProtect','Engine Protect'],['rsa','RSA'],
  ['keyReplace','Key Replace'],['consumables','Consumables'],
  ['returnToInvoice','Return to Invoice'],['tyreProtect','Tyre Protect'],
  ['personalAccident','Personal Accident'],
]

const BASE_EMPTY = {
  policyNumber:'', clientId:'', clientName:'', policyType:'Health',
  insurer:'', planName:'', premium:'', sumAssured:'', frequency:'Yearly',
  startDate:'', expiryDate:'', status:'Active',
  nominee:'', nomineeRelation:'',
  fyCommission:'', ryCommission:'', notes:''
}

// ── Quick Add Client overlay ──────────────────────────────────
function QuickAddClientModal({ onCreated, onClose }) {
  const [form, setForm] = useState({ name:'', mobile:'', email:'', kycStatus:'Pending' })
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setForm(p=>({...p,[k]:v}))
  const onSubmit = async e => {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    try { const ref = await addClient(form); toast.success(`"${form.name}" created!`); onCreated({id:ref.id,name:form.name}) }
    catch(err) { toast.error(err.message) }
    finally { setSaving(false) }
  }
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">➕ Quick Add Client</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <p className="text-xs text-gray-500">Creates a basic record. Fill full details from Clients page later.</p>
        <form onSubmit={onSubmit} className="space-y-3">
          <div><label className="form-label">Full Name *</label>
            <input value={form.name} onChange={e=>set('name',e.target.value)} className="form-input" autoFocus /></div>
          <div><label className="form-label">Mobile</label>
            <input value={form.mobile} onChange={e=>set('mobile',e.target.value)} className="form-input" type="tel" /></div>
          <div><label className="form-label">Email</label>
            <input value={form.email} onChange={e=>set('email',e.target.value)} className="form-input" type="email" /></div>
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving} className="btn-primary flex-1">{saving?'⏳ Saving…':'✅ Create & Select'}</button>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Policy PDF Upload ─────────────────────────────────────────
function PolicyPdfUpload({ policyId, existingUrl, existingName, onUploaded }) {
  const fileRef = useRef()
  const [progress, setProgress]   = useState(null)
  const [uploading, setUploading] = useState(false)
  const onFileChange = async e => {
    const file = e.target.files[0]; if (!file) return
    setUploading(true); setProgress(0)
    try {
      const { url, name } = await uploadPolicyPdf(policyId, file, p=>setProgress(p))
      await savePolicyPdfUrl(policyId, url, name)
      toast.success('PDF uploaded!')
      onUploaded(url, name)
    } catch(err) { toast.error(err.message) }
    finally { setUploading(false); setProgress(null); if(fileRef.current)fileRef.current.value='' }
  }
  if (!policyId) return (
    <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-3 text-xs text-gray-400 text-center">
      📎 Save policy first, then attach PDF from Edit button.
    </div>
  )
  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-2">
      <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">📎 Policy Document (PDF)</p>
      {existingUrl && (
        <div className="flex items-center gap-2 bg-white border border-indigo-200 rounded-lg px-3 py-2">
          <a href={existingUrl} target="_blank" rel="noopener noreferrer"
             className="text-xs text-indigo-700 font-medium hover:underline flex-1 truncate">📄 {existingName||'View PDF'}</a>
          <span className="text-xs text-green-600 font-semibold">✅ Stored</span>
        </div>
      )}
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={onFileChange} disabled={uploading}
             className="text-xs cursor-pointer file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-indigo-100 file:text-indigo-700" />
      {uploading && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-indigo-600"><span>Uploading…</span><span>{progress}%</span></div>
          <div className="w-full bg-indigo-100 rounded-full h-1.5">
            <div className="bg-indigo-600 h-1.5 rounded-full" style={{width:`${progress}%`}} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Type-specific form sections ───────────────────────────────
function HealthSection({ form, set }) {
  return (
    <fieldset className="border border-green-200 rounded-xl p-4 space-y-3">
      <legend className="text-xs font-bold text-green-700 uppercase px-2">🏥 Health Details</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className="form-label">Sum Insured (₹)</label>
          <input type="number" value={form.sumInsured||''} onChange={e=>set('sumInsured',e.target.value)} className="form-input" /></div>
        <div><label className="form-label">Cumulative Bonus (₹)</label>
          <input type="number" value={form.cumulativeBonus||''} onChange={e=>set('cumulativeBonus',e.target.value)} className="form-input" /></div>
        <div><label className="form-label">Cumulative Bonus %</label>
          <input type="number" value={form.cumulativeBonusPct||''} onChange={e=>set('cumulativeBonusPct',e.target.value)} className="form-input" /></div>
        <div><label className="form-label">Room Rent Limit (₹/day)</label>
          <input type="text" value={form.roomRentLimit||''} onChange={e=>set('roomRentLimit',e.target.value)} className="form-input" placeholder="e.g. 5000 or No Limit" /></div>
        <div><label className="form-label">Co-pay %</label>
          <input type="number" value={form.coPay||''} onChange={e=>set('coPay',e.target.value)} className="form-input" /></div>
        <div><label className="form-label">Date of First Entry</label>
          <input type="date" value={form.dateOfFirstEntry||''} onChange={e=>set('dateOfFirstEntry',e.target.value)} className="form-input" /></div>
      </div>
      <div className="flex gap-6 flex-wrap">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={!!form.restoreBenefit} onChange={e=>set('restoreBenefit',e.target.checked)} className="w-4 h-4" />
          Restore Benefit
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={!!form.isPortability} onChange={e=>set('isPortability',e.target.checked)} className="w-4 h-4" />
          Portability (switching insurer)
        </label>
      </div>
      {form.isPortability && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-3 bg-yellow-50 rounded-xl">
          <div><label className="form-label">Previous Insurer</label>
            <input value={form.prevInsurer||''} onChange={e=>set('prevInsurer',e.target.value)} className="form-input" /></div>
          <div><label className="form-label">Previous Policy No</label>
            <input value={form.prevPolicyNo||''} onChange={e=>set('prevPolicyNo',e.target.value)} className="form-input" /></div>
          <div><label className="form-label">NCB Carried Forward (₹)</label>
            <input type="number" value={form.portabilityNCB||''} onChange={e=>set('portabilityNCB',e.target.value)} className="form-input" /></div>
        </div>
      )}
      {/* Members table */}
      <div>
        <p className="text-xs font-semibold text-gray-700 mb-2">Members Covered</p>
        <div className="space-y-2">
          {(form.members||[]).map((m,i)=>(
            <div key={i} className="grid grid-cols-5 gap-2 items-center">
              <input value={m.name||''} onChange={e=>{const mb=[...form.members];mb[i]={...mb[i],name:e.target.value};set('members',mb)}} placeholder="Name" className="form-input text-xs" />
              <input type="number" value={m.age||''} onChange={e=>{const mb=[...form.members];mb[i]={...mb[i],age:e.target.value};set('members',mb)}} placeholder="Age" className="form-input text-xs" />
              <input type="date" value={m.dob||''} onChange={e=>{const mb=[...form.members];mb[i]={...mb[i],dob:e.target.value};set('members',mb)}} className="form-input text-xs" />
              <select value={m.relationship||'Self'} onChange={e=>{const mb=[...form.members];mb[i]={...mb[i],relationship:e.target.value};set('members',mb)}} className="form-select text-xs">
                {HEALTH_RELATIONSHIPS.map(r=><option key={r}>{r}</option>)}
              </select>
              <div className="flex gap-1">
                <input value={m.ped||''} onChange={e=>{const mb=[...form.members];mb[i]={...mb[i],ped:e.target.value};set('members',mb)}} placeholder="PED" className="form-input text-xs flex-1" />
                <button type="button" onClick={()=>set('members',form.members.filter((_,idx)=>idx!==i))} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
              </div>
            </div>
          ))}
          <button type="button" onClick={()=>set('members',[...(form.members||[]),{name:'',dob:'',age:'',relationship:'Other',ped:''}])}
                  className="text-xs text-blue-600 hover:underline">+ Add member</button>
        </div>
      </div>
    </fieldset>
  )
}

function LifeSection({ form, set }) {
  return (
    <fieldset className="border border-purple-200 rounded-xl p-4 space-y-3">
      <legend className="text-xs font-bold text-purple-700 uppercase px-2">🛡️ Life Details</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className="form-label">Sum Assured (₹)</label>
          <input type="number" value={form.sumAssured||''} onChange={e=>set('sumAssured',e.target.value)} className="form-input" /></div>
        <div><label className="form-label">Sub-type</label>
          <select value={form.policySubType||'Term'} onChange={e=>set('policySubType',e.target.value)} className="form-select">
            {LIFE_SUBTYPES.map(t=><option key={t}>{t}</option>)}
          </select></div>
        <div><label className="form-label">PPT — Premium Paying Term (yrs)</label>
          <input type="number" value={form.ppt||''} onChange={e=>set('ppt',e.target.value)} className="form-input" /></div>
        <div><label className="form-label">Policy Term (yrs)</label>
          <input type="number" value={form.policyTerm||''} onChange={e=>set('policyTerm',e.target.value)} className="form-input" /></div>
        <div><label className="form-label">Maturity Date</label>
          <input type="date" value={form.maturityDate||''} onChange={e=>set('maturityDate',e.target.value)} className="form-input" /></div>
        <div><label className="form-label">Surrender Value (₹)</label>
          <input type="number" value={form.surrenderValue||''} onChange={e=>set('surrenderValue',e.target.value)} className="form-input" /></div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
        <p className="col-span-2 text-xs font-semibold text-gray-600">Nominee Details</p>
        <div><label className="form-label">Nominee Name</label>
          <input value={form.nomineeName||''} onChange={e=>set('nomineeName',e.target.value)} className="form-input" /></div>
        <div><label className="form-label">Nominee Relation</label>
          <input value={form.nomineeRelation||''} onChange={e=>set('nomineeRelation',e.target.value)} className="form-input" /></div>
        <div><label className="form-label">Nominee DOB</label>
          <input type="date" value={form.nomineeDob||''} onChange={e=>set('nomineeDob',e.target.value)} className="form-input" /></div>
        <div><label className="form-label">Nominee PAN</label>
          <input value={form.nomineePan||''} onChange={e=>set('nomineePan',e.target.value)} className="form-input" /></div>
        <div><label className="form-label">Appointee (if nominee is minor)</label>
          <input value={form.appointeeName||''} onChange={e=>set('appointeeName',e.target.value)} className="form-input" placeholder="Appointee name" /></div>
        <div><label className="form-label">Appointee Relation</label>
          <input value={form.appointeeRelation||''} onChange={e=>set('appointeeRelation',e.target.value)} className="form-input" /></div>
      </div>
      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={!!form.loanAgainstPolicy} onChange={e=>set('loanAgainstPolicy',e.target.checked)} className="w-4 h-4" />
          Loan Against Policy
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={!!form.smoker} onChange={e=>set('smoker',e.target.checked)} className="w-4 h-4" />
          Smoker
        </label>
      </div>
    </fieldset>
  )
}

function MotorSection({ form, set }) {
  return (
    <fieldset className="border border-orange-200 rounded-xl p-4 space-y-3">
      <legend className="text-xs font-bold text-orange-700 uppercase px-2">🚗 Motor Details</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className="form-label">Vehicle Type</label>
          <select value={form.vehicleType||'4W'} onChange={e=>set('vehicleType',e.target.value)} className="form-select">
            {MOTOR_VEHICLE_TYPES.map(t=><option key={t}>{t}</option>)}
          </select></div>
        <div><label className="form-label">Registration No</label>
          <input value={form.registrationNo||''} onChange={e=>set('registrationNo',e.target.value)} className="form-input" placeholder="GJ-01-AB-1234" /></div>
        <div><label className="form-label">Make (Brand)</label>
          <input value={form.make||''} onChange={e=>set('make',e.target.value)} className="form-input" placeholder="e.g. Maruti" /></div>
        <div><label className="form-label">Model</label>
          <input value={form.model||''} onChange={e=>set('model',e.target.value)} className="form-input" placeholder="e.g. Swift" /></div>
        <div><label className="form-label">Variant</label>
          <input value={form.variant||''} onChange={e=>set('variant',e.target.value)} className="form-input" /></div>
        <div><label className="form-label">Year of Manufacture</label>
          <input type="number" value={form.year||''} onChange={e=>set('year',e.target.value)} className="form-input" placeholder="2022" /></div>
        <div><label className="form-label">Fuel Type</label>
          <select value={form.fuelType||'Petrol'} onChange={e=>set('fuelType',e.target.value)} className="form-select">
            {MOTOR_FUEL_TYPES.map(t=><option key={t}>{t}</option>)}
          </select></div>
        <div><label className="form-label">Engine No</label>
          <input value={form.engineNo||''} onChange={e=>set('engineNo',e.target.value)} className="form-input" /></div>
        <div><label className="form-label">Chassis No</label>
          <input value={form.chassisNo||''} onChange={e=>set('chassisNo',e.target.value)} className="form-input" /></div>
        <div><label className="form-label">Cover Type</label>
          <select value={form.coverType||'Comprehensive'} onChange={e=>set('coverType',e.target.value)} className="form-select">
            {MOTOR_COVER_TYPES.map(t=><option key={t}>{t}</option>)}
          </select></div>
        <div><label className="form-label">IDV — Insured Declared Value (₹)</label>
          <input type="number" value={form.idv||''} onChange={e=>set('idv',e.target.value)} className="form-input" /></div>
        <div><label className="form-label">NCB %</label>
          <select value={form.ncbPct||'0'} onChange={e=>set('ncbPct',e.target.value)} className="form-select">
            {MOTOR_NCB_OPTIONS.map(n=><option key={n}>{n}</option>)}
          </select></div>
      </div>
      {form.coverType !== 'Third Party' && (
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-2">Add-ons</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {ADDONS.map(([k,label])=>(
              <label key={k} className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox"
                       checked={!!(form.addons||{})[k]}
                       onChange={e=>set('addons',{...(form.addons||{}),[k]:e.target.checked})}
                       className="w-4 h-4" />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-6 flex-wrap">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={!!form.isHypothecated} onChange={e=>set('isHypothecated',e.target.checked)} className="w-4 h-4" />
          Hypothecated (Bank/NBFC)
        </label>
      </div>
      {form.isHypothecated && (
        <div><label className="form-label">Hypothecation Bank / NBFC</label>
          <input value={form.hypothecationBank||''} onChange={e=>set('hypothecationBank',e.target.value)} className="form-input" /></div>
      )}
    </fieldset>
  )
}

// ── Policy Form (main) ────────────────────────────────────────
function PolicyForm({ initial, clients: initClients, onSave, onCancel }) {
  const [form, setForm] = useState(() => {
    const base = initial || BASE_EMPTY
    const typeExtras = getTypeDefaults(base.policyType || 'Health')
    return { ...typeExtras, ...base }
  })
  const [saving, setSaving]         = useState(false)
  const [showQA, setShowQA]         = useState(false)
  const [localClients, setLocalClients] = useState(initClients)
  const [pdfUrl,  setPdfUrl]        = useState(initial?.policyPdfUrl  || '')
  const [pdfName, setPdfName]       = useState(initial?.policyPdfName || '')

  const set = (k,v) => setForm(p=>({...p,[k]:v}))

  // When type changes, merge in new type defaults without wiping entered data
  const onTypeChange = newType => {
    const extras = getTypeDefaults(newType)
    setForm(p => ({ ...extras, ...p, policyType: newType }))
  }

  const onClientChange = e => {
    const id = e.target.value
    const cl = localClients.find(c=>c.id===id)
    set('clientId',id); set('clientName',cl?.name||'')
  }
  const onClientCreated = nc => {
    setLocalClients(prev=>[nc,...prev])
    set('clientId',nc.id); set('clientName',nc.name)
    setShowQA(false)
    toast.success(`"${nc.name}" selected!`)
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

  const onSubmit = async e => {
    e.preventDefault()
    if (!form.policyNumber.trim()) { toast.error('Policy Number required'); return }
    if (!form.clientId)            { toast.error('Please select a client'); return }
    if (!form.expiryDate)          { toast.error('Expiry date required');   return }
    setSaving(true)
    try { await onSave({...form, policyPdfUrl:pdfUrl, policyPdfName:pdfName}) }
    finally { setSaving(false) }
  }

  return (
    <>
      {showQA && <QuickAddClientModal onCreated={onClientCreated} onClose={()=>setShowQA(false)} />}
      <form onSubmit={onSubmit} className="space-y-4">
        {/* Base fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {inp('policyNumber','Policy Number *','text',{required:true,placeholder:'ICL-2024-001'})}
          <div>
            <label className="form-label">Client *</label>
            <div className="flex gap-2 items-center">
              <select value={form.clientId||''} onChange={onClientChange} className="form-select flex-1" required>
                <option value="">— Select Client —</option>
                {localClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="button" onClick={()=>setShowQA(true)} title="Add new client"
                      className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-lg font-bold">+</button>
            </div>
          </div>
          {/* Policy Type tabs */}
          <div className="sm:col-span-2">
            <label className="form-label">Policy Type</label>
            <div className="flex gap-2 flex-wrap">
              {TYPES.map(t=>(
                <button key={t} type="button" onClick={()=>onTypeChange(t)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    form.policyType===t?'bg-blue-600 text-white':'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}>{t}</button>
              ))}
            </div>
          </div>
          {inp('insurer','Insurance Company','text',{placeholder:'e.g. ICICI Lombard'})}
          {inp('planName','Plan Name')}
          {inp('premium','Annual Premium (₹)','number')}
          {/* sumAssured only for non-Health/Motor (they have their own) */}
          {!['Health','Life','Motor'].includes(form.policyType) && inp('sumAssured','Sum Insured/Assured (₹)','number')}
          {sel('frequency','Payment Frequency',FREQS)}
          {sel('status','Status',STATUS)}
          {inp('startDate','Start Date','date')}
          {inp('expiryDate','Expiry Date *','date')}
          {inp('nominee','Nominee Name')}
          {inp('nomineeRelation','Nominee Relation')}
        </div>

        {/* Type-specific sections */}
        {form.policyType === 'Health' && <HealthSection form={form} set={set} />}
        {form.policyType === 'Life'   && <LifeSection   form={form} set={set} />}
        {form.policyType === 'Motor'  && <MotorSection  form={form} set={set} />}

        {/* Commission */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-3">💰 Commission Rates</p>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="form-label">FY Commission %</label>
              <input type="number" step="0.01" value={form.fyCommission||''} onChange={e=>set('fyCommission',e.target.value)} className="form-input" />
              <p className="text-xs text-blue-600 mt-1">{form.fyCommission&&form.premium?`= ${fmtCurrency(Math.round(parseFloat(form.premium)*parseFloat(form.fyCommission)/100))}`:'Enter % to see amount'}</p>
            </div>
            <div><label className="form-label">RY Commission %</label>
              <input type="number" step="0.01" value={form.ryCommission||''} onChange={e=>set('ryCommission',e.target.value)} className="form-input" />
              <p className="text-xs text-blue-600 mt-1">{form.ryCommission&&form.premium?`= ${fmtCurrency(Math.round(parseFloat(form.premium)*parseFloat(form.ryCommission)/100))}`:'Enter % to see amount'}</p>
            </div>
          </div>
        </div>

        {/* PDF */}
        <PolicyPdfUpload policyId={initial?.id||null} existingUrl={pdfUrl} existingName={pdfName}
                         onUploaded={(u,n)=>{setPdfUrl(u);setPdfName(n)}} />

        <div><label className="form-label">Notes</label>
          <textarea rows={2} value={form.notes||''} onChange={e=>set('notes',e.target.value)} className="form-input" /></div>
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="btn-primary">{saving?'⏳ Saving…':'💾 Save Policy'}</button>
          <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        </div>
      </form>
    </>
  )
}

// ── Import Modal (same as before, kept intact) ────────────────
function ImportModal({ clients, onClose, onImported }) {
  const fileRef=useRef()
  const [step,setStep]=useState('upload')
  const [rows,setRows]=useState(null)
  const [unmapped,setUnmapped]=useState([])
  const [importing,setImporting]=useState(false)
  const [errors,setErrors]=useState([])
  const onFileChange=async e=>{const file=e.target.files[0];if(!file)return;try{const raw=await parseImportFile(file);setRows(raw);setErrors([])}catch(err){toast.error(err.message)}}
  const onClickImport=()=>{
    if(!rows?.length)return
    const names=[...new Set(rows.map(r=>String(r['Client Name']||r['Client']||'').trim()).filter(Boolean))]
    const unmatched=names.filter(n=>!clients.some(c=>c.name.toLowerCase().trim()===n.toLowerCase()))
    if(unmatched.length>0){setUnmapped(unmatched);setStep('mapping')}else{doImport({})}
  }
  const doImport=async(overrides)=>{
    setImporting(true);const errs=[];let ok=0
    for(const[i,r]of rows.entries()){
      const pNo=String(r['Policy No']||r['Policy Number']||'').trim()
      const eName=String(r['Client Name']||r['Client']||'').trim()
      if(!pNo){errs.push(`Row ${i+2}: Missing Policy No`);continue}
      let mc=clients.find(c=>c.name.toLowerCase().trim()===eName.toLowerCase())
      const ov=overrides[eName];if(!mc&&ov?.id)mc={id:ov.id,name:ov.name}
      const data={policyNumber:pNo,clientId:mc?.id||'',clientName:mc?.name||eName,
        policyType:String(r['Policy Type']||r['Type']||'Health').trim(),
        insurer:String(r['Insurer']||'').trim(),planName:String(r['Plan Name']||r['Plan']||'').trim(),
        premium:String(r['Premium']||'').trim(),sumAssured:String(r['Sum Assured']||'').trim(),
        frequency:String(r['Frequency']||'Yearly').trim(),
        startDate:normaliseDate(r['Start Date']),expiryDate:normaliseDate(r['Expiry Date']),
        status:String(r['Status']||'Active').trim(),nominee:String(r['Nominee']||'').trim(),
        nomineeRelation:String(r['Nominee Relation']||'').trim(),
        fyCommission:String(r['FY Commission %']||r['Commission %']||'').trim(),
        ryCommission:String(r['RY Commission %']||'').trim(),notes:String(r['Notes']||'').trim()}
      try{await addPolicy(data);ok++}catch(err){errs.push(`Row ${i+2} (${pNo}): ${err.message}`)}
    }
    setImporting(false);setErrors(errs)
    if(ok>0){toast.success(`🎉 ${ok} policies imported!`);onImported();if(!errs.length)onClose();else setStep('upload')}
  }
  // Mapping step
  const [resolution,setResolution]=useState({})
  const setRes=(name,val)=>setResolution(p=>({...p,[name]:val}))
  const [saving,setSaving]=useState(false)
  const confirmMapping=async()=>{
    setSaving(true);const map={}
    for(const name of unmapped){
      const res=resolution[name]||{type:'skip'}
      if(res.type==='existing'){map[name]={id:res.clientId,name:res.clientName}}
      else if(res.type==='new'){try{const ref=await addClient({name,mobile:'',email:'',kycStatus:'Pending'});map[name]={id:ref.id,name};toast.success(`"${name}" created`)}catch(err){map[name]={id:'',name}}}
      else{map[name]={id:'',name}}
    }
    setSaving(false);setStep('upload');doImport(map)
  }
  if(step==='mapping')return(
    <div className="space-y-4">
      <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-orange-700">⚠️ {unmapped.length} client names not found</p>
      </div>
      <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
        {unmapped.map(name=>{
          const res=resolution[name]||{type:'skip'}
          return(
            <div key={name} className="border border-gray-200 rounded-xl p-3">
              <p className="text-sm font-semibold mb-2">"{name}"</p>
              <div className="flex gap-2 flex-wrap mb-2">
                <button onClick={()=>setRes(name,{type:'new'})} className={`px-3 py-1 text-xs rounded-lg border ${res.type==='new'?'bg-blue-600 text-white':'bg-white text-blue-600 border-blue-300'}`}>➕ New client</button>
                <button onClick={()=>setRes(name,{type:'skip'})} className={`px-3 py-1 text-xs rounded-lg border ${res.type==='skip'?'bg-gray-500 text-white':'bg-white text-gray-500 border-gray-300'}`}>⏭ Import without</button>
              </div>
              <select value={res.type==='existing'?res.clientId:''} onChange={e=>{const id=e.target.value;if(!id)return;const cl=clients.find(c=>c.id===id);setRes(name,{type:'existing',clientId:id,clientName:cl?.name||name})}} className="form-select text-xs">
                <option value="">— Map to existing client —</option>
                {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )
        })}
      </div>
      <div className="flex gap-3">
        <button onClick={confirmMapping} disabled={saving} className="btn-primary">{saving?'⏳…':'✅ Confirm & Import'}</button>
        <button onClick={()=>setStep('upload')} className="btn-secondary">Back</button>
      </div>
    </div>
  )
  return(
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-blue-700 mb-1">Step 1 — Download template</p>
        <button onClick={()=>downloadTemplate(POLICY_IMPORT_HEADERS,'Policies','policies_import',POLICY_IMPORT_SAMPLE)} className="btn-primary text-sm">⬇ Download Template</button>
      </div>
      <div className="bg-green-50 border border-green-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-green-700 mb-2">Step 2 — Upload filled file</p>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFileChange} className="text-sm" />
        {rows&&<p className="text-xs text-green-700 mt-2 font-medium">✅ {rows.length} rows loaded</p>}
      </div>
      {errors.length>0&&<div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">{errors.map((e,i)=><p key={i}>• {e}</p>)}</div>}
      <div className="flex gap-3">
        <button onClick={onClickImport} disabled={!rows||importing} className="btn-primary">{importing?'⏳…':`✅ Import ${rows?.length||0} Policies`}</button>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function PoliciesPage() {
  const { clients }           = useClients()
  const { policies, loading } = usePolicies()
  const { isAdmin }           = useAuth()
  const [search,     setSearch]     = useState('')
  const [typeFilter, setTypeFilter] = useState('All')
  const [modal,      setModal]      = useState(null)
  const [selected,   setSelected]   = useState(null)
  const [delOpen,    setDelOpen]    = useState(false)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return policies.filter(p => {
      const mQ = !q||p.policyNumber?.toLowerCase().includes(q)||p.clientName?.toLowerCase().includes(q)||p.insurer?.toLowerCase().includes(q)
      const mT = typeFilter==='All'||p.policyType===typeFilter
      return mQ && mT
    })
  }, [policies, search, typeFilter])

  const onAdd    = async form => { await addPolicy(form);                toast.success('Policy added!');   setModal(null) }
  const onEdit   = async form => { await updatePolicy(selected.id,form); toast.success('Policy updated!'); setModal(null) }
  const onDelete = async ()   => { await deletePolicy(selected.id);      toast.success('Policy deleted') }

  if (loading) return (
    <div className="p-8 text-gray-400 flex items-center gap-2">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />Loading policies…
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-gray-900">Policies</h1><p className="text-sm text-gray-500">{policies.length} total</p></div>
        <div className="flex gap-2 flex-wrap">
          {isAdmin&&<button className="btn-secondary" onClick={()=>setModal('import')}>⬆ Import</button>}
          <button className="btn-primary" onClick={()=>{setSelected(null);setModal('add')}}>+ Add Policy</button>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-start sm:items-center">
        <SearchBar value={search} onChange={setSearch} placeholder="Policy No, client, insurer…" />
        <div className="flex gap-1 flex-wrap">
          {['All',...TYPES].map(t=>(
            <button key={t} onClick={()=>setTypeFilter(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${typeFilter===t?'bg-blue-600 text-white':'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>{t}</button>
          ))}
        </div>
        <div className="flex gap-2 ml-auto flex-wrap">
          <button onClick={()=>exportToCSV(filtered,POLICY_COLS,'policies')} className="btn-secondary text-xs">⬇ CSV</button>
          <button onClick={()=>exportToExcel(filtered,POLICY_COLS,'Policies','policies')} className="btn-secondary text-xs">⬇ Excel</button>
          <button onClick={()=>exportToPDF(filtered,POLICY_COLS,'Policy List','policies')} className="btn-secondary text-xs">⬇ PDF</button>
        </div>
      </div>
      <div className="table-container">
        <table className="min-w-full"><thead><tr>
          {['Policy No','Client','Type','Insurer','Premium','Expiry','Days','Yr','Status','FY%','RY%','PDF','Actions'].map(h=>(
            <th key={h} className="table-header">{h}</th>
          ))}
        </tr></thead>
        <tbody className="bg-white">
          {filtered.length===0
            ?<tr><td colSpan={13} className="text-center text-gray-400 py-10">No policies found</td></tr>
            :filtered.map(p=>{
              const st=renewalStatus(p.expiryDate)
              const bm={green:'badge-green',yellow:'badge-yellow',red:'badge-red',blue:'badge-blue',gray:'badge-gray'}
              return(
                <tr key={p.id} className="table-row">
                  <td className="table-cell font-mono text-xs font-semibold">{p.policyNumber}</td>
                  <td className="table-cell font-medium">{p.clientName||'—'}</td>
                  <td className="table-cell"><span className="badge-blue">{p.policyType}</span></td>
                  <td className="table-cell text-xs">{p.insurer}</td>
                  <td className="table-cell">{fmtCurrency(p.premium)}</td>
                  <td className="table-cell">{fmtDate(p.expiryDate)}</td>
                  <td className="table-cell">{daysUntil(p.expiryDate)!==null?`${daysUntil(p.expiryDate)}d`:'—'}</td>
                  <td className="table-cell text-xs text-center text-gray-500">{p.policyYear?`Y${p.policyYear}`:'Y1'}</td>
                  <td className="table-cell"><span className={bm[st.color]||'badge-gray'}>{st.label}</span></td>
                  <td className="table-cell text-xs text-center text-blue-600 font-semibold">{p.fyCommission?`${p.fyCommission}%`:'—'}</td>
                  <td className="table-cell text-xs text-center text-green-600 font-semibold">{p.ryCommission?`${p.ryCommission}%`:'—'}</td>
                  <td className="table-cell text-center">
                    {p.policyPdfUrl?<a href={p.policyPdfUrl} target="_blank" rel="noopener noreferrer" className="px-2 py-1 text-xs bg-indigo-50 text-indigo-700 rounded hover:bg-indigo-100">📄 View</a>:<span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="table-cell">
                    <div className="flex gap-1">
                      <button onClick={()=>{setSelected(p);setModal('edit')}} className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100">Edit</button>
                      {isAdmin&&<button onClick={()=>{setSelected(p);setDelOpen(true)}} className="px-2 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100">Del</button>}
                    </div>
                  </td>
                </tr>
              )
            })
          }
        </tbody></table>
      </div>
      <Modal open={modal==='add'} onClose={()=>setModal(null)} title="Add New Policy" size="xl">
        <PolicyForm clients={clients} onSave={onAdd} onCancel={()=>setModal(null)} />
      </Modal>
      <Modal open={modal==='edit'} onClose={()=>setModal(null)} title="Edit Policy" size="xl">
        {selected&&<PolicyForm initial={selected} clients={clients} onSave={onEdit} onCancel={()=>setModal(null)} />}
      </Modal>
      <Modal open={modal==='import'} onClose={()=>setModal(null)} title="📥 Import Policies" size="lg">
        <ImportModal clients={clients} onClose={()=>setModal(null)} onImported={()=>{}} />
      </Modal>
      <ConfirmDialog open={delOpen} onClose={()=>setDelOpen(false)} onConfirm={onDelete}
                     title="Delete Policy?" message={`Delete "${selected?.policyNumber}"?`} danger />
    </div>
  )
}
