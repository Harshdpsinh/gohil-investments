import { test, expect } from '@playwright/test'
import { canRunWriteE2E } from '../helpers/prodGuard.js'
import { loginAsE2EUser } from '../helpers/auth.js'
import { makeE2ERunId, taggedClientFields, taggedPolicyNumber } from '../helpers/tags.js'
import { cleanupTaggedClientsViaUI, CLEANUP_SAFETY_NOTICE } from '../helpers/cleanup.js'

/**
 * Optional authenticated CRUD behind env credentials.
 * Creates ONLY E2E_DO_NOT_USE_-prefixed data. Requires E2E_USER, E2E_PASS,
 * and either a non-production VITE_FIREBASE_PROJECT_ID or E2E_ALLOW_PROD=1.
 *
 * NEVER deletes untagged clients/policies. Prefer cleanupCli.js after runs.
 */
test.describe('Tagged CRUD smoke', () => {
  let e2eRunId
  let clientFields

  test.beforeAll(() => {
    e2eRunId = makeE2ERunId()
    clientFields = taggedClientFields(e2eRunId)
    console.log(CLEANUP_SAFETY_NOTICE)
    console.log('e2eRunId=', e2eRunId)
  })

  test.beforeEach(async ({ page }) => {
    test.skip(
      !canRunWriteE2E(),
      'Write CRUD requires E2E_USER/E2E_PASS and staging Firebase (or E2E_ALLOW_PROD=1)',
    )
    await loginAsE2EUser(page)
    const provisioned = !(await page.getByText(/account not provisioned/i).isVisible().catch(() => false))
    test.skip(!provisioned, 'E2E user is authenticated but not on the staff list')
  })

  test.afterAll(async ({ browser }) => {
    if (!canRunWriteE2E()) return
    const page = await browser.newPage()
    try {
      await loginAsE2EUser(page)
      await cleanupTaggedClientsViaUI(page, e2eRunId)
    } catch (err) {
      console.warn('afterAll cleanup note:', err.message)
    } finally {
      await page.close()
    }
  })

  test('create E2E-tagged client via UI', async ({ page }) => {
    await page.goto('/clients')
    await page.getByRole('button', { name: /add client/i }).click()
    await expect(page.getByText(/add new client/i)).toBeVisible()

    const nameInput = page.getByPlaceholder(/hemrajsinh/i)
    await nameInput.fill(clientFields.name)

    const notes = page.locator('form textarea').first()
    await notes.fill(clientFields.notes)

    await page.getByRole('button', { name: /save client/i }).click()
    await expect(page.getByText(clientFields.name, { exact: false }).first()).toBeVisible({ timeout: 30_000 })
  })

  test('open Add Policy modal then cancel (no untagged write)', async ({ page }) => {
    const policyNo = taggedPolicyNumber(e2eRunId)
    expect(policyNo.startsWith('E2E_DO_NOT_USE_')).toBeTruthy()

    await page.goto('/policies')
    await page.getByRole('button', { name: /add policy/i }).click()
    await expect(page.getByText(/add new policy/i)).toBeVisible()

    // Cancel without saving — avoids incomplete / untagged policy writes.
    const cancel = page.getByRole('button', { name: /cancel/i }).first()
    if (await cancel.isVisible().catch(() => false)) {
      await cancel.click()
    } else {
      await page.keyboard.press('Escape')
    }
  })
})
