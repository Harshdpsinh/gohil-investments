import { test, expect } from '@playwright/test'
import { APP_ROUTES } from '../helpers/routes.js'
import { canRunAuthenticatedE2E } from '../helpers/prodGuard.js'
import { loginAsE2EUser, hasE2ECredentials } from '../helpers/auth.js'
import { waitForAuthGate } from '../helpers/waits.js'

/**
 * Page-walk smoke covering major App.jsx routes.
 *
 * Without E2E_USER/E2E_PASS: asserts protected routes redirect to login
 * (read-only, no writes). With credentials: signs in and walks each route
 * without creating/updating CRM data.
 */
test.describe('Page walk smoke', () => {
  test('protected routes redirect to login when unauthenticated', async ({ page }) => {
    test.skip(hasE2ECredentials(), 'Authenticated session would not redirect')

    for (const route of APP_ROUTES.slice(0, 6)) {
      await page.goto(route)
      await page.waitForURL(/\/login/, { timeout: 45_000 })
      await waitForAuthGate(page)
      await expect(page.locator('input[name="email"]')).toBeVisible()
    }
  })

  test('authenticated walk of major routes (read-only)', async ({ page }) => {
    test.skip(!canRunAuthenticatedE2E(), 'Set E2E_USER and E2E_PASS to run authenticated page walk')

    await loginAsE2EUser(page)

    const provisioned = !(await page.getByText(/account not provisioned/i).isVisible().catch(() => false))
    test.skip(!provisioned, 'E2E user is authenticated but not on the staff list')

    for (const route of APP_ROUTES) {
      // Navigation only — never trigger Backup restore or other destructive controls.
      await page.goto(route)
      if (route === '/backup') {
        await expect(page).toHaveURL(/\/backup/)
        await expect(page.locator('body')).toBeVisible()
        continue
      }
      await expect(page).not.toHaveURL(/\/login/)
      await expect(page.locator('body')).toBeVisible()
      await expect(page.getByText(/this screen could not open/i)).toHaveCount(0)
    }
  })
})
