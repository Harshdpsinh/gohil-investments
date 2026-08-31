// src/utils/insurers.js
// The single list of insurance companies. Every consumer now reads this file.
// Pure — no firebase, no react.

export const LIFE_INSURERS = [
  'LIC of India',
  'HDFC Life Insurance',
  'ICICI Prudential Life Insurance',
  'SBI Life Insurance',
  'Max Life Insurance',
  'Bajaj Allianz Life Insurance',
  'Kotak Mahindra Life Insurance',
  'Tata AIA Life Insurance',
  'Aditya Birla Sun Life Insurance',
  'PNB MetLife India Insurance',
  'Canara HSBC Life Insurance',
  'IndiaFirst Life Insurance',
  'Bandhan Life Insurance',
  'Edelweiss Life Insurance',
  'Future Generali India Life Insurance',
  'Ageas Federal Life Insurance',
  'Bharti AXA Life Insurance',
  'Reliance Nippon Life Insurance',
  'Shriram Life Insurance',
  'Star Union Dai-ichi Life Insurance',
  'Aviva Life Insurance',
  'Pramerica Life Insurance',
  'Sahara India Life Insurance',
  'Go Digit Life Insurance',
  'Acko Life Insurance',
  'CreditAccess Life Insurance',
]

export const HEALTH_INSURERS = [
  'Star Health and Allied Insurance',
  'Niva Bupa Health Insurance',
  'Care Health Insurance',
  'ManipalCigna Health Insurance',
  'Aditya Birla Health Insurance',
  'Narayana Health Insurance',
  'Galaxy Health Insurance',
]

export const GENERAL_INSURERS = [
  'New India Assurance',
  'United India Insurance',
  'National Insurance',
  'Oriental Insurance',
  'ICICI Lombard General Insurance',
  'Bajaj Allianz General Insurance',
  'HDFC ERGO General Insurance',
  'Tata AIG General Insurance',
  'Reliance General Insurance',
  'SBI General Insurance',
  'Cholamandalam MS General Insurance',
  'IFFCO Tokio General Insurance',
  'Future Generali India Insurance',
  'Royal Sundaram General Insurance',
  'Liberty General Insurance',
  'Magma General Insurance',
  'Universal Sompo General Insurance',
  'Raheja QBE General Insurance',
  'Shriram General Insurance',
  'Kotak Mahindra General Insurance',
  'Zuno General Insurance',
  'Navi General Insurance',
  'Go Digit General Insurance',
  'Acko General Insurance',
  'Kshema General Insurance',
  'Agriculture Insurance Company of India',
  'ECGC',
]

export const KNOWN_INSURERS = [...LIFE_INSURERS, ...HEALTH_INSURERS, ...GENERAL_INSURERS].sort((a, b) => a.localeCompare(b))

const NOISE = /\b(insurance|assurance|company|limited|ltd|pvt|private|corporation|corp|general|motor|vehicle|and|the|of|co)\b/g

export function insurerKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, '')
}

