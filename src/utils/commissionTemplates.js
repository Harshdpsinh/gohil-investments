// Remembers how an insurer's spreadsheet headers mapped last time.
const KEY = 'gi-commission-templates'

export function loadCommissionTemplates() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveCommissionTemplate(insurer, headers = {}) {
  const name = String(insurer || '').trim()
  if (!name) return loadCommissionTemplates()
  const all = loadCommissionTemplates()
  all[name.toLowerCase()] = {
    insurer: name,
    headers,
    savedAt: new Date().toISOString(),
  }
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* quota */ }
  return all
}

export function templateFor(insurer) {
  if (!insurer) return null
  return loadCommissionTemplates()[String(insurer).trim().toLowerCase()] || null
}

/** True when the uploaded header set is the same as a saved profile. */
export function headersMatchTemplate(row = {}, template) {
  if (!template?.headers) return false
  const got = Object.keys(row).map(k => String(k).toLowerCase().replace(/[^a-z0-9]/g, '')).sort()
  const want = Object.keys(template.headers).map(k => String(k).toLowerCase().replace(/[^a-z0-9]/g, '')).sort()
  if (!want.length || got.length < want.length) return false
  return want.every(h => got.includes(h))
}
