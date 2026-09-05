/**
 * Lightweight env helpers for E2E (no dotenv dependency).
 * Loads .env / .env.local into process.env if keys are unset.
 */

import fs from 'node:fs'
import path from 'node:path'

const ENV_FILES = ['.env.local', '.env']

export function loadE2EEnvFiles(cwd = process.cwd()) {
  for (const name of ENV_FILES) {
    const full = path.join(cwd, name)
    if (!fs.existsSync(full)) continue
    const text = fs.readFileSync(full, 'utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let val = trimmed.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = val
    }
  }
}

/** True when Vite Firebase web config looks present for a local preview build. */
export function hasLocalFirebaseWebConfig(env = process.env) {
  return Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID)
}

/**
 * Read-only production / preview origin used when local Firebase is not configured.
 * Smoke stays read-only; write specs still require credentials + allow flag.
 */
export const DEFAULT_READ_ONLY_ORIGIN = 'https://gohil-investments.vercel.app'
