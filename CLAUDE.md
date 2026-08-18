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

`npm run lint` is capped at `--max-warnings 19`, the count as of the last cleanup. This is
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

Component tests are `*.test.jsx` and opt into a DOM with a `// @vitest-environment jsdom`
docblock on line 1 — the Node default stays for the pure-logic suites, which are the bulk.
Vitest runs without `globals`, so React Testing Library cannot register its own cleanup:
every component test must call `afterEach(cleanup)` itself or renders pile up in
`document.body` and queries start matching two of everything.

**Tests must never touch real data.** Firebase is mocked at module level — see
`src/firebase/firestore.test.js` for the pattern. Anything that needs a live Firestore
does not belong in the unit suite.

Pure logic worth testing has been pulled out of the Firebase and React layers into:
- `src/utils/validation.js` — payload normalisation and assertions
- `src/utils/policyImport.js` — fuzzy matching and proposal/lead → policy conversion
- `src/utils/dateUtils.js` — date parsing, frequency, due dates
- `src/utils/commissionImport.js` — statement column vocabulary, matching, posting keys
- `src/utils/insurers.js` — the insurer list, name canonicalisation, duplicate detection
- `src/utils/commissionReconcile.js` — policy book joined to the posted ledger
- `src/utils/businessDone.js` — financial-year periods, fresh/renewal split, persistency
- `src/utils/pdfProfiles.js` — the six insurer PDF layout parsers

Keep those free of any `firebase` or `react` import — and keep `pdfProfiles.js` free of
`pdfjs-dist` too; `pdfStatement.js` exists solely to own that dependency. That property
is what makes them testable, and it is easy to destroy by accident.

