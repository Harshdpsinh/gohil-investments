// src/pages/RenewalsPage.jsx
import { useState, useMemo, useRef, useEffect } from 'react'

// Mock dependencies for the preview environment to prevent compilation errors
const usePolicies = () => ({ policies: [], loading: false })
const useClients = () => ({ clients: [] })
const saveRenewal = async () => {}
const getPolicyChain = async () => null
const fmtDate = (d) => d ? String(d) : ''
const fmtCurrency = (c) => `₹${c || 0}`
const daysUntil = () => 10
const parseAnyDate = (d) => d ? new Date(d) : null
const toInputDate = (d) => d ? new Date(d).toISOString().split('T')[0] : ''
const daysUntilPremium = () => 10
const normaliseFrequency = () => 1
const frequencyDays = () => 365
const exportToCSV = () => {}
const exportToPDF = async () => {}
const POLICY_COLS = []
const HEALTH_DEFAULTS = {}
const LIFE_DEFAULTS = {}
const MOTOR_DEFAULTS = {}
const HEALTH_RELATIONSHIPS = ['Self', 'Spouse', 'Child', 'Parent']
const MOTOR_NCB_OPTIONS = ['0', '20', '25', '35', '45', '50']
const MOTOR_COVER_TYPES = ['Comprehensive', 'Third Party']

const Modal = ({ open, onClose, title, children, size = 'lg' }) => {
  const sizeClass = size === 'sm' ? 'max-w-sm' : size === 'md' ? 'max-w-lg' : size === 'xl' ? 'max-w-4xl' : 'max-w-2xl'
  return open ? (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className={`bg-white dark:bg-gray-800 p-6 rounded-xl w-full ${sizeClass} max-h-[90vh] overflow-auto`}>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">{title}</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-800">✕</button>
      </div>
      {children}
    </div>
  </div>
) : null
}
const toast = { success: console.log, error: console.error }
const KNOWN_INSURERS = ['LIC', 'HDFC Life', 'Star Health', 'Tata AIG', 'ICICI Lombard']

