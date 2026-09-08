// Duplicate-client grouping for CliMer. Pure — no Firebase, no React.

export function mobileDigits(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : (digits.length >= 8 ? digits : '')
}

/** Higher = better golden record. Longer official names beat "ketan Bhai". */
export function completenessScore(client = {}, policyCount = 0) {
  let n = 0
  if (String(client.mobile || '').replace(/\D/g, '').length >= 10) n += 2
  if (client.email) n += 2
  if (client.pan) n += 2
  if (client.aadhar) n += 1
  if (client.address) n += 1
  if (client.dob) n += 1
  n += Math.min(Number(policyCount) || 0, 5)
  n += Math.min(String(client.name || '').trim().length / 8, 4)
  return n
}

/**
 * Groups that share a 10-digit mobile. Name-only lookalikes are not clustered
 * here — those belong in Family Link, not merge.
 */
export function duplicateClusters(clients = [], policyCountByClient = {}) {
  const byMobile = new Map()
  for (const client of clients) {
    if (client?.mergedIntoClientId) continue
    const mobile = mobileDigits(client.mobile)
    if (!mobile) continue
    const list = byMobile.get(mobile) || []
    list.push(client)
    byMobile.set(mobile, list)
  }
  const clusters = []
  for (const [mobile, members] of byMobile) {
    if (members.length < 2) continue
    const ranked = members
      .map(c => ({
        ...c,
        _policyCount: policyCountByClient[c.id] ?? c._policyCount ?? 0,
        _score: completenessScore(c, policyCountByClient[c.id] ?? c._policyCount ?? 0),
      }))
      .sort((a, b) => b._score - a._score || String(a.name).localeCompare(String(b.name)))
    clusters.push({
      key: `m:${mobile}`,
      reason: 'Same mobile',
      mobile,
      members: ranked,
      suggestedMasterId: ranked[0].id,
    })
  }
  return clusters.sort((a, b) => b.members.length - a.members.length)
}
