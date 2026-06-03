// src/pages/PoliciesPage.jsx
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { useClients }  from '../hooks/useClients'
import { usePolicies } from '../hooks/usePolicies'
import { useAuth }     from '../hooks/useAuth'
import {
  addPolicy, updatePolicy, deletePolicy, addClient,
  importPoliciesBatch,
  savePolicyPdfUrl, bulkDeletePolicies, checkDuplicatePolicyNumber, checkDuplicate, cascadeUpdateClient,
  getDeletedPolicies, restorePolicy, permanentDeletePolicy,
  subscribeProposals, updateProposal, findClientByMobileOrName,
} from '../firebase/firestore'
import { deletePolicyPdfByPath, getDownloadUrl, getPreviewUrl, uploadPolicyPdf } from '../firebase/storage'
import {
  HEALTH_DEFAULTS, LIFE_DEFAULTS, MOTOR_DEFAULTS,
  HEALTH_RELATIONSHIPS, MOTOR_NCB_OPTIONS, MOTOR_COVER_TYPES,
  MOTOR_VEHICLE_TYPES, MOTOR_FUEL_TYPES, LIFE_SUBTYPES,
  getTypeDefaults
} from '../utils/policySchemas'
import Modal        from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import SearchBar    from '../components/ui/SearchBar'
import DateInput    from '../components/ui/DateInput'
import { addPolicyCoverageInterval, computeNextPolicyDue, fmtDate, fmtCurrency, daysUntil, getDueDate as getPolicyDueDate, renewalStatus, toInputDate, normaliseFrequency, parseAnyDate } from '../utils/dateUtils'
import {
  exportToCSV, exportToExcel, exportToPDF, POLICY_COLS,
  downloadTemplate, parseImportFile, normaliseDate,
  HEALTH_IMPORT_HEADERS, HEALTH_IMPORT_SAMPLE, parseHealthRow,
  LIFE_IMPORT_HEADERS,   LIFE_IMPORT_SAMPLE,   parseLifeRow,
  MOTOR_IMPORT_HEADERS,  MOTOR_IMPORT_SAMPLE,  parseMotorRow,
} from '../utils/exportUtils'
import { openWhatsAppApiLink, openWhatsAppLink } from '../services/whatsappService'
import toast from 'react-hot-toast'

// ── Fuzzy match (Levenshtein distance) ───────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({length: m+1}, (_,i) => Array.from({length: n+1}, (_,j) => j === 0 ? i : 0))
  for (let j = 1; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}
function fuzzyMatch(input, candidates, threshold = 0.75) {
  // Returns candidates with similarity > threshold
  const a = input.toLowerCase().trim()
  return candidates
    .map(c => {
      const b = (c.name || '').toLowerCase().trim()
      const maxLen = Math.max(a.length, b.length)
      if (maxLen === 0) return null
      const sim = 1 - levenshtein(a, b) / maxLen
      return sim >= threshold ? { ...c, similarity: sim } : null
    })
    .filter(Boolean)
    .sort((x,y) => y.similarity - x.similarity)
    .slice(0, 3)
}

const TYPES  = ['Health','Life','Motor','Home','Travel','Marine','Fire','Other']
const FREQS  = ['Yearly','Half-Yearly','Quarterly','Monthly']
const STATUS = ['Active','Lapsed','Cancelled','Matured','Renewed-Out']
const POLICY_PAGE_SIZE = 50
const ADDONS = [
  ['zeroDep','Zero Dep'],['engineProtect','Engine Protect'],['rsa','RSA'],
  ['keyReplace','Key Replace'],['consumables','Consumables'],
  ['returnToInvoice','Return to Invoice'],['tyreProtect','Tyre Protect'],
  ['personalAccident','Personal Accident'],
]

const BASE_EMPTY = {
  policyNumber:'', clientId:'', clientName:'', policyType:'Health',
  insurer:'', planName:'', premium:'', sumAssured:'', frequency:'Yearly',
  isMultiYearPolicy:false, coverageTermYears:1,
  startDate:'', expiryDate:'', nextPremiumDue:'', status:'Active',
  nominee:'', nomineeRelation:'',
  fyCommission:'', ryCommission:'', notes:''
}