const ALIASES = {
  starhealth: 'Star Health and Allied Insurance',
  star: 'Star Health and Allied Insurance',
  maxbupa: 'Niva Bupa Health Insurance',
  nivabupamaxbupa: 'Niva Bupa Health Insurance',
  nivabupa: 'Niva Bupa Health Insurance',
  religare: 'Care Health Insurance',
  carehealth: 'Care Health Insurance',
  cigna: 'ManipalCigna Health Insurance',
  adityabirla: 'Aditya Birla Health Insurance',
  abhi: 'Aditya Birla Health Insurance',
  edelweisstokiolife: 'Edelweiss Life Insurance',
  edelweiss: 'Zuno General Insurance',
  edelweissgeneral: 'Zuno General Insurance',
  aegonlife: 'Bandhan Life Insurance',
  idbifederallife: 'Ageas Federal Life Insurance',
  magmahdi: 'Magma General Insurance',
  digit: 'Go Digit General Insurance',
  godigit: 'Go Digit General Insurance',
  acko: 'Acko General Insurance',
  lic: 'LIC of India',
  licindia: 'LIC of India',
  newindia: 'New India Assurance',
  unitedindia: 'United India Insurance',
  icic: 'ICICI Lombard General Insurance',
  icici: 'ICICI Lombard General Insurance',
  iciciloambard: 'ICICI Lombard General Insurance',
  icicilombard: 'ICICI Lombard General Insurance',
  iciciprudential: 'ICICI Prudential Life Insurance',
  hdfcergo: 'HDFC ERGO General Insurance',
  tataaig: 'Tata AIG General Insurance',
  tataaia: 'Tata AIA Life Insurance',
  ifftokio: 'IFFCO Tokio General Insurance',
  iffcotokio: 'IFFCO Tokio General Insurance',
  cholamandalamms: 'Cholamandalam MS General Insurance',
  chola: 'Cholamandalam MS General Insurance',
  royalsundaram: 'Royal Sundaram General Insurance',
  bharatiaxalife: 'Bharti AXA Life Insurance',
}

const CANONICAL_BY_KEY = new Map([
  ...KNOWN_INSURERS.map(name => [insurerKey(name), name]),
  ...Object.entries(ALIASES).map(([key, name]) => [key, name]),
])

function prefixMatch(key) {
  if (key.length < 4) return ''
  const hits = [...new Set(
    [...CANONICAL_BY_KEY.entries()]
      .filter(([candidate]) => candidate.startsWith(key))
      .map(([, name]) => name)
  )]
  return hits.length === 1 ? hits[0] : ''
}

export function canonicalInsurer(name, hint = {}) {
  const text = String(name ?? '').trim()
  if (!text) return ''
  const key = insurerKey(text)
  if (key === 'icic' || key === 'icici') {
    const type = String(hint.policyType || '').trim().toLowerCase()
    if (type === 'life') return 'ICICI Prudential Life Insurance'
    return 'ICICI Lombard General Insurance'
  }
  return CANONICAL_BY_KEY.get(key) || prefixMatch(key) || text
}

export function groupKey(name, hint = {}) {
  return insurerKey(canonicalInsurer(name, hint))
}

export function sameInsurer(a, b, hintA = {}, hintB = {}) {
  const x = groupKey(a, hintA)
  const y = groupKey(b, hintB)
  return Boolean(x && y) && x === y
}

export function insurerOptions(existing = []) {
  const byKey = new Map()
  for (const name of existing) {
    const text = String(name ?? '').trim()
    if (!text) continue
    const key = groupKey(text)
    if (key && !byKey.has(key)) byKey.set(key, text)
  }
  for (const name of KNOWN_INSURERS) {
    const key = groupKey(name)
    if (!byKey.has(key)) byKey.set(key, name)
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b))
}

export function unrecognisedInsurers(names = []) {
  const seen = new Map()
  for (const name of names) {
    const text = String(name ?? '').trim()
    if (!text) continue
    const key = insurerKey(text)
    if (!key || CANONICAL_BY_KEY.has(key) || prefixMatch(key)) continue
    if (!seen.has(key)) seen.set(key, text)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

export function duplicateInsurers(existing = []) {
  const byKey = new Map()
  for (const name of existing) {
    const text = String(name ?? '').trim()
    if (!text) continue
    const key = groupKey(text)
    if (!key) continue
    const entry = byKey.get(key) || { canonical: canonicalInsurer(text), variants: new Set() }
    entry.variants.add(text)
    byKey.set(key, entry)
  }
  return [...byKey.values()]
    .filter(entry => entry.variants.size > 1)
    .map(entry => ({ canonical: entry.canonical, variants: [...entry.variants].sort() }))
    .sort((a, b) => a.canonical.localeCompare(b.canonical))
}
