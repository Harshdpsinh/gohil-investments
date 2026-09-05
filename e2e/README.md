# Playwright E2E (isolated)

Isolated end-to-end smoke for Gohil Investments CRM.

Designed so a default run **cannot** corrupt production Firebase data.

## Quick start

1. Build the app (vite build).
2. Run the Playwright suite via package script test:e2e (or test:e2e:ui).
3. Or set E2E_BASE_URL to a Vercel preview origin, then run the same script.

## What runs by default (no secrets)

| Spec | Behaviour |
|------|-----------|
| e2e/smoke/login.spec.js | Loads /login; unauthenticated /dashboard redirects to /login |
| e2e/smoke/page-walk.spec.js | Protected routes redirect to login (read-only) |
| Authenticated page walk | Skipped without E2E_USER / E2E_PASS |
| CRUD (e2e/crud/) | Skipped without credentials + staging (or E2E_ALLOW_PROD=1) |
| Commission import UI | Skipped without credentials; never uploads files |

**CI:** E2E can be skipped when secrets are absent. Unit tests and production build remain required.

## Production Firebase guard

On startup, playwright.config.js calls assertE2EProdGuard():

- If VITE_FIREBASE_PROJECT_ID is gohil-investments (production) AND
  E2E_ALLOW_PROD is not exactly 1, the suite **refuses to start**.
- Point VITE_* at a **staging** Firebase project for routine write tests, or
  set E2E_ALLOW_PROD=1 only for carefully tagged runs.

Guard implementation: e2e/helpers/prodGuard.js (covered by Vitest).

## Isolation rules (mandatory)

1. All fake entities MUST use isE2E: true and/or name / policyNumber prefix
   E2E_DO_NOT_USE_ plus an e2eRunId (see e2e/helpers/tags.js).
2. NEVER delete untagged clients or policies.
3. NEVER run Backup restore against production (page-walk opens /backup
   read-only and does not click restore).
4. Do not upload large commission statements to prod storage without tags.
5. Prefer local preview or a Vercel preview URL — not ad-hoc writes to live CRM.

## Required / optional env vars

| Variable | Required for | Purpose |
|----------|--------------|---------|
| VITE_FIREBASE_PROJECT_ID | Guard | Detect production vs staging |
| E2E_ALLOW_PROD | Write-on-prod only | Must be 1 to allow suite start / writes on prod project |
| E2E_USER / E2E_PASS | Auth walk, CRUD, commission | Staff login |
| E2E_BASE_URL | Optional | External preview URL (skips local webServer) |
| E2E_PORT | Optional | Local preview port (default 4173) |
| GOOGLE_APPLICATION_CREDENTIALS | Cleanup CLI | Staging Admin SDK for tagged hard-delete |

## Pointing at staging

1. Create a Firebase staging project (or emulator) with the same Auth + Firestore shape.
2. Copy staging web config into .env.local (VITE_FIREBASE_*).
3. Build the app.
4. Create a staff user matching E2E_USER / E2E_PASS.
5. Export E2E_USER and E2E_PASS, then run package script test:e2e.

With staging credentials, CRUD may create clients named
E2E_DO_NOT_USE_<e2eRunId>_Client and notes containing isE2E=true e2eRunId=...

## Cleanup helper

Dry-run (lists only tagged docs):

    node e2e/helpers/cleanupCli.js --dry-run

Delete tagged docs for one run (staging or E2E_ALLOW_PROD=1):

    E2E_ALLOW_PROD=1 node e2e/helpers/cleanupCli.js --runId=run_YYYYMMDDHHMMSS_xxxxxx

Cleanup **only** targets isE2E:true and/or E2E_DO_NOT_USE_ prefixes.
It refuses to start against production without E2E_ALLOW_PROD=1.

## Scripts

- test:e2e → playwright test
- test:e2e:ui → playwright test --ui

Install browsers once: npx playwright install chromium


## Local preview vs deployed origin

If VITE_FIREBASE_API_KEY and VITE_FIREBASE_PROJECT_ID are not set in the environment
(or .env.local), Playwright targets https://gohil-investments.vercel.app for read-only
smokes so Auth can resolve. With local Vite Firebase config present, it uses the local
preview webServer instead. Write/CRUD specs still require E2E_USER/E2E_PASS and staging
(or E2E_ALLOW_PROD=1) and never run by default against production.