function proposalToPolicyInitial(proposal, clients = []) {
  if (!proposal) return null
  const client = clients.find(c => c.id === proposal.clientId)
  const policyType = TYPES.includes(proposal.policyType) ? proposal.policyType : 'Health'
  const mobile = proposal.mobile || client?.mobile || ''
  const email = proposal.email || client?.email || ''
  const base = {
    ...BASE_EMPTY,
    ...getTypeDefaults(policyType),
    policyType,
    clientId: proposal.clientId || '',
    clientName: proposal.clientName || proposal.proposerName || client?.name || '',
    clientMobile: mobile,
    clientEmail: email,
    _clientMobile: mobile,
    _clientEmail: email,
    insurer: proposal.insurer || '',
    planName: proposal.planName || '',
    premium: proposal.premium || '',
    frequency: normaliseFrequency(proposal.frequency || 'Yearly'),
    sumAssured: proposal.sumAssured || '',
    sumInsured: proposal.sumAssured || proposal.sumInsured || '',
    nominee: proposal.nomineeName || '',
    nomineeRelation: proposal.nomineeRelation || '',
    policyTerm: proposal.policyTerm || '',
    proposalId: proposal.id || '',
    source: 'proposal',
    notes: proposal.notes ? `Converted from proposal: ${proposal.notes}` : 'Converted from proposal',
  }
  if (policyType === 'Health') {
    base.members = proposal.members?.length ? proposal.members : base.members
    base.planType = proposal.planType || base.planType || ''
    base.pastOperation = proposal.pastOperation || ''
    base.existingIllness = proposal.existingIllness || ''
  }
  if (policyType === 'Life') {
    base.height = proposal.height || ''
    base.weight = proposal.weight || ''
    base.motherName = proposal.motherName || ''
    base.familyIllness = proposal.familyIllness || ''
  }
  return base
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
function PolicyPdfUpload({ policyId, existingUrl, existingName, onUploaded = () => {}, compact = false }) {
  const fileRef = useRef()
  const [progress, setProgress]   = useState(null)
  const [uploading, setUploading] = useState(false)

  const onFileChange = async e => {
    const file = e.target.files[0]
    if (!file) return
    if (!policyId) {
      toast.error('First save the policy, then use Upload PDF from the policy row or edit screen.')
      return
    }

    setUploading(true)
    setProgress(0)
    try {
      const { url, name, storagePath } = await uploadPolicyPdf(policyId, file, p => setProgress(p))
      await savePolicyPdfUrl(policyId, url, name, storagePath)
      toast.success('PDF uploaded')
      onUploaded(url, name)
    } catch(err) {
      const message = err?.code === 'storage/unauthorized'
        ? 'PDF upload blocked by Firebase Storage rules. Deploy storage.rules, then try again.'
        : err?.code === 'storage/quota-exceeded'
          ? 'Firebase Storage quota is full. Free space or upgrade the plan.'
          : err?.message || 'PDF upload failed. Please try again.'
      toast.error(message)
    } finally {
      setUploading(false)
      setProgress(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (!policyId) return (
    <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-3 text-xs text-gray-400 text-center">
      Save policy first, then attach PDF from the policy row.
    </div>
  )

  if (compact) {
    return (
      <div className="flex items-center justify-center gap-1 min-w-[190px]">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={onFileChange}
          disabled={uploading}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="px-2 py-1 text-xs bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded hover:bg-indigo-100 disabled:opacity-60"
        >
          {uploading ? `Uploading ${progress || 0}%` : existingUrl ? 'Replace PDF' : 'Upload PDF'}
        </button>
        {existingUrl && (
          <>
            <a href={getPreviewUrl(existingUrl)} target="_blank" rel="noopener noreferrer" className="px-2 py-1 text-xs bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100">View</a>
            <a href={getDownloadUrl(existingUrl, existingName)} download={existingName || 'policy.pdf'} className="px-2 py-1 text-xs bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-100">Download</a>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-2">
      <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">Policy Document (PDF)</p>
      {existingUrl && (
        <div className="flex items-center gap-2 bg-white border border-indigo-200 rounded-lg px-3 py-2">
          <a href={getPreviewUrl(existingUrl)} target="_blank" rel="noopener noreferrer"
             className="text-xs text-indigo-700 font-medium hover:underline flex-1 truncate">{existingName || 'View PDF'}</a>
          <a href={getDownloadUrl(existingUrl, existingName)} download={existingName || 'policy.pdf'}
             className="text-xs text-blue-600 font-semibold hover:underline">Download</a>
          <span className="text-xs text-green-600 font-semibold">Stored</span>
        </div>
      )}
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={onFileChange} disabled={uploading}
             className="text-xs cursor-pointer file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-indigo-100 file:text-indigo-700" />
      {uploading && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-indigo-600"><span>Uploading...</span><span>{progress}%</span></div>
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

// ── Known insurers list (built-in — no external import needed) ──
const KNOWN_INSURERS = [
  // General / Health
  'Star Health and Allied Insurance',
  'New India Assurance',
  'National Insurance',
  'United India Insurance',
  'Oriental Insurance',
  'HDFC ERGO General Insurance',
  'ICICI Lombard General Insurance',
  'Bajaj Allianz General Insurance',
  'Reliance General Insurance',
  'Royal Sundaram General Insurance',
  'Niva Bupa Health Insurance',
  'Aditya Birla Health Insurance',
  'Care Health Insurance',
  'ManipalCigna Health Insurance',
  'SBI General Insurance',
  'Tata AIG General Insurance',
  'Cholamandalam MS General Insurance',
  'Future Generali India Insurance',
  'Iffco Tokio General Insurance',
  'Kotak Mahindra General Insurance',
  'Liberty General Insurance',
  'Magma HDI General Insurance',
  'Raheja QBE General Insurance',
  'Universal Sompo General Insurance',
  // Life
  'LIC of India',
  'HDFC Life Insurance',
  'ICICI Prudential Life Insurance',
  'SBI Life Insurance',
  'Max Life Insurance',
  'Bajaj Allianz Life Insurance',
  'Kotak Mahindra Life Insurance',
  'Aditya Birla Sun Life Insurance',
  'Tata AIA Life Insurance',
  'PNB MetLife India Insurance',
  'Pramerica Life Insurance',
  'IndiaFirst Life Insurance',
  'Edelweiss Tokio Life Insurance',
  'Canara HSBC Life Insurance',
]

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

  const set = (k,v) => setForm(p=>({...p,[k]:v}))

  const calculateNextDue = (policy) => {
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
    setForm(p => ({
      ...extras,
      ...p,
      policyType: newType,
      isMultiYearPolicy: newType === 'Life' ? false : p.isMultiYearPolicy,
      coverageTermYears: newType === 'Life' ? 1 : (p.coverageTermYears || 1),
    }))
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
    try { await onSave({...cleanForm, policyPdfUrl:pdfUrl, policyPdfName:pdfName}) }
    finally { setSaving(false) }
  }

  return (
    <>
      {showQA && <QuickAddClientModal onCreated={onClientCreated} onClose={()=>setShowQA(false)} />}
      <form onSubmit={onSubmit} className="space-y-4">
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
                : <span className="text-orange-600 dark:text-orange-400 font-semibold">⚠️ No mobile — WhatsApp won't work. <a href="/clients" target="_blank" className="underline">Add in Clients page</a></span>}
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
          {inp('expiryDate','Policy End / Expiry Date *','date')}
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
              <p className="text-sm font-semibold text-gray-800 mb-2">"{name}"</p>
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

  // ── Pre-flight scan: find dups + lapsed before importing ────
  const preflight = async (overrides, autoCreate) => {
    // Note: setPreflighting(true) is called by onClickImport before this
    // to lock the button immediately on first click
    try {
    const today = new Date()
    const dups = [], lapses = []

    for (const [i, r] of rows.entries()) {
      let data
      try { data = parseRow(r) }
      catch (err) { setErrors([`Row ${i + 2}: ${err.message}`]); throw err }
      const pNo  = data.policyNumber
      if (!pNo) continue

      // Comprehensive duplicate check: policy number + registration + client+premium+insurer
      const dupResult = await checkDuplicate({
        policyNumber:   pNo,
        clientName:     data.clientName,
        premium:        data.premium,
        insurer:        data.insurer,
        registrationNo: data.registrationNo,
      })
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

      if (!mc && autoCreate && eName) {
        if (autoCreated[eName.toLowerCase()]) {
          mc = autoCreated[eName.toLowerCase()]
        } else {
          try {
            const ref = await addClient({ name: eName, mobile: data.clientMobile || '', email: data.clientEmail || '', kycStatus: 'Pending' })
            mc = { id: ref.id, name: eName, mobile: data.clientMobile || '', email: data.clientEmail || '' }
            autoCreated[eName.toLowerCase()] = mc
          } catch(err) {
            errs.push(`Row ${i+2}: Could not create client "${eName}" - ${err.message}`)
            continue
          }
        }
      }

      data.clientId   = mc?.id   || ''
      data.clientName = mc?.name || eName
      data.clientMobile = data.clientMobile || mc?.mobile || ''
      data.clientEmail  = data.clientEmail  || mc?.email  || ''

      if (mc?.id) {
        const needsUpdate = {}
        const existingMobile = String(mc.mobile || '').replace(/\D/g, '').slice(-10)
        const importedMobile = String(data.clientMobile || '').replace(/\D/g, '').slice(-10)
        if (importedMobile && existingMobile !== importedMobile) needsUpdate.mobile = data.clientMobile
        if (data.clientEmail && String(mc.email || '').trim().toLowerCase() !== String(data.clientEmail).trim().toLowerCase()) needsUpdate.email = data.clientEmail
        if (Object.keys(needsUpdate).length > 0) {
          try {
            await cascadeUpdateClient(mc.id, needsUpdate)
            mc = { ...mc, ...needsUpdate }
          } catch(err) {
            errs.push(`Row ${i+2}: Could not update mobile/email for "${data.clientName}" - ${err.message}`)
          }
        }
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
                    <input type="date" value={choice.newStart||''}
                           onChange={e => setChoice({ newStart: e.target.value })}
                           disabled={reviewSubmitting || importing}
                           className="form-input text-sm" />
                  </div>
                  <div>
                    <label className="form-label">New Expiry Date *</label>
                    <input type="date" value={choice.newExpiry||''}
                           onChange={e => setChoice({ newExpiry: e.target.value })}
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
              ? 'Client names in your file will be matched automatically. New names not found in your database will be created as new clients instantly — no manual mapping needed.'
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


// ── Recycle Bin Modal ─────────────────────────────────────────
function RecycleBinModal({ onClose, fmtDate, fmtCurrency }) {
  const [deleted,    setDeleted]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [restoring,  setRestoring]  = useState(null)   // id being restored
  const [permDel,    setPermDel]    = useState(null)   // id staged for permanent delete
  const [permDeling, setPermDeling] = useState(false)
  const [emptying,   setEmptying]   = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const rows = await getDeletedPolicies()
      // Sort most recently deleted first
      rows.sort((a, b) => {
        const da = a.deletedAt?.toDate?.() || new Date(a.deletedAt || 0)
        const db_ = b.deletedAt?.toDate?.() || new Date(b.deletedAt || 0)
        return db_ - da
      })
      setDeleted(rows)
    } catch(err) {
      toast.error('Could not load recycle bin: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const onRestore = async (id) => {
    setRestoring(id)
    try {
      await restorePolicy(id)
      toast.success('✅ Policy restored!')
      setDeleted(prev => prev.filter(p => p.id !== id))
    } catch(err) {
      toast.error('Restore failed: ' + err.message)
    } finally {
      setRestoring(null)
    }
  }

  const onPermanentDelete = async () => {
    if (!permDel) return
    setPermDeling(true)
    try {
      const policy = deleted.find(p => p.id === permDel)
      await deletePolicyPdfByPath(policy?.policyPdfStoragePath)
      await permanentDeletePolicy(permDel)
      toast.success('Policy permanently deleted')
      setDeleted(prev => prev.filter(p => p.id !== permDel))
      setPermDel(null)
    } catch(err) {
      toast.error('Failed: ' + err.message)
    } finally {
      setPermDeling(false)
    }
  }

  const onEmptyRecycleBin = async () => {
    if (deleted.length === 0) return
    if (!window.confirm(`Permanently delete ${deleted.length} old deleted polic${deleted.length === 1 ? 'y' : 'ies'}? This cannot be undone.`)) return
    setEmptying(true)
    try {
      await Promise.all(deleted.map(async p => {
        await deletePolicyPdfByPath(p.policyPdfStoragePath)
        await permanentDeletePolicy(p.id)
      }))
      toast.success('Recycle bin emptied')
      setDeleted([])
    } catch(err) {
      toast.error('Could not empty recycle bin: ' + (err.message || 'Unknown error'))
    } finally {
      setEmptying(false)
    }
  }

  const fmtDeletedAt = (ts) => {
    if (!ts) return '—'
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts)
      return `${fmtDate(d)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    } catch { return '—' }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">🗑️ Recycle Bin — Deleted Policies</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Restore accidentally deleted policies or permanently remove them.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {deleted.length > 0 && (
              <button
                type="button"
                onClick={onEmptyRecycleBin}
                disabled={emptying}
                className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60"
              >
                {emptying ? 'Deleting...' : 'Empty Recycle Bin'}
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">?</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center gap-2 text-gray-400 py-8 justify-center">
              <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              Loading deleted policies…
            </div>
          ) : deleted.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">✅</p>
              <p className="font-semibold text-gray-700 dark:text-gray-300">Recycle bin is empty</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">No deleted policies found.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {deleted.map(p => (
                <div key={p.id}
                     className="flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
                  <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-5 gap-x-4 gap-y-0.5 text-sm">
                    <div className="sm:col-span-2">
                      <p className="font-semibold text-gray-800 dark:text-gray-200 truncate">{p.clientName || '—'}</p>
                      <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{p.policyNumber}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Insurer</p>
                      <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{p.insurer || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Premium</p>
                      <p className="text-xs font-medium text-blue-600 dark:text-blue-400">{fmtCurrency(p.premium)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Deleted on</p>
                      <p className="text-xs font-medium text-red-600 dark:text-red-400">{fmtDeletedAt(p.deletedAt)}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => onRestore(p.id)}
                      disabled={restoring === p.id}
                      className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      {restoring === p.id ? '⏳' : '♻️ Restore'}
                    </button>
                    <button
                      onClick={() => setPermDel(p.id)}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      🗑️ Delete Forever
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Permanent delete confirmation */}
        {permDel && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40" onClick={() => setPermDel(null)} />
            <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
              <h4 className="text-base font-bold text-gray-900 dark:text-white">⚠️ Permanent Delete</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                This will <strong>permanently delete</strong> the policy from Firestore. This <strong>cannot be undone</strong>.
              </p>
              <div className="flex gap-3">
                <button type="button" onClick={onPermanentDelete} disabled={permDeling}
                        className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">
                  {permDeling ? '⏳ Deleting…' : '🗑️ Yes, Delete Forever'}
                </button>
                <button type="button" onClick={() => setPermDel(null)} className="btn-secondary">Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function PoliciesPage() {
  const { clients }           = useClients()
  const { policies, loading } = usePolicies()
  const { isAdmin }           = useAuth()
  const location              = useLocation()
  const [search,      setSearch]      = useState('')
  const [typeFilter,  setTypeFilter]  = useState('All')
  const [modal,       setModal]       = useState(null)
  const [selected,    setSelected]    = useState(null)
  const [delOpen,     setDelOpen]     = useState(false)
  // Bulk delete
  const [selectedIds,  setSelectedIds]  = useState(new Set())
  const [bulkDelOpen,  setBulkDelOpen]  = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showRecycleBin, setShowRecycleBin] = useState(false)
  const [showRenewed,    setShowRenewed]    = useState(false)
  const [whatsAppMenu,   setWhatsAppMenu]   = useState(null)
  const [proposals,      setProposals]      = useState([])
  const [proposalPrefill,setProposalPrefill]= useState(null)
  const [page,           setPage]           = useState(1)
  const consumedProposalRef = useRef(null)
  const tableScrollRef = useRef(null)
  const topScrollRef   = useRef(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return policies.filter(p => {
      if (!showRenewed && (p.status || '').trim() === 'Renewed-Out') return false
      const mQ = !q||p.policyNumber?.toLowerCase().includes(q)||p.clientName?.toLowerCase().includes(q)||p.insurer?.toLowerCase().includes(q)||p.planName?.toLowerCase().includes(q)||p.registrationNo?.toLowerCase().includes(q)
      const mT = typeFilter==='All'||p.policyType===typeFilter
      return mQ && mT
    })
  }, [policies, search, typeFilter, showRenewed])

  // ── Duplicate detector ───────────────────────────────────────
  // Detects true duplicates across ALL policies (not just filtered).
  // Same client can legitimately hold multiple policies with the same insurer/type,
  // so we only flag exact policy-number duplicates and exact motor registration duplicates.
  const [showDupsOnly, setShowDupsOnly] = useState(false)

  const duplicatePolicyIds = useMemo(() => {
    const dupIds = new Set()

    // 1. Group by normalised policy number
    const byPolicyNo = {}
    policies.forEach(p => {
      const key = (p.policyNumber || '').trim().toLowerCase()
      if (!key) return
      if (!byPolicyNo[key]) byPolicyNo[key] = []
      byPolicyNo[key].push(p.id)
    })
    Object.values(byPolicyNo).forEach(ids => {
      if (ids.length > 1) ids.forEach(id => dupIds.add(id))
    })

    // 2. Group by motor registration number
    const byRegistration = {}
    policies.forEach(p => {
      const key = (p.registrationNo || '').trim().toLowerCase()
      if (!key) return
      if (!byRegistration[key]) byRegistration[key] = []
      byRegistration[key].push(p.id)
    })
    Object.values(byRegistration).forEach(ids => {
      if (ids.length > 1) ids.forEach(id => dupIds.add(id))
    })

    return dupIds
  }, [policies])

  const dupCount = useMemo(
    () => filtered.filter(p => duplicatePolicyIds.has(p.id)).length,
    [filtered, duplicatePolicyIds]
  )

  const displayPolicies = useMemo(
    () => showDupsOnly ? filtered.filter(p => duplicatePolicyIds.has(p.id)) : filtered,
    [filtered, showDupsOnly, duplicatePolicyIds]
  )

  useEffect(() => { setPage(1) }, [search, typeFilter, showRenewed, showDupsOnly])

  const totalPages = Math.max(1, Math.ceil(displayPolicies.length / POLICY_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedPolicies = useMemo(
    () => displayPolicies.slice((safePage - 1) * POLICY_PAGE_SIZE, safePage * POLICY_PAGE_SIZE),
    [displayPolicies, safePage]
  )
  useEffect(() => {
    if (page !== safePage) setPage(safePage)
  }, [page, safePage])

  useEffect(() => {
    const visibleIds = new Set(displayPolicies.map(p => p.id))
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => visibleIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [displayPolicies])

  // ── Duplicate detector ───────────────────────────────────
  const [dupWarning, setDupWarning] = useState('')

  useEffect(() => {
    const unsub = subscribeProposals(
      data => setProposals(data),
      err => toast.error('Could not load proposals for policy auto-fill: ' + (err.message || 'Unknown error'))
    )
    return () => unsub()
  }, [])

  useEffect(() => {
    const proposal = location.state?.proposalToPolicy
    if (!proposal?.id || consumedProposalRef.current === proposal.id) return
    consumedProposalRef.current = proposal.id
    setProposalPrefill(proposalToPolicyInitial(proposal, clients))
    setDupWarning('')
    resetDeleteState()
    setModal('add')
  }, [location.state, clients])
  const checkDup = useCallback(async (policyNumber) => {
    if (!policyNumber?.trim()) { setDupWarning(''); return }
    const exists = await checkDuplicatePolicyNumber(policyNumber)
    setDupWarning(exists ? `⚠️ Policy number "${policyNumber}" already exists in your database!` : '')
  }, [])

  // ── WhatsApp helper ──────────────────────────────────────
  const renewalAlertStyle = (policy) => {
    const dueIn = daysUntil(getPolicyDueDate(policy))
    if (dueIn === null) return undefined
    if (dueIn < 0) return { backgroundColor: '#fff1f2' }
    if (dueIn <= 7) return { backgroundColor: '#fefce8' }
    return undefined
  }

  const getPolicyClient = (policy) => {
    let client = clients.find(c => c.id === policy.clientId)
    if (!client?.mobile && policy.clientName) {
      client = clients.find(c => c.name.toLowerCase().trim() === (policy.clientName||'').toLowerCase().trim())
    }
    return client
  }

  const openWhatsApp = (policy) => {
    const client = getPolicyClient(policy)
    const mobile = client?.mobile?.replace(/\D/g,'')
    if (!mobile) {
      toast.error('No mobile number on file for this client')
      return
    }
    const dueDate = fmtDate(getPolicyDueDate(policy))
    const expiry  = fmtDate(policy.expiryDate)
    const premium = policy.premium ? fmtCurrency(policy.premium) : ''
    const safeMsg =
      `Dear ${policy.clientName},\n\n` +
      `Your ${policy.policyType || 'Insurance'} policy (${policy.insurer || 'Insurer'} - ${policy.planName || ''}) is due for renewal.\n\n` +
      `Policy No: ${policy.policyNumber}\n` +
      `Premium Due / Renewal Date: ${dueDate}\n` +
      `Policy End / Expiry Date: ${expiry}\n` +
      `Premium: ${premium}\n\n` +
      `Kindly arrange for renewal at the earliest to avoid any lapse in coverage.\n\n` +
      `For any query, please call or WhatsApp us.\n\n` +
      `Gohil Investments\nWealth Management & Insurance Advisory\n` +
      `Harshdipsinh Gohil - 7698997894\n` +
      `Pradipsinh Gohil - 9426204547\nBhavnagar, Gujarat`
    try {
      openWhatsAppLink({ mobile: client?.mobile, message: safeMsg })
    } catch (err) {
      toast.error(err.message || 'Could not open WhatsApp.')
    }
  }

  const openWhatsAppTemplate = (policy, template) => {
    const client = getPolicyClient(policy)
    const dueDate = fmtDate(getPolicyDueDate(policy))
    const templates = {
      renewal: `Dear Client, your premium for policy ${policy.policyNumber || ''} is due on ${dueDate}. Kindly process to ensure continuous coverage.`,
      welcome: `Dear Client, thank you for choosing us. Your policy document for ${policy.policyNumber || ''} has been successfully registered in our CRM.`,
    }
    try {
      openWhatsAppApiLink({ mobile: client?.mobile, message: templates[template] || templates.renewal })
      setWhatsAppMenu(null)
    } catch (err) {
      toast.error(err.message || 'Could not open WhatsApp.')
    }
  }

  // ── Bulk select ──────────────────────────────────────────
  const allVisibleIds  = pagedPolicies.map(p => p.id)
  const allSelected    = allVisibleIds.length > 0 && allVisibleIds.every(id => selectedIds.has(id))
  const someSelected   = allVisibleIds.some(id => selectedIds.has(id))
  const toggleOne  = id => setSelectedIds(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n })
  const toggleAll  = () => {
    if (allSelected) setSelectedIds(prev => { const n=new Set(prev); allVisibleIds.forEach(id=>n.delete(id)); return n })
    else             setSelectedIds(prev => { const n=new Set(prev); allVisibleIds.forEach(id=>n.add(id)); return n })
  }
  const clearSel = () => setSelectedIds(new Set())

  const toggleRenewedVisibility = () => {
    setDelOpen(false)
    setBulkDelOpen(false)
    setSelected(null)
    clearSel()
    setShowRenewed(v => !v)
  }

  const resetDeleteState = () => {
    setDelOpen(false)
    setBulkDelOpen(false)
    setSelected(null)
    clearSel()
  }

  const onBulkDelete = async () => {
    if (selectedIds.size === 0) return
    const ids = [...selectedIds]
    setBulkDeleting(true)
    try {
      const count = ids.length
      const selectedPolicies = policies.filter(p => selectedIds.has(p.id))
      await Promise.all(selectedPolicies.map(p => deletePolicyPdfByPath(p.policyPdfStoragePath)))
      await bulkDeletePolicies(ids)
      toast.success(`${count} policies deleted permanently`)
      clearSel()
      setBulkDelOpen(false)
    }
    catch(err) { toast.error('Failed to delete selected policies: ' + (err.message || 'Unknown error')) }
    finally { setBulkDeleting(false) }
  }

  const onAdd    = async form => {
    try {
      await addPolicy(form)
      if (form.proposalId) {
        await updateProposal(form.proposalId, {
          status: 'Converted',
          convertedPolicyNumber: form.policyNumber || '',
          convertedAt: new Date().toISOString(),
        })
      }
      toast.success('Policy added!')
      setModal(null)
      setProposalPrefill(null)
    } catch(err) {
      toast.error('Failed to add policy: ' + (err.message || 'Unknown error'))
    }
  }
  const onEdit   = async form => {
    try {
      await updatePolicy(selected.id, form)
      toast.success('Policy updated!')
      setModal(null)
    } catch(err) {
      toast.error('Failed to update policy: ' + (err.message || 'Unknown error'))
    }
  }
  const onDelete = async () => {
    if (!selected?.id) {
      toast.error('Please select a policy to delete.')
      setDelOpen(false)
      return
    }
    try {
      await deletePolicyPdfByPath(selected.policyPdfStoragePath)
      await deletePolicy(selected.id)
      toast.success('Policy deleted permanently')
      setDelOpen(false)
      setSelected(null)
      clearSel()
    } catch(err) {
      toast.error('Failed to delete: ' + (err.message || 'Unknown error'))
    }
  }

  if (loading) return (
    <div className="p-8 text-gray-400 dark:text-gray-500 flex items-center gap-2">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />Loading policies…
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Policies</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{policies.length} total</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isAdmin&&<button type="button" className="btn-secondary" onClick={()=>{resetDeleteState();setModal('import')}}>⬆ Import</button>}
          {isAdmin && <button type="button" className="btn-secondary text-red-600 dark:text-red-400" onClick={()=>{resetDeleteState();setShowRecycleBin(true)}}>🗑️ Recycle Bin</button>}
          <button
            type="button"
            onClick={toggleRenewedVisibility}
            className={`btn-secondary text-xs ${showRenewed ? 'ring-2 ring-blue-400 text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}
            title="Renewed-Out policies are hidden by default"
          >{showRenewed ? '🔄 Hide Renewed' : '🔄 Show Renewed'}</button>
          <button type="button" className="btn-primary" onClick={()=>{resetDeleteState();setDupWarning('');setProposalPrefill(null);setModal('add')}}>+ Add Policy</button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-start sm:items-center">
        <SearchBar value={search} onChange={setSearch} placeholder="Policy No, client, insurer…" />
        <div className="flex gap-1 flex-wrap">
          {['All',...TYPES].map(t=>(
            <button key={t} onClick={()=>setTypeFilter(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${typeFilter===t?'bg-blue-600 text-white':'bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`}>{t}</button>
          ))}
          {dupCount > 0 && (
            <button
              onClick={() => setShowDupsOnly(v => !v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border ${
                showDupsOnly
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-orange-50 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300 hover:bg-orange-100'
              }`}
            >
              🔁 Duplicates ({dupCount})
            </button>
          )}
        </div>
        <div className="flex gap-2 ml-auto flex-wrap">
          <button onClick={()=>exportToCSV(filtered,POLICY_COLS,'policies')} className="btn-secondary text-xs">⬇ CSV</button>
          <button onClick={()=>exportToExcel(filtered,POLICY_COLS,'Policies','policies')} className="btn-secondary text-xs">⬇ Excel</button>
          <button onClick={async()=>await exportToPDF(filtered,POLICY_COLS,'Policy List','policies')} className="btn-secondary text-xs">⬇ PDF</button>
        </div>
      </div>
      {/* Duplicate warning */}
      {dupWarning && (
        <div className="bg-orange-50 dark:bg-orange-900/30 border border-orange-300 rounded-xl px-4 py-3 text-sm text-orange-700 dark:text-orange-300 font-semibold">
          {dupWarning}
        </div>
      )}
      {/* Bulk delete bar */}
      {isAdmin && someSelected && (
        <div className="flex items-center gap-3 bg-red-50 dark:bg-red-900/30 border border-red-200 rounded-xl px-4 py-3">
          <span className="text-sm font-semibold text-red-700 dark:text-red-300">{selectedIds.size} policies selected</span>
          <button type="button" onClick={onBulkDelete} disabled={bulkDeleting}
                  className="px-4 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {bulkDeleting ? 'Deleting...' : 'Delete Selected'}
          </button>
          <button type="button" onClick={clearSel} className="px-3 py-1.5 bg-white dark:bg-gray-700 border border-red-200 text-red-600 text-xs font-semibold rounded-lg">✕ Clear</button>
        </div>
      )}
      {displayPolicies.length > POLICY_PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-xs">
          <span className="text-gray-500 dark:text-gray-400">
            Showing {(safePage - 1) * POLICY_PAGE_SIZE + 1}-{Math.min(safePage * POLICY_PAGE_SIZE, displayPolicies.length)} of {displayPolicies.length} policies
          </span>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary text-xs" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
            <span className="text-gray-600 dark:text-gray-300 font-semibold">Page {safePage} / {totalPages}</span>
            <button type="button" className="btn-secondary text-xs" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</button>
          </div>
        </div>
      )}
      {/* Top scrollbar — mirrors the table's horizontal scroll so user
          doesn't have to scroll all the way to the bottom to see right columns */}
      <div
        ref={topScrollRef}
        style={{ overflowX: 'auto', overflowY: 'hidden', height: 14 }}
        onScroll={e => { if (tableScrollRef.current) tableScrollRef.current.scrollLeft = e.currentTarget.scrollLeft }}
        className="rounded"
      >
        <div style={{ height: 1, minWidth: 2200 }} />
      </div>
      <div
        ref={tableScrollRef}
        className="table-container"
        onScroll={e => { if (topScrollRef.current) topScrollRef.current.scrollLeft = e.currentTarget.scrollLeft }}
      >
        <table className="min-w-full" style={{ minWidth: 2200 }}>
          <thead><tr>
            <th className="table-header w-10">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4 cursor-pointer" />
            </th>
            {['Policy No','Client','Phone','Type','Insurer','Premium','Next Due','Expiry','Days','Yr','Status','FY%','RY%','Dup','WhatsApp','PDF'].map(h=>(
              <th key={h} className="table-header">{h}</th>
            ))}
          </tr></thead>
          <tbody className="bg-white dark:bg-gray-800">
            {displayPolicies.length===0
              ?<tr><td colSpan={17} className="text-center text-gray-400 dark:text-gray-500 py-10">No policies found</td></tr>
              :pagedPolicies.map(p=>{
                const isRenewedOut = (p.status||'').trim() === 'Renewed-Out'
                const isDup = duplicatePolicyIds.has(p.id)
                const dueDate = getPolicyDueDate(p)
                const linkedClient = getPolicyClient(p)
                const phone = p.clientMobile || linkedClient?.mobile || ''
                const st = isRenewedOut ? { label: 'Renewed', color: 'blue' } : renewalStatus(dueDate)
                const bm={green:'badge-green',yellow:'badge-yellow',red:'badge-red',blue:'badge-blue',gray:'badge-gray'}
                return(
                  <tr
                    key={p.id}
                    style={!selectedIds.has(p.id) && !isDup ? renewalAlertStyle(p) : undefined}
                    className={`table-row ${selectedIds.has(p.id)?'bg-blue-50 dark:bg-blue-900/20':''} ${isDup?'bg-orange-50 dark:bg-orange-900/10':''}`}>
                    <td className="table-cell">
                      <input type="checkbox" checked={selectedIds.has(p.id)} onChange={()=>toggleOne(p.id)} className="w-4 h-4 cursor-pointer" />
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold">{p.policyNumber}</span>
                        <button type="button" onClick={()=>{setSelected(p);setDupWarning('');setModal('edit')}} className="px-2 py-1 text-xs bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-100">Edit</button>
                        {isAdmin&&<button type="button" onClick={()=>{setSelected(p);setDelOpen(true)}} className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded hover:bg-red-100">Del</button>}
                      </div>
                    </td>
                    <td className="table-cell font-medium">{p.clientName||'—'}</td>
                    <td className="table-cell text-xs text-gray-500 dark:text-gray-400">
                      {phone || <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="table-cell"><span className="badge-blue">{p.policyType}</span></td>
                    <td className="table-cell text-xs">{p.insurer}</td>
                    <td className="table-cell">{fmtCurrency(p.premium)}</td>
                    <td className="table-cell font-semibold text-blue-700 dark:text-blue-400 text-xs">
                      {fmtDate(dueDate)}
                    </td>
                    <td className="table-cell text-xs">{fmtDate(p.expiryDate)}</td>
                    <td className="table-cell">{daysUntil(dueDate)!==null?`${daysUntil(dueDate)}d`:'—'}</td>
                    <td className="table-cell text-xs text-center text-gray-500 dark:text-gray-400">{p.policyYear?`Y${p.policyYear}`:'Y1'}</td>
                    <td className="table-cell"><span className={bm[st.color]||'badge-gray'}>{st.label}</span></td>
                    <td className="table-cell text-xs text-center text-blue-600 dark:text-blue-400 font-semibold">{p.fyCommission?`${p.fyCommission}%`:'—'}</td>
                    <td className="table-cell text-xs text-center text-green-600 dark:text-green-400 font-semibold">{p.ryCommission?`${p.ryCommission}%`:'—'}</td>
                    <td className="table-cell text-center">
                      {isDup
                        ? <span className="px-2 py-0.5 text-xs font-bold bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded-full" title="Possible duplicate policy">🔁 Dup</span>
                        : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                      }
                    </td>
                    <td className="table-cell text-center">
                      <div className="relative inline-flex items-center gap-1">
                        <button onClick={()=>openWhatsApp(p)} className="btn-whatsapp">📱 WA</button>
                        <button
                          type="button"
                          onClick={() => setWhatsAppMenu(whatsAppMenu === p.id ? null : p.id)}
                          className="px-2 py-1 text-xs rounded bg-green-50 text-green-700 hover:bg-green-100"
                          title="WhatsApp templates"
                        >
                          ▾
                        </button>
                        {whatsAppMenu === p.id && (
                          <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-lg border border-gray-200 bg-white shadow-lg">
                            <button type="button" onClick={() => openWhatsAppTemplate(p, 'renewal')} className="block w-full px-3 py-2 text-left text-xs hover:bg-gray-50">
                              Renewal Due
                            </button>
                            <button type="button" onClick={() => openWhatsAppTemplate(p, 'welcome')} className="block w-full px-3 py-2 text-left text-xs hover:bg-gray-50">
                              Welcome
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="table-cell text-center">
                      <PolicyPdfUpload
                        compact
                        policyId={p.id}
                        existingUrl={p.policyPdfUrl}
                        existingName={p.policyPdfName}
                      />
                    </td>

                  </tr>
                )
              })
            }
          </tbody>
        </table>
      </div>
      <Modal open={modal==='add'} onClose={()=>{setModal(null);setProposalPrefill(null)}} title="Add New Policy" size="xl">
        {proposals.length > 0 && (
          <div className="mb-4 p-3 rounded-lg border border-blue-100 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30">
            <label className="form-label">Auto-fill from proposal</label>
            <select
              className="form-select mt-1"
              value={proposalPrefill?.proposalId || ''}
              onChange={e => {
                const proposal = proposals.find(p => p.id === e.target.value)
                setProposalPrefill(proposal ? proposalToPolicyInitial(proposal, clients) : null)
                setDupWarning('')
              }}
            >
              <option value="">Manual policy entry</option>
              {proposals.map(p => (
                <option key={p.id} value={p.id}>
                  {(p.status === 'Converted' ? '[Converted] ' : '')}{p.proposerName || p.clientName || 'Proposal'} - {p.policyType || 'Policy'} - {p.insurer || 'No insurer'}
                </option>
              ))}
            </select>
          </div>
        )}
        <PolicyForm
          key={proposalPrefill?.proposalId || 'manual-policy'}
          initial={proposalPrefill || undefined}
          clients={clients}
          onSave={onAdd}
          onCancel={()=>{setModal(null);setProposalPrefill(null)}}
          onPolicyNumberChange={checkDup}
          dupWarning={dupWarning}
        />
      </Modal>
      <Modal open={modal==='edit'} onClose={()=>setModal(null)} title="Edit Policy" size="xl">
        {selected&&<PolicyForm initial={selected} clients={clients} onSave={onEdit} onCancel={()=>setModal(null)} onPolicyNumberChange={()=>{}} dupWarning="" />}
      </Modal>
      <Modal open={modal==='import'} onClose={()=>setModal(null)} title="📥 Import Policies — Choose Type" size="lg">
        <ImportModal clients={clients} onClose={()=>setModal(null)} onImported={()=>{}} />
      </Modal>
      <ConfirmDialog open={delOpen && !!selected?.id} onClose={()=>setDelOpen(false)} onConfirm={onDelete}
                     title="Delete Policy?" message={`Delete "${selected?.policyNumber}"?`} danger />
      <ConfirmDialog open={bulkDelOpen && selectedIds.size > 0} onClose={()=>setBulkDelOpen(false)} onConfirm={onBulkDelete}
                     title={`Delete ${selectedIds.size} Policies?`}
                     message={`Move ${selectedIds.size} selected policies to the Recycle Bin? You can restore them later.`} danger />
      {showRecycleBin && (
        <RecycleBinModal
          onClose={() => setShowRecycleBin(false)}
          fmtDate={fmtDate}
          fmtCurrency={fmtCurrency}
        />
      )}
    </div>
  )
}
