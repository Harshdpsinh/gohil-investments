// @ts-check
import { defineConfig, devices } from '@playwright/test'
import { assertE2EProdGuard } from './e2e/helpers/prodGuard.js'
import {
  loadE2EEnvFiles,
  hasLocalFirebaseWebConfig,
  DEFAULT_READ_ONLY_ORIGIN,
} from './e2e/helpers/env.js'

loadE2EEnvFiles()

// Fail fast before any browser launches when pointing at production without opt-in.
assertE2EProdGuard()

const PORT = Number(process.env.E2E_PORT || 4173)
const baseURL =
  process.env.E2E_BASE_URL ||
  (hasLocalFirebaseWebConfig()
    ? ('http://127.0.0.1:' + PORT)
    : DEFAULT_READ_ONLY_ORIGIN)
const useExternalServer = Boolean(process.env.E2E_BASE_URL) || !hasLocalFirebaseWebConfig()

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.js/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    ...devices['Desktop Chrome'],
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: useExternalServer
    ? undefined
    : {
        command: 'npm run preview -- --host 127.0.0.1 --port ' + PORT,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})