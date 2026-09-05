#!/usr/bin/env node
/**
 * CLI cleanup for E2E-tagged Firestore docs.
 *
 * Usage (staging or E2E_ALLOW_PROD=1 only):
 *   E2E_ALLOW_PROD=1 node e2e/helpers/cleanupCli.js --runId=run_...
 *   node e2e/helpers/cleanupCli.js --dry-run
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS (Firebase Admin service account).
 *
 * SAFETY: only deletes isE2E:true OR E2E_DO_NOT_USE_ prefixed name/policyNumber.
 */

import { createRequire } from 'node:module'
import { evaluateProdGuard, E2E_NAME_PREFIX, E2E_POLICY_PREFIX } from './prodGuard.js'
import { isTaggedClient, isTaggedPolicy, matchesRunId, CLEANUP_SAFETY_NOTICE } from './cleanup.js'

const require = createRequire(import.meta.url)

function parseArgs(argv) {
  const out = { runId: null, dryRun: false }
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') out.dryRun = true
    else if (arg.startsWith('--runId=')) out.runId = arg.slice('--runId='.length)
  }
  return out
}

async function main() {
  console.log(CLEANUP_SAFETY_NOTICE)
  const guard = evaluateProdGuard(process.env)
  if (guard.blocked) {
    console.error(guard.reason)
    process.exit(1)
  }
  if (guard.isProduction && process.env.E2E_ALLOW_PROD !== '1') {
    console.error('Refusing cleanup against production without E2E_ALLOW_PROD=1')
    process.exit(1)
  }

  const { runId, dryRun } = parseArgs(process.argv)
  let admin
  try {
    admin = require('firebase-admin')
  } catch {
    console.error('firebase-admin is required for cleanupCli.js')
    process.exit(1)
  }

  if (!admin.apps.length) {
    try {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT,
      })
    } catch (err) {
      console.error(
        'Could not initialize firebase-admin. Set GOOGLE_APPLICATION_CREDENTIALS to a staging service account.',
        err.message,
      )
      process.exit(1)
    }
  }

  const db = admin.firestore()
  const clientsSnap = await db.collection('clients').get()
  const policiesSnap = await db.collection('policies').get()

  const clients = clientsSnap.docs
    .map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
    .filter((d) => isTaggedClient(d) && matchesRunId(d, runId))

  const policies = policiesSnap.docs
    .map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
    .filter((d) => isTaggedPolicy(d) && matchesRunId(d, runId))

  console.log(
    'Found ' + clients.length + ' tagged clients and ' + policies.length +
      ' tagged policies' + (runId ? ' for runId=' + runId : '') +
      (dryRun ? ' [dry-run]' : ''),
  )

  if (dryRun) {
    for (const c of clients) console.log('  client', c.id, c.name)
    for (const p of policies) console.log('  policy', p.id, p.policyNumber)
    return
  }

  for (const p of policies) {
    if (!String(p.policyNumber || '').startsWith(E2E_POLICY_PREFIX) && p.isE2E !== true) {
      throw new Error('Refusing to delete untagged policy ' + p.id)
    }
    await p.ref.delete()
  }
  for (const c of clients) {
    if (!String(c.name || '').startsWith(E2E_NAME_PREFIX) && c.isE2E !== true) {
      throw new Error('Refusing to delete untagged client ' + c.id)
    }
    await c.ref.delete()
  }
  console.log('Cleanup complete.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
