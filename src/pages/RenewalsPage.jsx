// src/pages/RenewalsPage.jsx
import { useState, useMemo } from 'react'
import { usePolicies }  from '../hooks/usePolicies'
import { saveRenewal, getPolicyChain } from '../firebase/firestore'
import { fmtDate, fmtCurrency, daysUntil } from '../utils/dateUtils'
import { exportToCSV, exportToPDF, POLICY_COLS } from '../utils/exportUtils'
import {
  HEALTH_DEFAULTS, LIFE_DEFAULTS, MOTOR_DEFAULTS,
  HEALTH_RELATIONSHIPS, MOTOR_NCB_OPTIONS, MOTOR_COVER_TYPES,
  MOTOR_VEHICLE_TYPES, MOTOR_FUEL_TYPES, LIFE_SUBTYPES
} from '../utils/policySchemas'
import Modal from '../components/ui/Modal'
import toast from 'react-hot-toast'

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

const WA_TEMPLATE = (p) =>
  `Dear ${p.clientName || 'Sir/Madam'},\n\nYour *${p.policyType}* insurance policy ` +
  `(Policy No: *${p.policyNumber}*) with *${p.insurer}* is due for renewal on ` +
  `*${fmtDate(p.expiryDate)}*.\n\n` +
  `💰 Premium: *${fmtCurrency(p.premium)}*\n` +
  `🔁 Frequency: ${p.frequency || 'Yearly'}\n\n` +
  `Please contact us to process the renewal.\n\nRegards,\nHarshdipsinh Gohil\nGohil Investments\n7698997894`

let waTabRef = null
function openWhatsApp(policy, useWeb = false) {
  const phone = (policy.mobile || policy.phone || '').replace(/\D/g, '')
  const msg   = encodeURIComponent(WA_TEMPLATE(policy))
  if (!useWeb) {
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'display:none;width:0;height:0;border:none;'
    iframe.src = phone ? `whatsapp://send?phone=91${phone}&text=${msg}` : `whatsapp://send?text=${msg}`
    document.body.appendChild(iframe)
    setTimeout(() => { try { document.body.removeChild(iframe) } catch(_) {} }, 3000)
    toast.success('Opening WhatsApp Desktop…', { duration:2500 })
    return
  }
  const url = phone
    ? `https://web.whatsapp.com/send?phone=91${phone}&text=${msg}`
    : `https://web.whatsapp.com/send?text=${msg}`
  if (waTabRef && !waTabRef.closed) { waTabRef.location.href = url; waTabRef.focus() }
  else waTabRef = window.open(url, 'gohil_whatsapp')
}

