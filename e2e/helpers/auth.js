import { waitForAuthGate } from './waits.js'

export function hasE2ECredentials(env = process.env) {
  return Boolean(env.E2E_USER && env.E2E_PASS)
}

/**
 * Sign in via the login form. Call only when E2E_USER / E2E_PASS are set.
 * @param {import('@playwright/test').Page} page
 */
export async function loginAsE2EUser(page, creds = {}) {
  const email = creds.email || process.env.E2E_USER
  const password = creds.password || process.env.E2E_PASS
  if (!email || !password) {
    throw new Error('loginAsE2EUser requires E2E_USER and E2E_PASS')
  }

  await page.goto('/login')
  await waitForAuthGate(page)
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 45_000 })
}
