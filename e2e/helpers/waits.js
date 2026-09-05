/**
 * Shared waits for BootScreen / login readiness.
 */

/**
 * Wait until BootScreen clears and either the login form or an authenticated
 * shell is visible. Firebase Auth must resolve (local preview needs VITE_* or
 * use E2E_BASE_URL against a deployed preview / production).
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ timeout?: number }} [opts]
 */
export async function waitForAuthGate(page, opts = {}) {
  const timeout = opts.timeout ?? 45_000
  const email = page.locator('input[name="email"]')
  const boot = page.getByText(/opening your book/i)
  const provisioned = page.getByText(/account not provisioned/i)
  const dashboardCue = page.getByText(/gohil investments/i).first()

  await email.or(provisioned).or(page.locator('nav')).or(boot).first().waitFor({
    state: 'visible',
    timeout,
  })

  // If still on boot, wait for it to go away (auth resolved).
  if (await boot.isVisible().catch(() => false)) {
    await boot.waitFor({ state: 'hidden', timeout })
  }

  await email.or(provisioned).or(page.locator('nav')).first().waitFor({
    state: 'visible',
    timeout,
  })
}
