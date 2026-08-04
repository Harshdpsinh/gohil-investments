// src/utils/policySchemas.js
// ─────────────────────────────────────────────────────────────
// v4 — added Star Health & New India Assurance specific fields
// ─────────────────────────────────────────────────────────────

// HEALTH SCHEMA
export const HEALTH_DEFAULTS = {
  sumInsured:         '',
  cumulativeBonus:    '',
  cumulativeBonusPct: '',
  roomRentLimit:      '',
  coPay:              '',
  restoreBenefit:     false,
  dateOfFirstEntry:   '',
  isPortability:      false,
  prevInsurer:        '',
  prevPolicyNo:       '',
  portabilityNCB:     '',
  members:            [],
  // Star Health specific
  starHospitalCash:   '',       // Daily hospital cash benefit
  starAyush:          false,    // AYUSH treatment cover
  starModernTreatment: false,   // Modern treatment cover
  starNRIBenefit:     false,    // NRI benefit rider
  starWellness:       false,    // Star Wellness program enrolled
  // General health add-ons
  criticalIllness:    false,
  maternityBenefit:   false,
  dentalOpd:          false,
  visionOpd:          false,
  opdCover:           '',       // OPD limit ₹
}

export const HEALTH_RELATIONSHIPS = [
  'Self','Spouse','Son','Daughter','Father','Mother',
  'Father-in-Law','Mother-in-Law','Brother','Sister','Other'
]

// LIFE SCHEMA
export const LIFE_DEFAULTS = {
  sumAssured:       '',
  policySubType:    'Term',
  ppt:              '',
  policyTerm:       '',
  maturityDate:     '',
  surrenderValue:   '',
  loanAgainstPolicy:'',
  smoker:           false,
  nomineeName:      '',
  nomineeRelation:  '',
  nomineeDob:       '',
  nomineePan:       '',
  appointeeName:    '',
  appointeeRelation:'',
  // LIC specific
  licBonusAdditions: '',    // Bonus additions to date
  licFAB:            '',    // Final Additional Bonus
  licLoyaltyAddition:'',   // Loyalty addition
  licPolicyStatus:   '',   // From LIC Mitra: active/paid up/surrendered
  licMode:           '',   // Quarterly/Half-yearly/Yearly
  // General life add-ons
  accidentalDeath:   false,
  criticalIllness:   false,
  waiverOfPremium:   false,
  returnOfPremium:   false,
}

export const LIFE_SUBTYPES = [
  'Term','Endowment','ULIP','Money-Back','Whole Life',
  'Pension','Child Plan','Guaranteed Return'
]

// MOTOR SCHEMA
export const MOTOR_DEFAULTS = {
  vehicleType:       '4W',
  registrationNo:    '',
  make:              '',
  model:             '',
  variant:           '',
  year:              '',
  fuelType:          'Petrol',
  engineNo:          '',
  chassisNo:         '',
  coverType:         'Comprehensive',
  idv:               '',
  ncbPct:            '0',
  prevNcbPct:        '0',
  addons: {
    zeroDep:          false,
    engineProtect:    false,
    rsa:              false,
    keyReplace:       false,
    consumables:      false,
    returnToInvoice:  false,
    tyreProtect:      false,
    personalAccident: false,
    // New India Assurance specific
    legalLiability:   false,   // Legal liability to paid driver
    imtEndorsements:  '',      // IMT endorsement numbers
  },
  isHypothecated:    false,
  hypothecationBank: '',
  tpPolicyNo:        '',
  tpInsurer:         '',
  tpExpiry:          '',
  // New India Assurance specific
  niaSurveyorName:   '',      // Surveyor assigned for claims
  niaOfficeCode:     '',      // NIA office/branch code
  niaGdRef:          '',      // GD reference number for theft
}

export const MOTOR_VEHICLE_TYPES = ['2W','4W','Commercial','Trailer','Construction Equipment']
export const MOTOR_FUEL_TYPES    = ['Petrol','Diesel','CNG','Electric','Hybrid','CNG+Petrol']
export const MOTOR_COVER_TYPES   = ['Comprehensive','Third Party','OD Only','Standalone TP']
export const MOTOR_NCB_OPTIONS   = ['0','20','25','35','45','50']

// STAR HEALTH specific plan names
export const STAR_HEALTH_PLANS = [
  'Star Comprehensive','Medi Classic','Family Health Optima',
  'Senior Citizens Red Carpet','Diabetes Safe','Cardiac Care',
  'Cancer Care Platinum','Arogya Sanjeevani','Young Star',
  'Star Women Care','Star Critical Illness','Star Accident Care',
]

// NEW INDIA ASSURANCE specific plan names
export const NEW_INDIA_PLANS = [
  'New India Floater Mediclaim','New India Mediclaim Policy',
  'New India Top Up Mediclaim','Senior Citizen Mediclaim',
  'Arogya Sanjeevani','Jan Arogya','New India Janata Mediclaim',
  'Vehicle Insurance','Householder','Fire & Burglary',
]

// ── Type defaults ─────────────────────────────────────────────
export function getTypeDefaults(policyType) {
  switch(policyType) {
    case 'Health': return { ...HEALTH_DEFAULTS }
    case 'Life':   return { ...LIFE_DEFAULTS   }
    case 'Motor':  return { ...MOTOR_DEFAULTS  }
    default:       return {}
  }
}

// ── Known insurers ────────────────────────────────────────────
// Shared by the policy form's combobox and the PDF extractor, which spots the
// carrier by finding one of these names anywhere in the document.
export const KNOWN_INSURERS = [
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

// ── Insurer detection ─────────────────────────────────────────
export function isStarHealth(insurer) {
  return (insurer||'').toLowerCase().includes('star')
}
export function isNewIndia(insurer) {
  return (insurer||'').toLowerCase().includes('new india')
}
export function isLIC(insurer) {
  return (insurer||'').toLowerCase().includes('lic') || (insurer||'').toLowerCase().includes('life insurance corporation')
}

// ── KYC locked fields ─────────────────────────────────────────
export const KYC_LOCKED_FIELDS = ['clientName','dob','gender','pan','aadhar']

// ── Coverage gap rules ────────────────────────────────────────
// isActive: treat blank/null status same as Active (handles imported policies)
const isActive = p => !['Renewed-Out','Cancelled','Matured'].includes((p.status||'').trim())

export const COVERAGE_GAP_RULES = [
  {
    id: 'no-health',
    label: '🏥 No Health Cover',
    color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    check: (policies) => !policies.some(p =>
      p.policyType === 'Health' && isActive(p)
    ),
  },
  {
    id: 'no-life',
    label: '🛡️ No Life Cover',
    color: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
    check: (policies) => !policies.some(p =>
      p.policyType === 'Life' && isActive(p)
    ),
  },
  {
    id: 'no-term',
    label: '📋 No Term Plan',
    color: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
    check: (policies) => !policies.some(p =>
      p.policyType === 'Life' && p.policySubType === 'Term' && isActive(p)
    ),
  },
  {
    id: 'no-motor',
    label: '🚗 No Motor Cover',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    check: (policies) => !policies.some(p =>
      p.policyType === 'Motor' && isActive(p)
    ),
  },
  {
    id: 'no-critical',
    label: '❤️ No Critical Illness',
    color: 'bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300',
    check: (policies) => !policies.some(p =>
      (p.criticalIllness || p.policyType === 'Life' && p.policySubType?.includes('Critical')) && isActive(p)
    ),
  },
]

export function computeCoverageGaps(clientPolicies) {
  return COVERAGE_GAP_RULES.filter(rule => rule.check(clientPolicies))
}