`pdfProfiles.test.js` drives the parsers with hand-built page captures, because the real
statements hold client data and cannot be committed. Each fixture reproduces the geometry
its parser depends on (Aditya Birla's absolute x-bands, Star Health's rotated y-offsets,
the aggregator's nearest-header assignment). If you change a coordinate, that suite is the
only thing standing between a carrier's template change and silently wrong money.

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
- `src/pages/PoliciesPage.jsx` is down to ~830 lines. The form and the bulk-import flow
  now live in `src/components/policies/` (`PolicyForm.jsx`, `ImportModals.jsx`,
  `PolicyPdfUpload.jsx`), moved verbatim. Prefer extracting into
  `src/utils/policyImport.js` (pure logic) or a new component over growing the page again.
- Policies cascade: editing a client or policy triggers `cascadeUpdateClient` /
  `cascadeUpdatePolicyLinks` to keep denormalised copies (`clientName`, `clientMobile`)
  in sync. Deletes are soft (`deleted`/`deletedAt`) and admin-gated.
- Roles are `admin` and `staff`, resolved in `src/hooks/useAuth.jsx`. Owner emails are
  hardcoded to admin in both `useAuth.jsx` and `firestore.rules` — keep the two lists
  in sync when changing them.

## Automation

- **Vercel cron**, daily 04:00 UTC → `api/renewal-reminders.js` → WhatsApp renewal
  reminders to clients via the official WhatsApp Cloud API.
- **GitHub Action**, daily 01:30 UTC → `.github/scripts/send-renewal-alerts.js` →
  renewal summary email to the owner via Gmail SMTP.

These are separate channels, not duplicates. Both read the full `policies` and
`clients` collections on each run.

The email workflow authenticates with the `FIREBASE_SERVICE_ACCOUNT` repo secret that
`deploy-firestore-rules.yml` already needs, so its only unique secret is
`GMAIL_APP_PASSWORD` (`GMAIL_USER` and `ALERT_EMAIL_TO` are set). Until that one is set
the job fails; nothing else is blocked on it.

## Reading a policy PDF

`PdfExtractReview` reads a schedule, matches it to a client **and** a policy, and hands the
values to `PolicyForm` — it never writes a policy itself, so an extracted policy passes the
same validation as a typed one.

Two rules that are easy to break:

- **`splitExtractedFields` must stay in the path.** `normalisePolicyPayload` does *not*
  allow-list its input, so passing the whole extraction to the policy would write the
  client's mobile, PAN and address onto the policy document. Client fields are listed in
  `CLIENT_FIELD_NAMES`.
- **`matchExtractedClient` treats mobile and PAN as identifiers and a name never as one.**
  A name match returns `confirm`, not `link`. Brothers share surnames, and filing a policy
  under the wrong sibling is worse than one extra question. `choose` disables saving.

The schedule is uploaded and attached automatically in `onAdd` once the policy has an id.
`pendingPdf` must be cleared when the add form closes, or the next manually-created policy
gets the previous PDF.

A scan (no text layer) falls back to OCR via `pdfOcr.js` — Tesseract.js WASM running on the
device. Free and unmetered, and the document never leaves the browser, but the engine and
language data (~10MB) are fetched from jsDelivr on first use, so it needs internet once.
It is dynamically imported and only offered after the text layer comes back empty, so it
never touches the main bundle.

Two things that will silently break it:

- `recognize()` **must** be passed `{ text: true, blocks: true }`. tesseract.js v7 defaults
  to `{ text: true }`, which returns no word positions at all — extraction then degrades to
  flat text and two-column schedules read wrongly, without any error.
- Positions arrive as `blocks[].paragraphs[].lines[].words[]` in **canvas** coordinates
  (y down). `ocrLines.js` flips them to PDF coordinates and divides by the render scale;
  the extractor's column window is a fixed 60 points and would be meaningless at 2x.

Everything OCR reads is forced to `uncertain` by `markAllUncertain`, so the whole review
comes up yellow. OCR confuses 8/B, 0/O and 1/7, and a misread premium shown as confidently
green would go straight onto the record.

Re-reading a file already on record is caught by `policyPdfHash`, a SHA-256 of the bytes
taken with the browser's built-in Web Crypto and stored by `savePolicyPdfUrl`.

## Insurer names

`src/utils/insurers.js` is the only list. There were three — `constants.js`,
`policySchemas.js` and an inline one in `RenewalsPage` — and they had drifted, so a company
appeared in one dropdown and not another. Both `KNOWN_INSURERS` exports now re-export from
here; do not reintroduce a local list.

Every insurer field is **free-type** (a `datalist`, never a closed `<select>`). A carrier
missing from the list must never block entering a policy or importing a statement, and
whatever is typed is stored verbatim and offered back as an option afterwards.

`insurerKey()` strips line-of-business and legal-form noise so "HDFC ERGO", "HDFC ERGO
General Insurance" and "HDFC ERGO Motor" collapse to one key. It deliberately does **not**
strip `life` or `health`: those are the only thing separating Aditya Birla Health Insurance
from Aditya Birla Sun Life, ICICI Lombard from ICICI Prudential, and SBI General from SBI
Life. Grouping goes through `groupKey()` (alias first, then key) — a raw key would leave
"Star Health" and "Star Health and Allied Insurance" as two companies.

Reports canonicalise; **stored data is never rewritten**. Business Done lists the variants
it merged so the owner can decide whether to clean the underlying records.

## Revenue reporting

Two questions the app answers separately, and they must not be merged:

- **Business Done** (`/business`) — what was *sold*. Driven by the policy book, keyed on
  `startDate`, because insurer statements land 30-90 days late and a ledger-driven
  production report would understate the current month forever. Fresh vs Renewal comes
  from `parentPolicyId`/`policyYear`, which `renewPolicy` writes — no statement needed.
- **Commission reconciliation** (on `/commission`) — what was *paid for*. Joins each
  policy to `commission_transactions` and buckets it: settled, short paid, overpaid, not
  received, no rate on file.

Periods are **April-March**. A calendar year matches no insurer's target sheet and no tax
year, so `businessDone.js` owns the FY maths and nothing should reimplement it.

Reconciliation reads the **whole** ledger. `getCommissionTransactionsPage` pages 100 at a
time, and on a partial ledger a policy paid on an unloaded page reads as unpaid — the
panel shows an amber warning until the full ledger is loaded. Do not remove that guard.

`expectedCommission`, `difference`, `tds` and `gst` were written as `0` on every row
posted before Aug 2026. Historical rows will show no TDS and a misleading difference;
re-import a statement to backfill it.

## WhatsApp

Sending runs on the official **WhatsApp Cloud API** (Meta Graph). Evolution API and its
localStorage credentials are gone — an unofficial Baileys bridge risks the firm's number
being banned, and a token that can message the whole client book must never sit in a
browser.

The rule that shapes the code: a message the business starts, outside a 24-hour window
opened by the client's own reply, **must** be a Meta-approved template. Free text is
rejected. So `buildRenewalReminderMessage` is only ever a preview written to
`renewal_reminder_logs`; what a client actually receives is the template named by
`WHATSAPP_TEMPLATE_NAME`, filled from `buildRenewalReminderDetail`. Change the template's
wording in Meta Business Manager, not here — and if you change its **variable count or
order**, set `WHATSAPP_TEMPLATE_PARAMS` to match or every send fails.

- `src/utils/whatsappCloud.js` — pure payload shaping (E.164, parameters, error decoding).
  No firebase, no react, no network. Tested.
- `api/_shared.js` — server-only Firebase Admin + Graph sender. Leading `_` keeps Vercel
  from routing it as an endpoint.
- `api/whatsapp-send.js` — what the browser calls. Verifies a Firebase ID token **and** a
  provisioned `users/{uid}` role, because the API key is public.
- `src/utils/whatsappSender.js` — browser client. Posts to the endpoint; holds no secrets.

The green "WhatsApp Reminder" buttons on Renewals and Policies are unrelated: they are
`wa.me` deeplinks that open WhatsApp for a human to press send, and need no API at all.

### Inbox

`/inbox` reads `whatsapp_messages`, written **only** by the server: `api/whatsapp-webhook.js`
(inbound messages and delivery receipts) and `api/whatsapp-send.js` (outbound). The browser
may read, and may set `read` — nothing else, enforced in `firestore.rules`.

The webhook URL is public, so every POST is checked against `WHATSAPP_APP_SECRET` with
`timingSafeEqual` before anything is trusted. The signature covers the **raw bytes**, which
is why `bodyParser` is disabled — re-serialising the JSON reorders keys and the digest stops
matching. It always answers 200; Meta retries anything else.

Message id is the Firestore doc id, so Meta's retries overwrite instead of duplicating a
conversation.

The 24-hour window is driven by the client's **inbound** messages only — our own replies do
not extend it. That is the most common misunderstanding of this API, and `windowState`
is the single place it is decided.

Server env vars (Vercel): `WHATSAPP_TOKEN` (a **System User** token — the dashboard's
temporary token dies after 24h), `WHATSAPP_PHONE_NUMBER_ID`, and optionally
`WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG`, `WHATSAPP_TEMPLATE_PARAMS`,
`WHATSAPP_API_VERSION`, `WHATSAPP_DEFAULT_COUNTRY_CODE`.
The inbox additionally needs `WHATSAPP_VERIFY_TOKEN` (any string you choose, entered in
Meta when saving the webhook) and `WHATSAPP_APP_SECRET` (from the app's Basic Settings).

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
