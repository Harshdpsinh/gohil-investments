/**
 * Cleanup helpers for E2E-tagged Firestore documents.
 *
 * SAFETY:
 * - Only deletes clients/policies whose name or policyNumber starts with
 *   E2E_DO_NOT_USE_ and/or have isE2E === true (and optionally matching e2eRunId).
 * - NEVER deletes untagged clients/policies.
 * - NEVER runs Backup restore.
 */

import { E2E_NAME_PREFIX, E2E_POLICY_PREFIX } from './prodGuard.js'

export function isTaggedClient(doc) {
  if (!doc || typeof doc !== 'object') return false
  if (doc.isE2E === true) return true
  return String(doc.name || '').startsWith(E2E_NAME_PREFIX)
}

export function isTaggedPolicy(doc) {
  if (!doc || typeof doc !== 'object') return false
  if (doc.isE2E === true) return true
  const policyNumber = String(doc.policyNumber || '')
  const clientName = String(doc.clientName || '')
  return (
    policyNumber.startsWith(E2E_POLICY_PREFIX) ||
    clientName.startsWith(E2E_NAME_PREFIX)
  )
}

export function matchesRunId(doc, e2eRunId) {
  if (!e2eRunId) return true
  return JSON.stringify(doc).includes(e2eRunId)
}

export function selectTaggedForCleanup(docs, { e2eRunId, kind = 'client' } = {}) {
  const pred = kind === 'policy' ? isTaggedPolicy : isTaggedClient
  return (docs || []).filter((d) => pred(d) && matchesRunId(d, e2eRunId))
}

/**
 * Best-effort UI cleanup: search clients by E2E prefix.
 * @param {import('@playwright/test').Page} page
 * @param {string} e2eRunId
 */
export async function cleanupTaggedClientsViaUI(page, e2eRunId) {
  const needle = E2E_NAME_PREFIX + e2eRunId
  await page.goto('/clients')
  const search = page.getByPlaceholder(/search by name|search clients|search/i).first()
  if (await search.isVisible().catch(() => false)) {
    await search.fill(needle)
  }
  const row = page.getByText(needle, { exact: false }).first()
  if (!(await row.isVisible({ timeout: 5_000 }).catch(() => false))) {
    return { deleted: 0, reason: 'no-tagged-rows' }
  }
  // Prefer CLI cleanup for hard deletes; UI path confirms the tag is findable.
  return { deleted: 0, reason: 'use-cleanupCli-for-hard-delete', needle }
}

export const CLEANUP_SAFETY_NOTICE =
  'Cleanup only targets docs with isE2E:true and/or name/policyNumber prefix E2E_DO_NOT_USE_. ' +
  'Never delete untagged clients/policies. Never run Backup restore against prod.'
