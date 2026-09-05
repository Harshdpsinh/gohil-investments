import { E2E_NAME_PREFIX, E2E_POLICY_PREFIX } from './prodGuard.js'

export function makeE2ERunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const rand = Math.random().toString(36).slice(2, 8)
  return 'run_' + stamp + '_' + rand
}

/**
 * Build tagged client fields for safe isolation.
 * UI forms do not expose isE2E; name + notes carry the markers.
 * Cleanup helpers also match isE2E === true when present on docs.
 */
export function taggedClientFields(e2eRunId, overrides = {}) {
  const name = E2E_NAME_PREFIX + e2eRunId + '_Client'
  const safeName =
    overrides.name && String(overrides.name).startsWith(E2E_NAME_PREFIX)
      ? overrides.name
      : name
  return {
    mobile: overrides.mobile || '9000000001',
    email: overrides.email || ('e2e.' + e2eRunId.toLowerCase() + '@example.com'),
    ...overrides,
    name: safeName,
    notes: 'isE2E=true e2eRunId=' + e2eRunId + ' DO_NOT_USE',
  }
}

export function taggedPolicyNumber(e2eRunId, suffix = 'P1') {
  return E2E_POLICY_PREFIX + e2eRunId + '_' + suffix
}

export { E2E_NAME_PREFIX, E2E_POLICY_PREFIX }
