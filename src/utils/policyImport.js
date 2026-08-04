// src/utils/policyImport.js
// Pure helpers lifted out of pages/PoliciesPage.jsx: fuzzy client matching, the
// blank policy form shape, and the proposal/lead → policy conversions used when
// importing. No React and no Firebase, so this is directly unit testable.
import { normaliseFrequency, parseAnyDate } from './dateUtils'
import { getTypeDefaults } from './policySchemas'
import { POLICY_TYPES, POLICY_STATUSES, POLICY_FREQUENCIES } from './validation'

// Single source of truth — these used to be duplicated verbatim in PoliciesPage.
export const TYPES = POLICY_TYPES
export const FREQS = POLICY_FREQUENCIES
export const STATUS = POLICY_STATUSES

export const POLICY_PAGE_SIZE = 50

export const ADDONS = [
  ['zeroDep','Zero Dep'],['engineProtect','Engine Protect'],['rsa','RSA'],
  ['keyReplace','Key Replace'],['consumables','Consumables'],
  ['returnToInvoice','Return to Invoice'],['tyreProtect','Tyre Protect'],
  ['personalAccident','Personal Accident'],
]

export const BASE_EMPTY = {
  policyNumber:'', clientId:'', clientName:'', policyType:'Health',
  insurer:'', planName:'', premium:'', sumAssured:'', frequency:'Yearly',
  isMultiYearPolicy:false, coverageTermYears:1,
  startDate:'', expiryDate:'', nextPremiumDue:'', status:'Active',
  nominee:'', nomineeRelation:'',
  fyCommission:'', ryCommission:'', notes:''
}

// ── Fuzzy match (Levenshtein distance) ───────────────────────
export function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({length: m+1}, (_,i) => Array.from({length: n+1}, (_,j) => j === 0 ? i : 0))
  for (let j = 1; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

export function fuzzyMatch(input, candidates, threshold = 0.75) {
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

export const isLifePolicyType = (type = '') => String(type || '').trim().toLowerCase() === 'life'

export function policyDocumentYear(policy = {}) {
  if (policy.policyPdfYear) return policy.policyPdfYear
  if (policy.policyYear) return policy.policyYear
  const date = parseAnyDate(policy.expiryDate || policy.nextPremiumDue || policy.startDate)
  return date ? String(date.getFullYear()) : String(new Date().getFullYear())
}

export function buildImportClientReview(imported, matchedClient) {
  if (!matchedClient?.id) return null
  const issues = []
  const importedName = String(imported.clientName || '').trim()
  const matchedName = String(matchedClient.name || '').trim()
  const importedMobile = String(imported.clientMobile || '').replace(/\D/g, '').slice(-10)
  const matchedMobile = String(matchedClient.mobile || '').replace(/\D/g, '').slice(-10)
  const importedEmail = String(imported.clientEmail || '').trim().toLowerCase()
  const matchedEmail = String(matchedClient.email || '').trim().toLowerCase()

  if (importedName && matchedName && importedName.toLowerCase() !== matchedName.toLowerCase()) {
    issues.push(`Name differs: import "${importedName}", client "${matchedName}"`)
  }
  if (importedMobile && matchedMobile && importedMobile !== matchedMobile) {
    issues.push('Mobile differs from matched client')
  }
  if (importedEmail && matchedEmail && importedEmail !== matchedEmail) {
    issues.push('Email differs from matched client')
  }

  if (issues.length === 0) return null
  return {
    clientReviewRequired: true,
    clientReviewStatus: 'potential_match',
    clientReviewReason: issues.join('; '),
    importMatchedClientId: matchedClient.id,
    importMatchedClientName: matchedClient.name || '',
    importOriginalClientName: importedName,
    importOriginalClientMobile: imported.clientMobile || '',
    importOriginalClientEmail: imported.clientEmail || '',
  }
}

export function proposalToPolicyInitial(proposal, clients = []) {
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

