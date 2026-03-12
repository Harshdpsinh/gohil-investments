// src/utils/policySchemas.js
// Defines type-specific data structures for Health, Life, Motor policies.
// Base fields (policyNumber, clientId, insurer, premium, dates etc.) live in PoliciesPage.
// These schemas define the EXTRA fields rendered per policy type.

// ─────────────────────────────────────────────────────────────
// HEALTH SCHEMA
// ─────────────────────────────────────────────────────────────
export const HEALTH_DEFAULTS = {
  // Coverage
  sumInsured:          '',   // ₹ — primary coverage amount
  cumulativeBonus:     '',   // ₹ — accrued NCB/CB on policy
  cumulativeBonusPct:  '',   // % — bonus rate
  roomRentLimit:       '',   // ₹/day or 'No Limit'
  coPay:               '',   // % co-pay on claims
  restoreBenefit:      false,// boolean toggle
  // Portability
  isPortability:       false,
  prevInsurer:         '',
  prevPolicyNo:        '',
  portabilityNCB:      '',   // ₹ NCB carried over from prev insurer
  // Waiting period anchor
  dateOfFirstEntry:    '',   // ISO date — used to calc PED waiting period remaining
  // Members list (Family Floater / Group)
  members: [
    { name:'', dob:'', age:'', relationship:'Self', ped:'' },
    { name:'', dob:'', age:'', relationship:'Spouse', ped:'' },
  ],
}

export const HEALTH_RELATIONSHIPS = ['Self','Spouse','Son','Daughter','Father','Mother','Father-in-Law','Mother-in-Law','Other']

// ─────────────────────────────────────────────────────────────
// LIFE SCHEMA
// ─────────────────────────────────────────────────────────────
export const LIFE_DEFAULTS = {
  sumAssured:       '',   // ₹ death benefit
  ppt:              '',   // Premium Paying Term in years
  policyTerm:       '',   // Total policy term in years
  maturityDate:     '',   // ISO date (auto-calc from startDate + policyTerm)
  policySubType:    'Term', // Term | Endowment | ULIP | Money-Back | Whole Life
  // Loan
  loanAgainstPolicy: false,
  surrenderValue:   '',   // ₹ current surrender value (manual)
  // Nominee
  nomineeName:      '',
  nomineeRelation:  '',
  nomineeDob:       '',
  nomineePan:       '',
  // Appointee (if nominee is minor)
  appointeeName:    '',
  appointeeRelation:'',
  // Life health data
  height:           '',
  weight:           '',
  smoker:           false,
  familyIllness:    '',
}

export const LIFE_SUBTYPES = ['Term','Endowment','ULIP','Money-Back','Whole Life','Pension','Child Plan']

// ─────────────────────────────────────────────────────────────
// MOTOR SCHEMA
// ─────────────────────────────────────────────────────────────
export const MOTOR_DEFAULTS = {
  // Vehicle identity
  vehicleType:      '4W',   // 2W | 4W | Commercial | Trailer
  registrationNo:   '',
  make:             '',     // e.g. Maruti, Hyundai
  model:            '',     // e.g. Swift, Creta
  variant:          '',
  year:             '',     // manufacturing year
  fuelType:         'Petrol',
  engineNo:         '',
  chassisNo:        '',
  colour:           '',
  // Cover
  coverType:        'Comprehensive',  // Comprehensive | Third Party | OD Only
  idv:              '',   // ₹ Insured Declared Value
  ncbPct:           '0',  // % 0/20/25/35/45/50
  prevNcbPct:       '0',  // % carried from last year
  // Add-ons (Comprehensive only)
  addons: {
    zeroDep:          false,
    engineProtect:    false,
    rsa:              false,       // Roadside Assistance
    keyReplace:       false,
    consumables:      false,
    returnToInvoice:  false,
    tyreProtect:      false,
    personalAccident: false,
  },
  // Finance / hypothecation
  isHypothecated:   false,
  hypothecationBank:'',
  // TP details
  tpPolicyNo:       '',    // if OD-only, store separate TP policy no
  tpInsurer:        '',
  tpExpiry:         '',
}

export const MOTOR_VEHICLE_TYPES = ['2W','4W','Commercial','Trailer']
export const MOTOR_FUEL_TYPES    = ['Petrol','Diesel','CNG','Electric','Hybrid']
export const MOTOR_COVER_TYPES   = ['Comprehensive','Third Party','OD Only']
export const MOTOR_NCB_OPTIONS   = ['0','20','25','35','45','50']

// ─────────────────────────────────────────────────────────────
// HELPER: get blank schema for a type
// ─────────────────────────────────────────────────────────────
export function getTypeDefaults(policyType) {
  switch (policyType) {
    case 'Health': return { ...HEALTH_DEFAULTS }
    case 'Life':   return { ...LIFE_DEFAULTS }
    case 'Motor':  return { ...MOTOR_DEFAULTS }
    default:       return {}
  }
}

// ─────────────────────────────────────────────────────────────
// KYC LOCKED FIELDS (used during renewal — these are read-only)
// ─────────────────────────────────────────────────────────────
export const KYC_LOCKED_FIELDS = ['clientName','dob','gender','pan','aadhar']

// ─────────────────────────────────────────────────────────────
// COVERAGE GAP RULES (used for cross-sell flags on ClientsPage)
// Each rule: given existing policy types → flag if missing type
// ─────────────────────────────────────────────────────────────
export const COVERAGE_GAP_RULES = [
  {
    id:       'no_health',
    label:    'No Health Cover',
    color:    'bg-red-100 text-red-700',
    requires: [],          // always check
    missing:  'Health',
  },
  {
    id:       'no_life',
    label:    'No Life Cover',
    color:    'bg-orange-100 text-orange-700',
    requires: [],
    missing:  'Life',
  },
  {
    id:       'no_term',
    label:    'No Term Plan',
    color:    'bg-yellow-100 text-yellow-700',
    requires: ['Life'],    // only flag if has some Life (but not Term sub-type — checked separately)
    missing:  '__term__',  // special — checked via policySubType === 'Term'
  },
  {
    id:       'no_motor',
    label:    'No Motor Cover',
    color:    'bg-blue-100 text-blue-700',
    requires: ['__has_motor_hint__'], // flag if registration no exists in any policy
    missing:  'Motor',
  },
]

export function computeCoverageGaps(clientPolicies) {
  const types = new Set(clientPolicies.filter(p => p.status === 'Active').map(p => p.policyType))
  const gaps  = []

  if (!types.has('Health')) gaps.push({ id:'no_health', label:'No Health Cover', color:'bg-red-100 text-red-700' })
  if (!types.has('Life'))   gaps.push({ id:'no_life',   label:'No Life Cover',   color:'bg-orange-100 text-orange-700' })
  if (types.has('Life')) {
    const hasTermPlan = clientPolicies.some(p => p.status==='Active' && p.policyType==='Life' && p.policySubType==='Term')
    if (!hasTermPlan) gaps.push({ id:'no_term', label:'No Term Plan', color:'bg-yellow-100 text-yellow-700' })
  }
  if (!types.has('Motor') && clientPolicies.some(p => p.registrationNo)) {
    gaps.push({ id:'no_motor', label:'No Motor Cover', color:'bg-blue-100 text-blue-700' })
  }

  return gaps
}
