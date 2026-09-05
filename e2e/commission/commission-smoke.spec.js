import { test, expect } from '@playwright/test'
import { canRunAuthenticatedE2E } from '../helpers/prodGuard.js'
import { loginAsE2EUser } from '../helpers/auth.js'

/**
 * Commission Tracker / import UI smoke.
 * Opens the page and (if admin) opens the Import Statement modal,
 * then closes it without uploading files to production storage.
 */
test.describe('Commission Tracker smoke', () => {
  test('opens Commission page and import UI without uploading', async ({ page }) => {
    test.skip(!canRunAuthenticatedE2E(), 'Set E2E_USER and E2E_PASS for commission smoke')

    await loginAsE2EUser(page)
    const provisioned = !(await page.getByText(/account not provisioned/i).isVisible().catch(() => false))
    test.skip(!provisioned, 'E2E user is authenticated but not on the staff list')

    await page.goto('/commission')
    await expect(page).toHaveURL(/\/commission/)
    await expect(page.locator('body')).toBeVisible()
    await expect(page.getByText(/this screen could not open/i)).toHaveCount(0)

    const importBtn = page.getByRole('button', { name: /import statement/i })
    if (await importBtn.isVisible().catch(() => false)) {
      await importBtn.click()
      // Modal should appear; close without selecting a file.
      const closeCandidates = [
        page.getByRole('button', { name: /close|cancel|×/i }).first(),
        page.locator('[aria-label="Close"]').first(),
      ]
      for (const btn of closeCandidates) {
        if (await btn.isVisible().catch(() => false)) {
          await btn.click()
          break
        }
      }
      // Escape as a fallback — still no file upload.
      await page.keyboard.press('Escape')
    }
  })
})
