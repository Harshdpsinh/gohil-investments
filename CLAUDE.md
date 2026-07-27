# Gohil Investments CRM

Insurance CRM for Gohil Investments (Bhavnagar, Gujarat). One React codebase serves
both the web app and the Android app.

## Stack

- **Frontend:** React 18 + Vite 8, Tailwind CSS, React Router 6
- **Backend:** Firebase (Auth + Firestore). No custom server — Firestore is queried directly from the client.
- **Documents:** Cloudinary (unsigned upload preset)
- **Mobile:** Capacitor 7 Android wrapper
- **Hosting:** Vercel (`gohil-investments.vercel.app`); Netlify config kept as a fallback

## Commands

```bash
npm run dev              # Vite dev server
npm run build            # production build to dist/
npm test                 # Vitest, single run
npm run test:watch       # Vitest, watch mode
npm run lint             # ESLint
npm run android:sync     # build + npx cap sync android
npm run android:apk      # build + assembleDebug
```

`npm run lint` is capped at `--max-warnings 23`, the count as of the last cleanup. This is
a ratchet: it blocks new warnings without blocking the build on existing ones. When you
clear warnings, lower the number — never raise it.

The Android app deliberately loads the live Vercel site rather than bundling `dist/`
(`server.url` in `capacitor.config.json`). This is a deliberate choice: web deploys reach
the app instantly with no rebuild. The trade-off is that the app shows nothing without
internet. Do not remove `server.url` without agreeing a new release process first.
`versionCode` must increase on every Play Store upload.

## Workflow rules

These apply to every code change, without exception.

### 1. Brainstorm before writing code

Run `/brainstorm` first. Lay out the architectural plan and enumerate edge cases
**before** touching any file. Do not skip this because a change looks small — this
codebase has 2,500-line pages where small changes have wide blast radius.

### 2. Tests first

Write the unit tests before the production code. Define the expected behaviour,
then implement against it. Production code written before its tests should be
treated as unfinished.

Vitest is set up. Tests live beside the code as `*.test.js` and run in a Node
environment via `vitest.config.js` (deliberately separate from `vite.config.js` so a
production build never resolves dev tooling).

**Tests must never touch real data.** Firebase is mocked at module level — see
`src/firebase/firestore.test.js` for the pattern. Anything that needs a live Firestore
does not belong in the unit suite.

Pure logic worth testing has been pulled out of the Firebase and React layers into:
- `src/utils/validation.js` — payload normalisation and assertions
- `src/utils/policyImport.js` — fuzzy matching and proposal/lead → policy conversion
- `src/utils/dateUtils.js` — date parsing, frequency, due dates

Keep those three free of any `firebase` or `react` import. That property is what makes
them testable, and it is easy to destroy by accident.

### 3. Isolated git branches

Never commit directly to `main`. Branch for every change:

```bash
git checkout -b feat/short-description
```

## Architecture notes

- `src/firebase/firestore.js` (~1,540 lines) is the single data-access layer. Every
  collection read/write goes through it. Validation now lives in `src/utils/validation.js`
  and is re-exported from here for existing importers — put new validation in the utils
  module, not in pages and not back in this file.
- `src/pages/PoliciesPage.jsx` (~2,420 lines) is still the largest file and the
  highest-risk place to edit. Prefer extracting into `src/utils/policyImport.js` (pure
  logic) or a new component over growing it further.
- Policies cascade: editing a client or policy triggers `cascadeUpdateClient` /
  `cascadeUpdatePolicyLinks` to keep denormalised copies (`clientName`, `clientMobile`)
  in sync. Deletes are soft (`deleted`/`deletedAt`) and admin-gated.
- Roles are `admin` and `staff`, resolved in `src/hooks/useAuth.jsx`. Owner emails are
  hardcoded to admin in both `useAuth.jsx` and `firestore.rules` — keep the two lists
  in sync when changing them.

## Automation

- **Vercel cron**, daily 04:00 UTC → `api/renewal-reminders.js` → WhatsApp renewal
  reminders to clients via Evolution API.
- **GitHub Action**, daily 01:30 UTC → `.github/scripts/send-renewal-alerts.js` →
  renewal summary email to the owner via Gmail SMTP.

These are separate channels, not duplicates. Both read the full `policies` and
`clients` collections on each run.

## Security constraints

- `api/renewal-reminders.js` fails closed: with no `CRON_SECRET` set it returns 503 rather
  than running unauthenticated. `CRON_SECRET` must be set in Vercel or reminders stop.
- Firestore access requires a provisioned `users/{uid}` document with role `admin` or
  `staff`. Being signed in is not sufficient — the Firebase API key is public in the
  client bundle, so auth alone would let anyone self-register into the CRM. Staff accounts
  can only be created by an admin; there is no self-provisioning path.
- Any staff-role user can still read and edit every client, policy, claim and lead. Only
  deletes are admin-gated. There is no per-user data partitioning.
- Never commit credentials. `.gitignore` does not untrack files already added — use
  `git rm --cached <file>` for that.