function WhatsAppButton({ policy }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <div className="flex">
        <button onClick={() => { openWhatsApp(policy,false); setOpen(false) }}
                title="Open in WhatsApp Desktop"
                className="px-2 py-1 text-xs bg-green-500 text-white rounded-l hover:bg-green-600">📱 WA</button>
        <button onClick={() => setOpen(p=>!p)}
                className="px-1 py-1 text-xs bg-green-600 text-white rounded-r border-l border-green-400 hover:bg-green-700">▾</button>
      </div>
      {open && (
        <div className="absolute right-0 top-8 z-50 bg-white border border-gray-200 rounded-xl shadow-xl w-56 py-1">
          <button onClick={() => { openWhatsApp(policy,false); setOpen(false) }}
                  className="w-full text-left px-4 py-2.5 text-xs hover:bg-gray-50 flex items-center gap-2">
            <span className="text-base">📱</span>
            <div><p className="font-semibold text-gray-800">WhatsApp Desktop</p><p className="text-gray-400">No new tab</p></div>
          </button>
          <button onClick={() => { openWhatsApp(policy,true); setOpen(false) }}
                  className="w-full text-left px-4 py-2.5 text-xs hover:bg-gray-50 flex items-center gap-2">
            <span className="text-base">🌐</span>
            <div><p className="font-semibold text-gray-800">WhatsApp Web</p><p className="text-gray-400">Reuses 1 tab</p></div>
          </button>
        </div>
      )}
    </div>
  )
}

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

  const getCellColor = (prev, curr) => {
    if (prev === curr) return ''
    // Parse numeric: higher premium = red, higher sum = green
    const pN = parseFloat(String(prev).replace(/[^\d.]/g,''))
    const cN = parseFloat(String(curr).replace(/[^\d.]/g,''))
    if (!isNaN(pN) && !isNaN(cN)) {
      return cN > pN ? 'bg-green-50 text-green-800 font-semibold' : 'bg-red-50 text-red-800 font-semibold'
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
      <div className="overflow-auto rounded-xl border border-gray-200">
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
          <tbody className="bg-white divide-y divide-gray-100">
            {rows.map(([field, prev, curr]) => (
              <tr key={field} className={prev === curr ? '' : 'hover:bg-gray-50'}>
                <td className="table-cell text-gray-500 font-medium">{field}</td>
                <td className={`table-cell ${prev !== curr ? 'line-through text-gray-400' : ''}`}>{prev || '—'}</td>
                <td className={`table-cell ${getCellColor(prev, curr)}`}>{curr || '—'}</td>
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
    // Pre-fill from existing policy. KYC fields are present but non-editable.
    const base = {
      // KYC LOCKED (copied from original, never changed)
      clientId:     policy.clientId,
      clientName:   policy.clientName,
      dob:          policy.dob      || '',
      gender:       policy.gender   || '',
      pan:          policy.pan      || '',
      aadhar:       policy.aadhar   || '',
      // EDITABLE base
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
      // Auto-calc new dates: start = old expiry, new expiry = old expiry + 1yr
      startDate:  policy.expiryDate || '',
      expiryDate: (() => {
        if (!policy.expiryDate) return ''
        const d = new Date(policy.expiryDate)
        d.setFullYear(d.getFullYear() + 1)
        return d.toISOString().split('T')[0]
      })(),
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
  const sel = (k,lbl,options) => (
    <div>
      <label className="form-label">{lbl}</label>
      <select value={form[k]||''} onChange={e=>set(k,e.target.value)} className="form-select">
        {options.map(o=><option key={o}>{o}</option>)}
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
    if (!form.expiryDate) { toast.error('New expiry date is required'); return }
    setSaving(true)
    try {
      await onSave(form)
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
          {inp('insurer','Insurer *','text',{placeholder:'Can change for portability'})}
          {inp('planName','Plan Name')}
          {inp('premium','New Premium (₹)','number')}
          {sel('frequency','Frequency',FREQS)}
          {inp('startDate','New Start Date','date')}
          {inp('expiryDate','New Expiry Date *','date')}
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
            <button type="button" onClick={()=>set('members',[...(form.members||[]),{name:'',dob:'',age:'',relationship:'Other',ped:''}])}
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

// ── Main Page ─────────────────────────────────────────────────
export default function RenewalsPage() {
  const { policies, loading } = usePolicies()
  const [dayWindow, setDayWindow]   = useState(30)
  const [search,    setSearch]      = useState('')
  const [typeTab,   setTypeTab]     = useState('All')
  const [renewModal, setRenewModal] = useState(null)   // policy object
  const [compareModal, setCompareModal] = useState(null) // { current, previous }
  const [loadingChain, setLoadingChain] = useState(false)

  const renewals = useMemo(() => {
    const q = search.toLowerCase()
    return policies.filter(p => {
      const d = daysUntil(p.expiryDate)
      if (d === null) return false
      const inWindow = dayWindow === -1 ? d < 0 : (d < 0 || d <= dayWindow)
      if (!inWindow) return false
      const matchType = typeTab === 'All' || p.policyType === typeTab
      const matchQ = !q ||
        p.clientName?.toLowerCase().includes(q) ||
        p.policyNumber?.toLowerCase().includes(q) ||
        p.insurer?.toLowerCase().includes(q)
      // Only show Active (not already Renewed-Out/Archived)
      return matchType && matchQ && p.status === 'Active'
    }).sort((a,b) => daysUntil(a.expiryDate) - daysUntil(b.expiryDate))
  }, [policies, dayWindow, search, typeTab])

  const types = useMemo(() => {
    const s = new Set(policies.map(p=>p.policyType).filter(Boolean))
    return ['All',...s]
  }, [policies])

  const onSaveRenewal = async (newData) => {
    await saveRenewal(renewModal.id, newData)
    toast.success(`✅ Renewal saved! Policy Year ${(renewModal.policyYear||1)+1} created.`)
    setRenewModal(null)
  }

  const onViewCompare = async (policy) => {
    setLoadingChain(true)
    try {
      const chain = await getPolicyChain(policy.id)
      setCompareModal(chain)
    } catch(err) { toast.error(err.message) }
    finally { setLoadingChain(false) }
  }

  if (loading) return (
    <div className="p-8 text-gray-400 flex items-center gap-2">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      Loading renewals…
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Renewal Tracker</h1>
          <p className="text-sm text-gray-500">{renewals.length} policies · from {policies.length} total</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <button onClick={() => exportToCSV(renewals, POLICY_COLS, 'renewals')} className="btn-secondary text-xs">⬇ CSV</button>
          <button onClick={() => exportToPDF(renewals, POLICY_COLS, 'Renewal List', 'renewals')} className="btn-secondary text-xs">⬇ PDF</button>
        </div>
      </div>

      {/* Summary badges */}
      <div className="flex gap-3 flex-wrap">
        {[
          { label:'Overdue',     color:'bg-red-100 text-red-800',      count: renewals.filter(p=>daysUntil(p.expiryDate)<0).length },
          { label:'Due ≤ 15d',   color:'bg-orange-100 text-orange-800', count: renewals.filter(p=>{const d=daysUntil(p.expiryDate);return d!==null&&d>=0&&d<=15}).length },
          { label:'Due ≤ 30d',   color:'bg-yellow-100 text-yellow-800', count: renewals.filter(p=>{const d=daysUntil(p.expiryDate);return d!==null&&d>=0&&d<=30}).length },
          { label:'Total Shown', color:'bg-blue-100 text-blue-800',     count: renewals.length },
        ].map(b => (
          <div key={b.label} className={`${b.color} rounded-lg px-4 py-2 text-sm font-semibold`}>
            {b.count} {b.label}
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-start sm:items-center">
        <div className="flex gap-1 flex-wrap">
          {WINDOW_OPTIONS.map(w => (
            <button key={w.days} onClick={() => setDayWindow(w.days)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                dayWindow===w.days ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>{w.label}</button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {types.map(t => (
            <button key={t} onClick={() => setTypeTab(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                typeTab===t ? 'bg-green-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>{t}</button>
          ))}
        </div>
        <input type="search" placeholder="Search…" value={search}
               onChange={e=>setSearch(e.target.value)} className="form-input w-52" />
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="min-w-full">
          <thead>
            <tr>
              {['#','Client','Phone','Policy No','Type','Insurer','Premium','Expiry','Yr','Status','Actions'].map(h=>(
                <th key={h} className="table-header">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white">
            {renewals.length === 0
              ? <tr><td colSpan={11} className="text-center py-12 text-gray-400">🎉 No renewals in this window</td></tr>
              : renewals.map((p,i) => (
                <tr key={p.id} className={`table-row ${
                  daysUntil(p.expiryDate)<0   ? 'bg-red-50'    :
                  daysUntil(p.expiryDate)<=15 ? 'bg-orange-50' :
                  daysUntil(p.expiryDate)<=30 ? 'bg-yellow-50' : ''
                }`}>
                  <td className="table-cell text-gray-400">{i+1}</td>
                  <td className="table-cell font-semibold">{p.clientName||'—'}</td>
                  <td className="table-cell text-xs">{p.mobile||p.phone||'—'}</td>
                  <td className="table-cell font-mono text-xs">{p.policyNumber}</td>
                  <td className="table-cell"><span className="badge-blue">{p.policyType}</span></td>
                  <td className="table-cell">{p.insurer}</td>
                  <td className="table-cell">{fmtCurrency(p.premium)}</td>
                  <td className="table-cell">{fmtDate(p.expiryDate)}</td>
                  <td className="table-cell text-center text-xs text-gray-500 font-semibold">
                    {p.policyYear ? `Y${p.policyYear}` : 'Y1'}
                  </td>
                  <td className="table-cell">{statusBadge(daysUntil(p.expiryDate))}</td>
                  <td className="table-cell">
                    <div className="flex gap-1 items-center flex-wrap">
                      <button onClick={() => setRenewModal(p)}
                              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">
                        🔄 Renew
                      </button>
                      <button onClick={() => onViewCompare(p)}
                              disabled={loadingChain}
                              className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
                        {loadingChain ? '…' : '📊 Compare'}
                      </button>
                      <WhatsAppButton policy={p} />
                    </div>
                  </td>
                </tr>
              ))
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
