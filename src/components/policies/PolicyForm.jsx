// src/components/policies/PolicyForm.jsx
// The add/edit policy form, extracted verbatim from PoliciesPage. Includes the
// type-specific sections, the insurer combobox and the quick-add-client overlay,
// none of which is used anywhere else.
import { useState } from 'react'
import toast from 'react-hot-toast'
import { addClient } from '../../firebase/firestore'
import DateInput from '../ui/DateInput'
import PolicyPdfUpload from './PolicyPdfUpload'
import {
  HEALTH_RELATIONSHIPS, MOTOR_NCB_OPTIONS, MOTOR_COVER_TYPES,
  MOTOR_VEHICLE_TYPES, MOTOR_FUEL_TYPES, LIFE_SUBTYPES, getTypeDefaults,
  KNOWN_INSURERS,
} from '../../utils/policySchemas'
import {
  addPolicyCoverageInterval, computeNextPolicyDue, fmtCurrency, fmtDate,
  normaliseFrequency, parseAnyDate, toInputDate,
} from '../../utils/dateUtils'
import {
  TYPES, FREQS, STATUS, ADDONS, BASE_EMPTY, policyDocumentYear,
} from '../../utils/policyImport'

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
          <DateInput value={form.dateOfFirstEntry||''} onChange={v=>set('dateOfFirstEntry',v)} className="form-input" /></div>
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
              <DateInput value={m.dob||''} onChange={v=>{const mb=[...form.members];mb[i]={...mb[i],dob:v};set('members',mb)}} className="form-input text-xs" />
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
          <DateInput value={form.maturityDate||''} onChange={v=>set('maturityDate',v)} className="form-input" /></div>
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
          <DateInput value={form.nomineeDob||''} onChange={v=>set('nomineeDob',v)} className="form-input" /></div>
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


// ── Smart insurer combobox (datalist — supports both select & free-type) ──
function InsurerSelect({ value, onChange }) {
  return (
    <div>
      <input
        list="insurer-options"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="form-input"
        placeholder="Type or select insurer…"
        autoComplete="off"
      />
      <datalist id="insurer-options">
        {KNOWN_INSURERS.map(ins => (
          <option key={ins} value={ins} />
        ))}
      </datalist>
    </div>
  )
}