function InsurerSelect({ value, onChange }) {
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState(value || '')
  const ref = useRef(null)

  useEffect(() => { setQuery(value || '') }, [value])
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = query.length >= 1
    ? KNOWN_INSURERS.filter(i => i.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : KNOWN_INSURERS.slice(0, 8)

  return (
    <div ref={ref} className="relative">
      <input
        type="text" value={query} className="form-input"
        placeholder="Type or select insurer…"
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto">
          {filtered.map(ins => (
            <li key={ins}
                className="px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-800 dark:text-gray-200"
                onMouseDown={() => { onChange(ins); setQuery(ins); setOpen(false) }}>
              {ins}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const WINDOW_OPTIONS = [
  { label:'Overdue',    days:-1   },
  { label:'7 days',     days:7    },
  { label:'15 days',    days:15   },
  { label:'30 days',    days:30   },
  { label:'60 days',    days:60   },
  { label:'90 days',    days:90   },
  { label:'All Active', days:9999 },
]

const FREQS   = ['Yearly','Half-Yearly','Quarterly','Monthly']
const ADDONS  = [
  ['zeroDep','Zero Dep'],['engineProtect','Engine Protect'],['rsa','RSA'],
  ['keyReplace','Key Replace'],['consumables','Consumables'],
  ['returnToInvoice','Return to Invoice'],['tyreProtect','Tyre Protect'],
  ['personalAccident','Personal Accident'],
]

function statusBadge(days) {
  if (days === null) return <span className="badge-gray">Unknown</span>
  if (days < 0)      return <span className="badge-red">⚠ {Math.abs(days)}d Overdue</span>
  if (days === 0)    return <span className="badge-red">Due TODAY</span>
  if (days <= 15)    return <span className="badge-red">🔴 {days}d</span>
  if (days <= 30)    return <span className="badge-yellow">🟡 {days}d</span>
  return                    <span className="badge-blue">🔵 {days}d</span>
}

// WhatsApp message built inline inside openWhatsApp (uses clientMap lookup)

// ── Comparison Panel ──────────────────────────────────────────
function ComparisonPanel({ current, previous, onClose }) {
  if (!previous) return (
    <div className="p-6 text-center text-gray-400">
      <p className="text-2xl mb-2">📄</p>
      <p>This is the first year policy — no previous version to compare.</p>
      <button onClick={onClose} className="btn-secondary mt-4">Close</button>
    </div>
  )

  const rows = [
    ['Policy No',     previous.policyNumber,                    current.policyNumber],
    ['Insurer',       previous.insurer,                         current.insurer],
    ['Plan Name',     previous.planName,                        current.planName],
    ['Premium',       fmtCurrency(previous.premium),            fmtCurrency(current.premium)],
    ['Sum Insured',   fmtCurrency(previous.sumAssured || previous.sumInsured), fmtCurrency(current.sumAssured || current.sumInsured)],
    ['Frequency',     previous.frequency,                       current.frequency],
    ['Start Date',    fmtDate(previous.startDate),              fmtDate(current.startDate)],
    ['Expiry Date',   fmtDate(previous.expiryDate),             fmtDate(current.expiryDate)],
    ['FY Commission', previous.fyCommission ? `${previous.fyCommission}%` : '—', current.fyCommission ? `${current.fyCommission}%` : '—'],
    ['RY Commission', previous.ryCommission ? `${previous.ryCommission}%` : '—', current.ryCommission ? `${current.ryCommission}%` : '—'],
    ['Policy Year',   `Year ${previous.policyYear || 1}`,       `Year ${current.policyYear || 1}`],
    // Health
    ...(current.policyType === 'Health' ? [
      ['Cumulative Bonus', fmtCurrency(previous.cumulativeBonus), fmtCurrency(current.cumulativeBonus)],
      ['Room Rent Limit',  previous.roomRentLimit || '—',          current.roomRentLimit || '—'],
      ['Co-pay %',         previous.coPay ? `${previous.coPay}%` : '—', current.coPay ? `${current.coPay}%` : '—'],
      ['Restore Benefit',  previous.restoreBenefit ? 'Yes' : 'No', current.restoreBenefit ? 'Yes' : 'No'],
      ['Portability',      previous.isPortability ? `Yes (${previous.prevInsurer||''})` : 'No', current.isPortability ? `Yes (${current.prevInsurer||''})` : 'No'],
    ] : []),
    // Motor
    ...(current.policyType === 'Motor' ? [
      ['IDV',     fmtCurrency(previous.idv),  fmtCurrency(current.idv)],
      ['NCB %',   `${previous.ncbPct||0}%`,   `${current.ncbPct||0}%`],
      ['Cover',   previous.coverType || '—',  current.coverType || '—'],
    ] : []),
    // Life
    ...(current.policyType === 'Life' ? [
      ['Sum Assured', fmtCurrency(previous.sumAssured), fmtCurrency(current.sumAssured)],
      ['PPT',         previous.ppt ? `${previous.ppt}yr` : '—', current.ppt ? `${current.ppt}yr` : '—'],
      ['Policy Term', previous.policyTerm ? `${previous.policyTerm}yr` : '—', current.policyTerm ? `${current.policyTerm}yr` : '—'],
    ] : []),
  ]

  // Fields where a higher value is GOOD (green) vs BAD (red)
  const HIGHER_IS_GOOD = new Set(['Sum Insured','Sum Assured','IDV','Cumulative Bonus','FY Commission','RY Commission','NCB %','Policy Year'])

  const getCellColor = (field, prev, curr) => {
    if (prev === curr) return ''
    const pN = parseFloat(String(prev).replace(/[^\d.]/g,''))
    const cN = parseFloat(String(curr).replace(/[^\d.]/g,''))
    if (!isNaN(pN) && !isNaN(cN)) {
      const improved = HIGHER_IS_GOOD.has(field) ? cN > pN : cN < pN
      return improved ? 'bg-green-50 text-green-800 font-semibold' : 'bg-red-50 text-red-800 font-semibold'
    }
    return 'bg-yellow-50 text-yellow-800 font-semibold'
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <span className="w-3 h-3 rounded bg-green-200 inline-block"></span> Improved
          <span className="w-3 h-3 rounded bg-red-200 inline-block ml-2"></span> Reduced
          <span className="w-3 h-3 rounded bg-yellow-200 inline-block ml-2"></span> Changed
          <span className="w-3 h-3 rounded bg-gray-100 inline-block ml-2"></span> Same
        </div>
      </div>
      <div className="overflow-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="table-header">Field</th>
              <th className="table-header bg-red-50">
                ⬅ Previous (Year {previous.policyYear || 1}) · {previous.insurer}
                <div className="text-xs font-normal text-gray-400">{fmtDate(previous.startDate)} – {fmtDate(previous.expiryDate)}</div>
              </th>
              <th className="table-header bg-green-50">
                ➡ Current (Year {current.policyYear || 1}) · {current.insurer}
                <div className="text-xs font-normal text-gray-400">{fmtDate(current.startDate)} – {fmtDate(current.expiryDate)}</div>
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
            {rows.map(([field, prev, curr]) => (
              <tr key={field} className={prev === curr ? '' : 'hover:bg-gray-50'}>
                <td className="table-cell text-gray-500 font-medium">{field}</td>
                <td className={`table-cell ${prev !== curr ? 'line-through text-gray-400' : ''}`}>{prev || '—'}</td>
                <td className={`table-cell ${getCellColor(field, prev, curr)}`}>{curr || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={onClose} className="btn-secondary">Close</button>
    </div>
  )
}

// ── Renewal Form (Locked-KYC) ─────────────────────────────────
function RenewalForm({ policy, onSave, onCancel }) {
  const [form, setForm] = useState(() => {
    // 1. Compute robust dates for the new term
    const freqNum = normaliseFrequency(policy.frequency || 'Yearly')
    const intervalDays = frequencyDays(freqNum)
    const baseDate = parseAnyDate(policy.expiryDate) || parseAnyDate(policy.startDate)
    
    let newStart = ''
    let newExpiry = ''
    let newNextDue = ''
    
    if (baseDate) {
      newStart = toInputDate(baseDate)
      
      // Expiry is typically +1 year. 
      const expiry = new Date(baseDate)
      expiry.setFullYear(expiry.getFullYear() + 1)
      newExpiry = toInputDate(expiry)
      
      // Next Premium Due is start date + payment frequency interval
      const nextDue = new Date(baseDate.getTime() + intervalDays * 86400000)
      newNextDue = toInputDate(nextDue)
    }

    const base = {
      // KYC LOCKED (copied from original, never changed)
      clientId:     policy.clientId,
      clientName:   policy.clientName,
      dob:          policy.dob      || '',
      gender:       policy.gender   || '',
      pan:          policy.pan      || '',
      aadhar:       policy.aadhar   || '',
      // EDITABLE base
      policyNumber: policy.policyNumber  || '',
      policyType:   policy.policyType,
      insurer:      policy.insurer       || '',
      planName:     policy.planName      || '',
      premium:      policy.premium       || '',
      frequency:    policy.frequency     || 'Yearly',
      fyCommission: policy.fyCommission  || '',
      ryCommission: policy.ryCommission  || '',
      nominee:      policy.nominee       || '',
      nomineeRelation: policy.nomineeRelation || '',
      notes:        policy.notes         || '',
      // Pre-calculated Dates
      startDate:      newStart,
      expiryDate:     newExpiry,
      nextPremiumDue: newNextDue,
    }
    // Merge type-specific fields from old policy
    const typeFields = ['Health','Life','Motor'].includes(policy.policyType)
      ? Object.fromEntries(
          Object.keys(
            policy.policyType === 'Health' ? HEALTH_DEFAULTS :
            policy.policyType === 'Life'   ? LIFE_DEFAULTS   : MOTOR_DEFAULTS
          ).map(k => [k, policy[k] ?? (
            policy.policyType === 'Health' ? HEALTH_DEFAULTS[k] :
            policy.policyType === 'Life'   ? LIFE_DEFAULTS[k]   : MOTOR_DEFAULTS[k]
          )])
        )
      : {}
    return { ...base, ...typeFields }
  })
  
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setForm(p=>({...p,[k]:v}))

  const inp = (k,lbl,type='text',opts={}) => (
    <div>
      <label className="form-label">{lbl}</label>
      <input type={type} value={form[k]||''} onChange={e=>set(k,e.target.value)} className="form-input" {...opts} />
    </div>
  )
  const sel = (k,lbl,options=[]) => (
    <div>
      <label className="form-label">{lbl}</label>
      <select value={form[k]||''} onChange={e=>set(k,e.target.value)} className="form-select">
        {options.map(o=><option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
  const locked = (k,lbl) => (
    <div>
      <label className="form-label flex items-center gap-1">{lbl} <span className="text-xs text-red-500">🔒</span></label>
      <div className="form-input bg-gray-100 text-gray-500 cursor-not-allowed">{form[k]||'—'}</div>
    </div>
  )

  const onSubmit = async () => {
    if (!form.policyNumber) { toast.error('Policy Number is required'); return }
    if (!form.expiryDate) { toast.error('New expiry date is required'); return }
    setSaving(true)
    try {
      // Ensure missing dates don't wipe out firestore fields silently, 
      // replace undefined with empty string to force overwrite the old values.
      const payload = { ...form }
      if (payload.nextPremiumDue === undefined) payload.nextPremiumDue = ''
      await onSave(payload)
    } catch(err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-5">
      {/* KYC LOCKED banner */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2 text-xs text-red-700">
        <span className="text-base">🔒</span>
        <div>
          <p className="font-semibold">KYC fields are locked for data integrity.</p>
          <p>Name, DOB, PAN and Aadhar cannot be changed during renewal. Edit the Client record if a correction is needed.</p>
        </div>
      </div>

      {/* LOCKED SECTION */}
      <fieldset className="border border-red-200 rounded-xl p-4 bg-red-50/30">
        <legend className="text-xs font-bold text-red-600 uppercase px-2">🔒 KYC Details (Read-Only)</legend>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-2">
          {locked('clientName','Client Name')}
          {locked('dob','Date of Birth')}
          {locked('gender','Gender')}
          {locked('pan','PAN')}
          {locked('aadhar','Aadhar')}
        </div>
      </fieldset>

      {/* EDITABLE SECTION */}
      <fieldset className="border border-blue-200 rounded-xl p-4">
        <legend className="text-xs font-bold text-blue-700 uppercase px-2">✏️ Editable — Policy Details</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
          {inp('policyNumber','Policy Number *')}
          <div>
            <label className="form-label">Insurer *</label>
            <InsurerSelect value={form.insurer||''} onChange={v=>set('insurer',v)} />
          </div>
          {inp('planName','Plan Name')}
          {inp('premium','New Premium (₹)','number')}
          
          {/* Smart Frequency — Auto computes Next Premium Due */}
          <div>
            <label className="form-label">Frequency</label>
            <select value={form.frequency||''} onChange={e => {
               const val = e.target.value;
               setForm(prev => {
                  const updates = { frequency: val };
                  const baseDate = parseAnyDate(prev.startDate);
                  if (baseDate) {
                     const freqNum = normaliseFrequency(val);
                     const intervalDays = frequencyDays(freqNum);
                     const nextDue = new Date(baseDate.getTime() + intervalDays * 86400000);
                     updates.nextPremiumDue = toInputDate(nextDue);
                  }
                  return { ...prev, ...updates };
               })
            }} className="form-select">
              {FREQS.map(o=><option key={o}>{o}</option>)}
            </select>
          </div>

          {/* Smart Start Date — Auto computes Expiry and Next Premium Due */}
          <div>
            <label className="form-label">New Start Date</label>
            <input type="date" value={form.startDate||''} onChange={e => {
               const val = e.target.value;
               setForm(prev => {
                  const updates = { startDate: val };
                  const baseDate = parseAnyDate(val);
                  if (baseDate) {
                     const expiry = new Date(baseDate);
                     expiry.setFullYear(expiry.getFullYear() + 1);
                     updates.expiryDate = toInputDate(expiry);
                     
                     const freqNum = normaliseFrequency(prev.frequency || 'Yearly');
                     const intervalDays = frequencyDays(freqNum);
                     const nextDue = new Date(baseDate.getTime() + intervalDays * 86400000);
                     updates.nextPremiumDue = toInputDate(nextDue);
                  }
                  return { ...prev, ...updates };
               })
            }} className="form-input" />
          </div>

          {inp('expiryDate','New Expiry Date *','date')}
          {inp('nextPremiumDue','Next Premium Due','date')}
          {inp('fyCommission','FY Commission %','number')}
          {inp('ryCommission','RY Commission %','number')}
          {inp('nominee','Nominee Name')}
          {inp('nomineeRelation','Nominee Relation')}
        </div>
      </fieldset>

      {/* TYPE-SPECIFIC EDITABLE */}
      {form.policyType === 'Health' && (
        <fieldset className="border border-green-200 rounded-xl p-4">
          <legend className="text-xs font-bold text-green-700 uppercase px-2">🏥 Health — Editable</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            {inp('sumInsured','Sum Insured (₹)','number')}
            {inp('cumulativeBonus','Cumulative Bonus (₹)','number')}
            {inp('cumulativeBonusPct','Cumulative Bonus %','number')}
            {inp('roomRentLimit','Room Rent Limit (₹/day or No Limit)')}
            {inp('coPay','Co-pay %','number')}
            {inp('dateOfFirstEntry','Date of First Entry','date')}
          </div>
          <div className="flex gap-6 mt-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={!!form.restoreBenefit} onChange={e=>set('restoreBenefit',e.target.checked)} className="w-4 h-4" />
              Restore Benefit
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={!!form.isPortability} onChange={e=>set('isPortability',e.target.checked)} className="w-4 h-4" />
              Portability (changing insurer)
            </label>
          </div>
          {form.isPortability && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3 p-3 bg-yellow-50 rounded-lg">
              {inp('prevInsurer','Previous Insurer')}
              {inp('prevPolicyNo','Previous Policy No')}
              {inp('portabilityNCB','NCB/CB Carried Forward (₹)','number')}
            </div>
          )}
          {/* Members */}
          <p className="text-xs font-semibold text-gray-600 mt-4 mb-2">Members Covered</p>
          <div className="space-y-2">
            {(form.members||[]).map((m,i) => (
              <div key={i} className="grid grid-cols-5 gap-2">
                <input value={m.name||''} onChange={e=>{const mb=[...form.members];mb[i]={...mb[i],name:e.target.value};set('members',mb)}} placeholder="Name" className="form-input text-xs col-span-1" />
                <input value={m.age||''} onChange={e=>{const mb=[...form.members];mb[i]={...mb[i],age:e.target.value};set('members',mb)}} placeholder="Age" className="form-input text-xs" type="number" />
                <input value={m.dob||''} onChange={e=>{const mb=[...form.members];mb[i]={...mb[i],dob:e.target.value};set('members',mb)}} className="form-input text-xs" type="date" />
                <select value={m.relationship||'Self'} onChange={e=>{const mb=[...form.members];mb[i]={...mb[i],relationship:e.target.value};set('members',mb)}} className="form-select text-xs">
                  {HEALTH_RELATIONSHIPS.map(r=><option key={r}>{r}</option>)}
                </select>
                <input value={m.ped||''} onChange={e=>{const mb=[...form.members];mb[i]={...mb[i],ped:e.target.value};set('members',mb)}} placeholder="PED (e.g. Diabetes)" className="form-input text-xs" />
              </div>
            ))}
            <button type="button" onClick={()=>set('members',[...(form.members||[]),{name:'',dob:'',age:'',relationship:'Self',ped:''}])}
                    className="text-xs text-blue-600 hover:underline">+ Add member</button>
          </div>
        </fieldset>
      )}

      {form.policyType === 'Motor' && (
        <fieldset className="border border-orange-200 rounded-xl p-4">
          <legend className="text-xs font-bold text-orange-700 uppercase px-2">🚗 Motor — Editable</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            {sel('coverType','Cover Type',MOTOR_COVER_TYPES)}
            {inp('idv','IDV — Insured Declared Value (₹)','number')}
            {sel('ncbPct','NCB %',MOTOR_NCB_OPTIONS)}
            {sel('prevNcbPct','Previous NCB %',MOTOR_NCB_OPTIONS)}
          </div>
          {form.coverType !== 'Third Party' && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-gray-600 mb-2">Add-ons</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {ADDONS.map(([k,label])=>(
                  <label key={k} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox"
                           checked={!!(form.addons||{})[k]}
                           onChange={e=>set('addons',{...(form.addons||{}), [k]:e.target.checked})}
                           className="w-4 h-4" />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </fieldset>
      )}

      {form.policyType === 'Life' && (
        <fieldset className="border border-purple-200 rounded-xl p-4">
          <legend className="text-xs font-bold text-purple-700 uppercase px-2">🛡️ Life — Editable</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            {inp('sumAssured','Sum Assured (₹)','number')}
            {inp('ppt','PPT — Premium Paying Term (yrs)','number')}
            {inp('nomineeName','Nominee Name')}
            {inp('nomineeRelation','Nominee Relation')}
            {inp('surrenderValue','Current Surrender Value (₹)','number')}
          </div>
        </fieldset>
      )}

      <div>
        <label className="form-label">Notes</label>
        <textarea rows={2} value={form.notes||''} onChange={e=>set('notes',e.target.value)} className="form-input" />
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={onSubmit} disabled={saving} className="btn-primary">
          {saving ? '⏳ Saving renewal…' : '✅ Save Renewal (New Policy Year)'}
        </button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  )
}

// ── Moved to module scope — never changes, no reason to rebuild each render ──
const CATEGORY_MAP = {
  'Health':  ['Health'],
  'Life':    ['Life'],
  'Motor':   ['Motor'],
  'General': ['Home','Travel','Marine','Fire','Other'],
}

// getDays: also at module scope so useMemo deps are stable
function getDays(p) {
  if (!p) return null
  if (p.nextPremiumDue) {
    const d = new Date(p.nextPremiumDue)
    if (!isNaN(d.getTime())) return Math.ceil((d - new Date()) / (1000 * 60 * 60 * 24))
  }
  if (p.startDate) {
    const days = daysUntilPremium(p.startDate, p.frequency)
    if (days !== null) return days
  }
  return daysUntil(p.expiryDate)
}

// ── Main Page ─────────────────────────────────────────────────
export default function RenewalsPage() {
  const { policies, loading } = usePolicies()
  const { clients }           = useClients()
  const [dayWindow,    setDayWindow]    = useState(30)
  const [search,       setSearch]       = useState('')
  const [categoryTab,  setCategoryTab]  = useState('All')  // All / Health / Life / Motor / General
  const [renewModal,   setRenewModal]   = useState(null)
  const [compareModal, setCompareModal] = useState(null)
  const [loadingChain, setLoadingChain] = useState(false)
  const [selectedIds,  setSelectedIds]  = useState(new Set())
  const [bulkWAOpen,   setBulkWAOpen]   = useState(false)

  // Build client mobile lookup map
  const clientMap = useMemo(() => {
    const m = {}
    clients.forEach(c => { m[c.id] = c })
    return m
  }, [clients])

  const renewals = useMemo(() => {
    const q = search.toLowerCase()

    return policies.filter(p => {
      const d = getDays(p)
      if (d === null || isNaN(d)) return false
      // Hide if lapsed more than 90 days ago — beyond actionable range
      if (d < -90) return false
      // Show: lapsed within last 30 days (d between -30 and 0)
      //    OR: upcoming within the selected window (d between 0 and dayWindow)
      const inWindow = dayWindow === -1
        ? (d < 0)                    // "Overdue" button — show only lapsed
        : (d < 0 || d <= dayWindow)  // any window — show lapsed + upcoming
      if (!inWindow) return false
      const matchCat  = categoryTab === 'All' || (CATEGORY_MAP[categoryTab]||[]).includes(p.policyType)
      const matchQ    = !q || p.clientName?.toLowerCase().includes(q) ||
                              p.policyNumber?.toLowerCase().includes(q) ||
                              p.insurer?.toLowerCase().includes(q)
      // Only hide policies that are already Renewed-Out
      // Lapsed/Cancelled/Matured policies MUST show so agent can take action
      const st = (p.status || '').trim()
      return matchCat && matchQ && st !== 'Renewed-Out'
    }).sort((a,b) => (getDays(a)||0) - (getDays(b)||0))
  }, [policies, dayWindow, search, categoryTab])

  // Count per category for badges
  const categoryCounts = useMemo(() => {
    const base = policies.filter(p => {
      const d = getDays(p)
      if (d === null || isNaN(d)) return false
      const st2 = (p.status || '').trim()
      return (dayWindow === -1 ? d < 0 : (d < 0 || d <= dayWindow)) && st2 !== 'Renewed-Out'
    })
    return {
      All:     base.length,
      Health:  base.filter(p => p.policyType === 'Health').length,
      Life:    base.filter(p => p.policyType === 'Life').length,
      Motor:   base.filter(p => p.policyType === 'Motor').length,
      General: base.filter(p => ['Home','Travel','Marine','Fire','Other'].includes(p.policyType)).length,
    }
  }, [policies, dayWindow])

  // Bulk select
  const allIds  = renewals.map(p => p.id)
  const allSel  = allIds.length > 0 && allIds.every(id => selectedIds.has(id))
  const someSel = allIds.some(id => selectedIds.has(id))
  const toggleOne = id => setSelectedIds(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n })
  const toggleAll = () => {
    if (allSel) setSelectedIds(prev => { const n=new Set(prev); allIds.forEach(id=>n.delete(id)); return n })
    else        setSelectedIds(prev => { const n=new Set(prev); allIds.forEach(id=>n.add(id)); return n })
  }
  const clearSel = () => setSelectedIds(new Set())

  // Get mobile from client record
  const getClientMobile = (policy) => {
    // Try 1: lookup by clientId (most reliable)
    let client = clientMap[policy.clientId]
    // Try 2: if clientId blank/wrong, match by name
    if (!client?.mobile && policy.clientName) {
      client = clients.find(c =>
        c.name.toLowerCase().trim() === (policy.clientName||'').toLowerCase().trim()
      )
    }
    return (client?.mobile || policy.mobile || policy.phone || '').replace(/\D/g,'')
  }

  // WhatsApp single
  const openWhatsApp = (policy) => {
    const mobile = getClientMobile(policy)
    if (!mobile) { toast.error('No mobile number for this client — add it in the Clients page'); return }
    const days = policy.nextPremiumDue ? Math.ceil((new Date(policy.nextPremiumDue) - new Date()) / 86400000) : daysUntil(policy.expiryDate)
    const msg = encodeURIComponent(
      `Dear ${policy.clientName},\n\nYour *${policy.policyType} Insurance* policy is due for renewal${days !== null && days >= 0 ? ` in *${days} days*` : ' — it has expired'}.\n\n📋 Policy No: ${policy.policyNumber}\n🏢 Insurer: ${policy.insurer}\n📅 Expiry: ${fmtDate(policy.expiryDate)}\n💰 Premium: ₹${Number(policy.premium||0).toLocaleString('en-IN')}\n\nPlease contact us to renew at the earliest.\n\n*Gohil Investments*
Wealth Management & Insurance Advisory
📞 *Harshdipsinh Gohil* — 7698997894
📞 Pradipsinh Gohil — 9426204547
📍 Bhavnagar, Gujarat`
    )
    window.open(`https://wa.me/91${mobile}?text=${msg}`, '_blank')
  }

  const onSaveRenewal = async (newData) => {
    const nextYear = (renewModal.policyYear || 1) + 1
    await saveRenewal(renewModal.id, { ...newData, policyYear: nextYear })
    toast.success(`✅ Renewal saved! Policy Year ${nextYear} created.`)
    setRenewModal(null)
  }

  const onViewCompare = async (policy) => {
    setLoadingChain(true)
    try { const chain = await getPolicyChain(policy.id); setCompareModal(chain) }
    catch(err) { toast.error(err.message) }
    finally { setLoadingChain(false) }
  }

  if (loading) return (
    <div className="p-8 text-gray-400 dark:text-gray-500 flex items-center gap-2">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      Loading renewals…
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Renewal Tracker</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{renewals.length} policies · from {policies.length} total</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <button onClick={() => exportToCSV(renewals, POLICY_COLS, 'renewals')} className="btn-secondary text-xs">⬇ CSV</button>
          <button onClick={async() => await exportToPDF(renewals, POLICY_COLS, 'Renewal List', 'renewals')} className="btn-secondary text-xs">⬇ PDF</button>
        </div>
      </div>

      {/* Summary badges */}
      <div className="flex gap-3 flex-wrap">
        {[
          { label:'Overdue',     color:'bg-red-100 text-red-800',      count: renewals.filter(p=>getDays(p)<0).length },
          { label:'Due ≤ 15d',   color:'bg-orange-100 text-orange-800', count: renewals.filter(p=>{const d=getDays(p);return d!==null&&d>=0&&d<=15}).length },
          { label:'Due ≤ 30d',   color:'bg-yellow-100 text-yellow-800', count: renewals.filter(p=>{const d=getDays(p);return d!==null&&d>=0&&d<=30}).length },
          { label:'Total Shown', color:'bg-blue-100 text-blue-800',     count: renewals.length },
        ].map(b => (
          <div key={b.label} className={`${b.color} rounded-lg px-4 py-2 text-sm font-semibold`}>
            {b.count} {b.label}
          </div>
        ))}
      </div>

      {/* Category tabs — Health / Life / Motor / General / All */}
      <div className="flex gap-1 flex-wrap border-b border-gray-200 dark:border-gray-700 pb-1">
        {[
          { key:'All',     label:'All',     icon:'📋' },
          { key:'Health',  label:'Health',  icon:'🏥' },
          { key:'Life',    label:'Life',    icon:'🛡️' },
          { key:'Motor',   label:'Motor',   icon:'🚗' },
          { key:'General', label:'General', icon:'🏠' },
        ].map(({ key, label, icon }) => (
          <button key={key} onClick={() => setCategoryTab(key)}
                  className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-t-lg transition-colors border-b-2
                    ${categoryTab===key
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
            {icon} {label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold
              ${categoryTab===key ? 'bg-blue-100 text-blue-700 dark:bg-blue-800 dark:text-blue-200' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
              {categoryCounts[key] || 0}
            </span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-start sm:items-center">
        <div className="flex gap-1 flex-wrap">
          {WINDOW_OPTIONS.map(w => (
            <button key={w.days} onClick={() => setDayWindow(w.days)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                dayWindow===w.days ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}>{w.label}</button>
          ))}
        </div>
        <input type="search" placeholder="Search client, policy, insurer…" value={search}
               onChange={e=>setSearch(e.target.value)} className="form-input w-60" />
      </div>

      {/* Bulk WhatsApp bar */}
      {someSel && (
        <div className="flex items-center gap-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3">
          <span className="text-sm font-semibold text-green-700 dark:text-green-300">{selectedIds.size} policies selected</span>
          <button onClick={() => setBulkWAOpen(true)}
                  className="px-4 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700">
            📱 WhatsApp All Selected
          </button>
          <button onClick={clearSel}
                  className="px-3 py-1.5 bg-white dark:bg-gray-700 border border-green-200 text-green-700 dark:text-green-300 text-xs font-semibold rounded-lg">
            ✕ Clear
          </button>
        </div>
      )}

      {/* Bulk WhatsApp info modal */}
      <Modal open={bulkWAOpen} onClose={() => setBulkWAOpen(false)} title="📱 Bulk WhatsApp Renewal Reminders" size="md">
        <div className="space-y-4">
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-green-700 dark:text-green-300">
              Send renewal reminders to {selectedIds.size} clients
            </p>
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">
              Each WhatsApp will open separately in a new tab. Allow popups if blocked.
            </p>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {renewals.filter(p => selectedIds.has(p.id)).map(p => (
              <div key={p.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{p.clientName}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{p.policyNumber} · {fmtDate(p.expiryDate)} · 📱 {getClientMobile(p)||'No mobile'}</p>
                </div>
                <button onClick={() => openWhatsApp(p)} className="btn-whatsapp text-xs">📱 Send</button>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => {
              renewals.filter(p => selectedIds.has(p.id)).forEach((p, i) => {
                setTimeout(() => openWhatsApp(p), i * 500)
              })
              setBulkWAOpen(false)
              clearSel()
            }} className="btn-success">📱 Send All ({selectedIds.size})</button>
            <button onClick={() => setBulkWAOpen(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      </Modal>

      {/* Table */}
      <div className="table-container">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className="table-header w-10">
                <input type="checkbox" checked={allSel} onChange={toggleAll} className="w-4 h-4 cursor-pointer" />
              </th>
              {['#','Client','Phone','Policy No','Type','Insurer','Premium','Next Due','Expiry','Yr','Status'].map(h=>(
                <th key={h} className="table-header">{h}</th>
              ))}
              <th className="table-header sticky right-0 z-20 bg-gray-50 dark:bg-gray-900 shadow-[-4px_0_8px_rgba(0,0,0,0.06)]">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800">
            {renewals.length === 0
              ? <tr><td colSpan={13} className="text-center py-12 text-gray-400 dark:text-gray-500">🎉 No renewals in this window</td></tr>
              : renewals.map((p,i) => {
                const d = getDays(p)   // compute once per row
                const mobile = getClientMobile(p)  // compute once per row
                return (
                <tr key={p.id} className={`table-row ${selectedIds.has(p.id) ? 'bg-blue-50 dark:bg-blue-900/20' :
                  d<0   ? 'bg-red-50 dark:bg-red-900/10'    :
                  d<=15 ? 'bg-orange-50 dark:bg-orange-900/10' :
                  d<=30 ? 'bg-yellow-50 dark:bg-yellow-900/10' : ''
                }`}>
                  <td className="table-cell">
                    <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleOne(p.id)} className="w-4 h-4 cursor-pointer" />
                  </td>
                  <td className="table-cell text-gray-400 dark:text-gray-500">{i+1}</td>
                  <td className="table-cell font-semibold">{p.clientName||'—'}</td>
                  <td className="table-cell text-xs">{mobile
                      ? mobile
                      : <span className="text-orange-500 dark:text-orange-400 font-semibold" title="Add mobile in Clients page">⚠️ No mobile</span>}</td>
                  <td className="table-cell font-mono text-xs">{p.policyNumber}</td>
                  <td className="table-cell"><span className="badge-blue">{p.policyType}</span></td>
                  <td className="table-cell">{p.insurer}</td>
                  <td className="table-cell">{fmtCurrency(p.premium)}</td>
                  <td className="table-cell font-semibold text-blue-700 dark:text-blue-400">
                    {p.nextPremiumDue ? fmtDate(p.nextPremiumDue) : fmtDate(p.expiryDate)}
                  </td>
                  <td className="table-cell text-xs text-gray-400 dark:text-gray-500">{fmtDate(p.expiryDate)}</td>
                  <td className="table-cell text-center text-xs text-gray-500 dark:text-gray-400 font-semibold">
                    {p.policyYear ? `Y${p.policyYear}` : 'Y1'}
                  </td>
                  <td className="table-cell">{statusBadge(d)}</td>
                  <td className="table-cell sticky right-0 bg-white dark:bg-gray-800 shadow-[-4px_0_8px_rgba(0,0,0,0.04)]">
                    <div className="flex gap-1 items-center flex-nowrap">
                      <button onClick={() => setRenewModal(p)}
                              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 whitespace-nowrap">
                        🔄 Renew
                      </button>
                      <button onClick={() => onViewCompare(p)}
                              disabled={loadingChain}
                              className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600">
                        {loadingChain ? '…' : '📊'}
                      </button>
                      <button onClick={() => openWhatsApp(p)} className="btn-whatsapp">📱</button>
                    </div>
                  </td>
                </tr>
              )})
            }
          </tbody>
        </table>
      </div>

      {/* Renewal Modal */}
      <Modal open={!!renewModal} onClose={() => setRenewModal(null)}
             title={`🔄 Renew Policy — ${renewModal?.policyNumber}`} size="xl">
        {renewModal && (
          <RenewalForm
            policy={renewModal}
            onSave={onSaveRenewal}
            onCancel={() => setRenewModal(null)}
          />
        )}
      </Modal>

      {/* Comparison Modal */}
      <Modal open={!!compareModal} onClose={() => setCompareModal(null)}
             title="📊 Policy Comparison — Old vs New" size="xl">
        {compareModal && (
          <ComparisonPanel
            current={compareModal.current}
            previous={compareModal.previous}
            onClose={() => setCompareModal(null)}
          />
        )}
      </Modal>
    </div>
  )
}