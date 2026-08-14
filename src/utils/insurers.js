// src/utils/insurers.js
// The single list of insurance companies. There used to be three — one in
// constants.js, one in policySchemas.js and one inline in RenewalsPage — and
// they had drifted, which is why a company would appear in one dropdown and be
// missing from another. Every consumer now reads this file.
//
// Pure — no firebase, no react.

/**
 * IRDAI-registered insurers a Bhavnagar broker realistically places business
 * with. Names are the trading names, not the full legal names, because that is
 * what appears on a policy schedule and on a commission statement.
 *
 * This list does not need to be exhaustive or kept current: every insurer field
 * in the app is free-type, and any name typed in is kept verbatim and offered
 * back as an option afterwards. Add to it only to save typing.
 */
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

// Words that describe the line of business or the legal form, not the company.
// Stripping them is what collapses "HDFC ERGO", "HDFC ERGO General Insurance"
// and "HDFC ERGO Motor" onto one key.
//
// 'life' and 'health' are deliberately NOT stripped: they are the only thing
// separating Aditya Birla Health Insurance from Aditya Birla Sun Life, which
// are different companies and must never be merged.
const NOISE = /\b(insurance|assurance|company|limited|ltd|pvt|private|corporation|corp|general|motor|vehicle|and|the|of|co)\b/g

/** Comparison key for a company name. Case, punctuation and noise words removed. */
export function insurerKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, '')
}

/**
 * Variants that stripping alone cannot reach — abbreviations, former names and
 * the shorthand people actually type.
 */
const ALIASES = {
  starhealth: 'Star Health and Allied Insurance',
  star: 'Star Health and Allied Insurance',
  maxbupa: 'Niva Bupa Health Insurance',
  nivabupamaxbupa: 'Niva Bupa Health Insurance',
  nivabupa: 'Niva Bupa Health Insurance',
  religare: 'Care Health Insurance',
  carehealth: 'Care Health Insurance',
  cigna: 'ManipalCigna Health Insurance',
  // Bare "Aditya Birla" is ambiguous, but Sun Life is always written with
  // "Sun Life" on a schedule, so an unqualified one is the health arm.
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

/**
 * The canonical spelling of a company name, or the name as typed when it is one
 * we do not know. Unknown names are never discarded — a broker will always meet
 * a company this file has not heard of, and losing what they typed is worse
 * than showing a spelling we did not choose.
 */
/**
 * Statements truncate names — "ICIC" for ICICI, "Star Heal" for Star Health.
 * A prefix is accepted only when it matches exactly ONE known company, so
 * "ICIC" (which prefixes both ICICI Lombard and ICICI Prudential) is left
 * alone rather than being filed under a coin toss. Four characters minimum,
 * or "SBI" would swallow half the market.
 */
function prefixMatch(key) {
  if (key.length < 4) return ''
  const hits = [...new Set(
    [...CANONICAL_BY_KEY.entries()]
      .filter(([candidate]) => candidate.startsWith(key))
      .map(([, name]) => name)
  )]
  return hits.length === 1 ? hits[0] : ''
}

export function canonicalInsurer(name) {
  const text = String(name ?? '').trim()
  if (!text) return ''
  const key = insurerKey(text)
  return CANONICAL_BY_KEY.get(key) || prefixMatch(key) || text
}

/**
 * The key everything groups by. Resolving the alias FIRST is load-bearing:
 * "Star Health" strips to `starhealth` and "Star Health and Allied Insurance"
 * to `starhealthallied`, so raw keys alone would leave them as two companies.
 */
export function groupKey(name) {
  return insurerKey(canonicalInsurer(name))
}

/** Do two names refer to the same company? */
export function sameInsurer(a, b) {
  const x = groupKey(a)
  const y = groupKey(b)
  return Boolean(x && y) && x === y
}

/**
 * The dropdown list: the known companies plus every spelling already in the
 * book, collapsed so "HDFC ERGO" and "HDFC ERGO General Insurance" appear once.
 * A name already in use wins over our spelling of it, so the option matches
 * what the existing records actually say.
 */
export function insurerOptions(existing = []) {
  const byKey = new Map()
  for (const name of existing) {
    const text = String(name ?? '').trim()
    if (!text) continue
    const key = groupKey(text)
    // Verbatim, not canonicalised: offering our spelling would make every new
    // record disagree with the ones already on file — a fresh duplicate.
    if (key && !byKey.has(key)) byKey.set(key, text)
  }
  for (const name of KNOWN_INSURERS) {
    const key = groupKey(name)
    if (!byKey.has(key)) byKey.set(key, name)
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b))
}

/**
 * Names we could not tie to any known company — typos, truncations too short or
 * too ambiguous to resolve ("ICIC"), and genuinely new insurers.
 *
 * Rather than guessing at each one, this lists them so a wrong spelling can be
 * corrected at the source. A real company that simply is not in KNOWN_INSURERS
 * will show up here too, which is fine: it is a prompt to look, not an error.
 */
export function unrecognisedInsurers(names = []) {
  const seen = new Map()
  for (const name of names) {
    const text = String(name ?? '').trim()
    if (!text) continue
    const key = insurerKey(text)
    // Ask the lookup directly. Testing whether canonicalInsurer echoed the
    // input back does not work: a name that is already canonical also echoes,
    // so every correctly-spelled company was being reported as unknown.
    if (!key || CANONICAL_BY_KEY.has(key) || prefixMatch(key)) continue
    if (!seen.has(key)) seen.set(key, text)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/**
 * Distinct spellings in the book that mean the same company, so the owner can
 * see what would merge before anything is rewritten. Reporting only — nothing
 * here changes stored data.
 */
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