function PolicyForm({ initial, clients: initClients, onSave, onCancel, onPolicyNumberChange, dupWarning }) {
  const [form, setForm] = useState(() => {
    const base = initial || BASE_EMPTY
    const typeExtras = getTypeDefaults(base.policyType || 'Health')
    // Fix #10: convert any Firestore Timestamps to yyyy-MM-dd strings for date inputs
    const fixDates = (obj) => {
      const fixed = { ...obj }
      const dateFields = ['startDate','expiryDate','nextPremiumDue','maturityDate','tpExpiry','dateOfFirstEntry','dob']
      dateFields.forEach(f => { if (fixed[f]) fixed[f] = toInputDate(fixed[f]) || fixed[f] })
      return fixed
    }
    return fixDates({
      ...typeExtras,
      ...base,
      _clientMobile: base.clientMobile || base._clientMobile || '',
      _clientEmail: base.clientEmail || base._clientEmail || '',
    })
  })
  const [saving, setSaving]         = useState(false)
  const [showQA, setShowQA]         = useState(false)
  const [localClients, setLocalClients] = useState(initClients)
  const [pdfUrl,  setPdfUrl]        = useState(initial?.policyPdfUrl  || '')
  const [pdfName, setPdfName]       = useState(initial?.policyPdfName || '')
  const [pdfMeta, setPdfMeta]       = useState({
    documentYear: initial?.policyPdfYear || policyDocumentYear(initial || form),
    storagePath: initial?.policyPdfStoragePath || '',
    storageBucket: initial?.policyPdfStorageBucket || '',
    storageProvider: initial?.policyPdfStorageProvider || '',
    publicId: initial?.policyPdfPublicId || '',
    resourceType: initial?.policyPdfResourceType || '',
    deleteToken: initial?.policyPdfDeleteToken || '',
  })

  const set = (k,v) => setForm(p=>({...p,[k]:v}))

  const calculateNextDue = (policy) => {
    const isLifePolicy = String(policy.policyType || '').trim().toLowerCase() === 'life'
    if (!isLifePolicy && policy.expiryDate) return toInputDate(policy.expiryDate) || policy.expiryDate || ''
    const start = parseAnyDate(policy.startDate)
    if (!start) return ''
    return toInputDate(computeNextPolicyDue({
      ...policy,
      frequency: normaliseFrequency(policy.frequency || 'Yearly'),
    }))
  }

  const calculateExpiry = (policy) => {
    if (!policy.isMultiYearPolicy || Number(policy.coverageTermYears || 1) <= 1) return policy.expiryDate || ''
    return toInputDate(addPolicyCoverageInterval(policy.startDate, policy))
  }

  const setFrequencyAndDue = (value) => {
    const cleanFrequency = normaliseFrequency(value)
    setForm(p => ({
      ...p,
      frequency: cleanFrequency,
      nextPremiumDue: calculateNextDue({ ...p, frequency: cleanFrequency }) || p.nextPremiumDue || '',
    }))
  }

  const setStartDateAndDue = (value) => {
    setForm(p => {
      const next = { ...p, startDate: value }
      const expiryDate = calculateExpiry(next) || p.expiryDate || ''
      return {
        ...next,
        expiryDate,
        nextPremiumDue: calculateNextDue({ ...next, expiryDate }) || p.nextPremiumDue || '',
      }
    })
  }

  const setExpiryDateAndDue = (value) => {
    setForm(p => {
      const next = { ...p, expiryDate: value }
      const isLifePolicy = String(next.policyType || '').trim().toLowerCase() === 'life'
      return {
        ...next,
        nextPremiumDue: isLifePolicy
          ? (calculateNextDue(next) || p.nextPremiumDue || '')
          : (toInputDate(value) || value || ''),
      }
    })
  }

  const setCoverageTerm = (years) => {
    const coverageTermYears = Number(years || 1)
    setForm(p => {
      const next = {
        ...p,
        coverageTermYears,
        isMultiYearPolicy: coverageTermYears > 1,
        frequency: coverageTermYears > 1 ? 'Yearly' : normaliseFrequency(p.frequency || 'Yearly'),
      }
      const expiryDate = calculateExpiry(next) || p.expiryDate || ''
      return {
        ...next,
        expiryDate,
        nextPremiumDue: calculateNextDue({ ...next, expiryDate }) || p.nextPremiumDue || '',
      }
    })
  }

  // When type changes, merge in new type defaults without wiping entered data
  const onTypeChange = newType => {
    const extras = getTypeDefaults(newType)
    setForm(p => {
      const next = {
        ...extras,
        ...p,
        policyType: newType,
        isMultiYearPolicy: newType === 'Life' ? false : p.isMultiYearPolicy,
        coverageTermYears: newType === 'Life' ? 1 : (p.coverageTermYears || 1),
      }
      return {
        ...next,
        nextPremiumDue: String(newType || '').toLowerCase() === 'life'
          ? (calculateNextDue(next) || p.nextPremiumDue || '')
          : (toInputDate(next.expiryDate) || next.expiryDate || ''),
      }
    })
  }

  const onClientChange = e => {
    const id = e.target.value
    const cl = localClients.find(c=>c.id===id)
    set('clientId',  id)
    set('clientName',cl?.name||'')
    set('_clientMobile', cl?.mobile||'')
    set('_clientEmail',  cl?.email||'')
  }
  const onClientCreated = nc => {
    setLocalClients(prev=>[nc,...prev])
    set('clientId',nc.id); set('clientName',nc.name)
    setShowQA(false)
    toast.success(`"${nc.name}" selected!`)
  }

  const inp = (k,lbl,type='text',opts={}) => (
    <div><label className="form-label">{lbl}</label>
      {type === 'date'
        ? <DateInput value={form[k]||''} onChange={v=>set(k,v)} className="form-input" {...opts} />
        : <input type={type} value={form[k]||''} onChange={e=>set(k,e.target.value)} className="form-input" {...opts} />}
    </div>
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
    if (!form.insurer.trim())      { toast.error('Insurer is required'); return }
    if (!form.startDate)           { toast.error('Start date required'); return }
    if (!form.expiryDate)          { toast.error('Policy end / expiry date required');   return }
    if (new Date(form.expiryDate) <= new Date(form.startDate)) {
      toast.error('Policy end / expiry date must be after start date'); return
    }
    if (form.nextPremiumDue && Number.isNaN(new Date(form.nextPremiumDue).getTime())) {
      toast.error('Premium due / renewal date must be valid'); return
    }
    const due = parseAnyDate(form.nextPremiumDue)
    const expiry = parseAnyDate(form.expiryDate)
    const isLifePolicy = String(form.policyType || '').trim().toLowerCase() === 'life'
    if (!isLifePolicy && form.isMultiYearPolicy) {
      const years = Number(form.coverageTermYears || 1)
      if (!Number.isInteger(years) || years < 2 || years > 5) {
        toast.error('Multi-year policy term must be between 2 and 5 years.'); return
      }
    }
    if (!isLifePolicy && due && expiry && due > expiry) {
      toast.error('For non-life policies, premium due cannot be after policy expiry. Please renew the policy instead.'); return
    }
    if (!form.premium || Number(form.premium) <= 0) {
      toast.error('Premium must be greater than zero'); return
    }
    if (form.fyCommission && (Number(form.fyCommission) < 0 || Number(form.fyCommission) > 100)) {
      toast.error('FY commission must be between 0 and 100'); return
    }
    if (form.ryCommission && (Number(form.ryCommission) < 0 || Number(form.ryCommission) > 100)) {
      toast.error('RY commission must be between 0 and 100'); return
    }
    setSaving(true)
    const selectedClient = localClients.find(c => c.id === form.clientId)
    // Strip UI-only fields, then save a denormalized contact snapshot for renewal rows.
    const { _clientMobile: _cm, _clientEmail: _ce, ...cleanForm } = form
    cleanForm.clientMobile = selectedClient?.mobile || _cm || form.clientMobile || ''
    cleanForm.clientEmail = selectedClient?.email || _ce || form.clientEmail || ''
    // Normalise frequency before saving
    if (cleanForm.frequency) cleanForm.frequency = normaliseFrequency(cleanForm.frequency)
    cleanForm.coverageTermYears = Number(cleanForm.coverageTermYears || 1)
    cleanForm.isMultiYearPolicy = !isLifePolicy && cleanForm.coverageTermYears > 1
    if (!isLifePolicy) cleanForm.nextPremiumDue = toInputDate(cleanForm.expiryDate) || cleanForm.expiryDate
    try { await onSave({
      ...cleanForm,
      policyPdfUrl: pdfUrl,
      policyPdfName: pdfName,
      policyPdfYear: pdfMeta.documentYear || policyDocumentYear(form),
      policyPdfStoragePath: pdfMeta.storagePath || null,
      policyPdfStorageBucket: pdfMeta.storageBucket || null,
      policyPdfStorageProvider: pdfMeta.storageProvider || null,
      policyPdfPublicId: pdfMeta.publicId || null,
      policyPdfResourceType: pdfMeta.resourceType || null,
      policyPdfDeleteToken: pdfMeta.deleteToken || null,
    }) }
    finally { setSaving(false) }
  }

  return (
    <>
      {showQA && <QuickAddClientModal onCreated={onClientCreated} onClose={()=>setShowQA(false)} />}
      <form onSubmit={onSubmit} className="gi-fixed-action-form">
        <div className="gi-fixed-action-form-body space-y-4">
        {/* Base fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {inp('policyNumber','Policy Number *','text',{
            required:true,
            placeholder:'ICL-2024-001',
            onBlur: e => onPolicyNumberChange?.(e.target.value),
          })}
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
          {/* Client contact info — shown after client is selected */}
          {form.clientId && (
            <div className={`sm:col-span-2 rounded-xl px-4 py-3 text-xs flex items-center gap-4 flex-wrap
              ${(!form._clientMobile && !form._clientEmail)
                ? 'bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800'
                : 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'}`}>
              <span className="font-semibold text-gray-700 dark:text-gray-300">📞</span>
              {form._clientMobile
                ? <span className="text-green-700 dark:text-green-300 font-semibold">{form._clientMobile}</span>
                : <span className="text-orange-600 dark:text-orange-400 font-semibold">⚠️ No mobile — WhatsApp won&apos;t work. <a href="/clients" target="_blank" className="underline">Add in Clients page</a></span>}
              <span className="font-semibold text-gray-400">|</span>
              <span className="font-semibold text-gray-700 dark:text-gray-300">✉️</span>
              {form._clientEmail
                ? <span className="text-green-700 dark:text-green-300">{form._clientEmail}</span>
                : <span className="text-gray-400 dark:text-gray-500">No email on file</span>}
            </div>
          )}
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
          <div>
            <label className="form-label">Insurance Company</label>
            <InsurerSelect value={form.insurer||''} onChange={v=>set('insurer',v)} />
          </div>
          {inp('planName','Plan Name')}
          {inp('premium','Annual Premium (₹)','number')}
          {/* sumAssured only for non-Health/Motor (they have their own) */}
          {!['Health','Life','Motor'].includes(form.policyType) && inp('sumAssured','Sum Insured/Assured (₹)','number')}
          <div>
            <label className="form-label">Payment Frequency</label>
            <select value={form.frequency || 'Yearly'} onChange={e=>setFrequencyAndDue(e.target.value)} className="form-select">
              {FREQS.map(o=><option key={o}>{o}</option>)}
            </select>
          </div>
          {String(form.policyType || '').toLowerCase() !== 'life' && (
            <div>
              <label className="form-label">Policy Coverage Term</label>
              <select
                value={String(form.isMultiYearPolicy ? form.coverageTermYears || 2 : 1)}
                onChange={e => setCoverageTerm(e.target.value)}
                className="form-select"
              >
                <option value="1">Single year</option>
                <option value="2">Multi-year - 2 years</option>
                <option value="3">Multi-year - 3 years</option>
                <option value="4">Multi-year - 4 years</option>
                <option value="5">Multi-year - 5 years</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Use this when one payment covers multiple years. Renewal will appear after this term.
              </p>
            </div>
          )}
          {sel('status','Status',STATUS)}
          <div>
            <label className="form-label">Start Date</label>
            <DateInput value={form.startDate||''} onChange={setStartDateAndDue} className="form-input" />
          </div>
          <div>
            <label className="form-label">Policy End / Expiry Date *</label>
            <DateInput value={form.expiryDate||''} onChange={setExpiryDateAndDue} className="form-input" />
          </div>
          <div>
            <label className="form-label">Premium Due / Renewal Date</label>
            <DateInput value={form.nextPremiumDue||''} onChange={v=>set('nextPremiumDue',v)} className="form-input" />
            <p className="text-xs text-gray-500 mt-1">
              Auto-calculated from start date and frequency. Change it manually if the insurer schedule is different.
            </p>
          </div>
          {inp('nominee','Nominee Name')}
          {inp('nomineeRelation','Nominee Relation')}
        </div>

        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-3 text-sm">
          <p className="font-semibold text-emerald-800 dark:text-emerald-200">Premium due confirmation</p>
          <p className="text-emerald-700 dark:text-emerald-300 text-xs mt-1">
            {form.policyType || 'Policy'} · {normaliseFrequency(form.frequency || 'Yearly')} · Next due: {fmtDate(form.nextPremiumDue)}
          </p>
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
        <PolicyPdfUpload
          policyId={initial?.id||null}
          policyType={form.policyType}
          documentYear={pdfMeta.documentYear || policyDocumentYear(form)}
          existingUrl={pdfUrl}
          existingName={pdfName}
          existingStoragePath={pdfMeta.storagePath}
          existingStorageBucket={pdfMeta.storageBucket}
          existingStorageProvider={pdfMeta.storageProvider}
          existingPublicId={pdfMeta.publicId}
          existingResourceType={pdfMeta.resourceType}
          existingDeleteToken={pdfMeta.deleteToken}
          onUploaded={(u,n,meta)=>{setPdfUrl(u);setPdfName(n);setPdfMeta({
            documentYear: meta?.documentYear || policyDocumentYear(form),
            storagePath: meta?.storagePath || '',
            storageBucket: meta?.storageBucket || '',
            storageProvider: meta?.storageProvider || '',
            publicId: meta?.publicId || '',
            resourceType: meta?.resourceType || '',
            deleteToken: meta?.deleteToken || '',
          })}}
        />

        <div><label className="form-label">Notes</label>
          <textarea rows={2} value={form.notes||''} onChange={e=>set('notes',e.target.value)} className="form-input" /></div>
        </div>
        <div className="gi-mobile-form-actions flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="btn-primary">{saving?'⏳ Saving…':'💾 Save Policy'}</button>
          <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        </div>
      </form>
    </>
  )
}

export default PolicyForm
