import { test, expect } from '@playwright/test'
import { waitForAuthGate } from '../helpers/waits.js'

/**
 * Always-on smoke: login page loads. No credentials, no writes.
 * Uses deployed origin when local Vite Firebase config is absent
 * (see playwright.config.js + e2e/helpers/env.js).
 */
test.describe('Login gate smoke', () => {
  test('loads login page with email/password fields', async ({ page }) => {
    await page.goto('/login')
    await waitForAuthGate(page)
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible()
    await expect(page.locator('input[name="email"]')).toBeVisible()
    await expect(page.locator('input[name="password"]')).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('unauthenticated /dashboard redirects to /login', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForURL(/\/login/, { timeout: 45_000 })
    await waitForAuthGate(page)
    await expect(page.locator('input[name="email"]')).toBeVisible()
  })
})
