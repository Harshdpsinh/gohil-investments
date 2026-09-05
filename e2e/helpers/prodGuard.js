/**
 * Production Firebase guard for Playwright E2E.
 *
 * The suite refuses to start when VITE_FIREBASE_PROJECT_ID matches a known
 * production project AND E2E_ALLOW_PROD is not exactly "1".
 */

export const PRODUCTION_PROJECT_IDS = Object.freeze([
  'gohil-investments',
])

export const E2E_NAME_PREFIX = 'E2E_DO_NOT_USE_'
export const E2E_POLICY_PREFIX = 'E2E_DO_NOT_USE_'

export function evaluateProdGuard(env = process.env) {
  const projectId = String(env.VITE_FIREBASE_PROJECT_ID || '').trim()
  const allowProd = env.E2E_ALLOW_PROD === '1'
  const isProduction =
    Boolean(projectId) &&
    PRODUCTION_PROJECT_IDS.some((id) => id.toLowerCase() === projectId.toLowerCase())

  if (isProduction && !allowProd) {
    return {
      projectId,
      isProduction: true,
      allowProd: false,
      blocked: true,
      reason:
        'E2E refused to start: VITE_FIREBASE_PROJECT_ID="' + projectId + '" looks like production ' +
        'and E2E_ALLOW_PROD is not "1". Point VITE_* at a staging Firebase project, or set ' +
        'E2E_ALLOW_PROD=1 only for carefully tagged (isE2E / E2E_DO_NOT_USE_) runs.',
    }
  }

  return {
    projectId,
    isProduction,
    allowProd,
    blocked: false,
    reason: null,
  }
}

export function assertE2EProdGuard(env = process.env) {
  const result = evaluateProdGuard(env)
  if (result.blocked) {
    throw new Error(result.reason)
  }
  return result
}

export function canRunWriteE2E(env = process.env) {
  const guard = evaluateProdGuard(env)
  if (guard.blocked) return false
  if (!env.E2E_USER || !env.E2E_PASS) return false
  if (guard.isProduction && env.E2E_ALLOW_PROD !== '1') return false
  return true
}

export function canRunAuthenticatedE2E(env = process.env) {
  const guard = evaluateProdGuard(env)
  if (guard.blocked) return false
  return Boolean(env.E2E_USER && env.E2E_PASS)
}
