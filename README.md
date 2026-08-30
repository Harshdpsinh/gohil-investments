# Gohil Investments CRM

Insurance operations CRM for **Gohil Investments** (Bhavnagar, Gujarat).

One React app serves the website and the Android wrapper. Staff log in, manage clients and policies, track renewals and commission, and talk to clients on WhatsApp from the same inbox.

**Live:** [https://gohil-investments.vercel.app](https://gohil-investments.vercel.app)

This is a private business tool. Sign-in is required. A Firebase login is not enough — an admin must add the user under **Manage Staff** (`admin` or `staff`) before the CRM opens.

## What it does

| Area | What you can do |
| --- | --- |
| Dashboard | Snapshot of work, shortcuts, global search |
| Clients | Client book, profile, documents |
| Policies | Add / edit / renew, PDF schedule extract, searchable names |
| Renewals & pipeline | Due renewals, persistency |
| Installments | Premium installment follow-up |
| Cross-sell | Coverage gaps |
| Proposals | Quotes before a policy is issued |
| Business Done | What was *sold* (April–March FY, fresh vs renewal) |
| Commission | What was *paid* — statement import, match to policies, TDS / net |
| Claims | Claim files linked to clients / policies |
| WhatsApp Inbox | Official Cloud API inbox, templates, 24-hour reply window |
| Reports | Production and operational reports |
| Staff | Admin-only user provisioning |
| Backup | Download / restore CRM JSON (permission-denied collections are skipped) |

Business Done and Commission are **not** the same report. Sold business uses policy start dates. Paid commission uses the ledger, because insurer statements often arrive 30–90 days late.

## Stack

- **Web:** React 18, Vite, Tailwind CSS, React Router 6
- **Data / auth:** Firebase Auth + Firestore
- **Files:** Cloudinary
- **WhatsApp:** Meta Cloud API (`api/whatsapp-webhook.js`, `api/whatsapp-send.js`)
- **Host:** Vercel (`gohil-investments.vercel.app`)
- **Android:** Capacitor 7 wrapper that loads the live Vercel site
- **Tests:** Vitest

## Local run

Needs Node.js 20+.

```bash
npm install
npm run dev
```

Other commands:

```bash
npm run build          # production build → dist/
npm test               # Vitest once
npm run test:watch
npm run lint
npm run android:sync   # web build + Capacitor sync
npm run android:apk    # debug APK (Windows)
```

Point a `.env` at the same Firebase project the live site uses, or you will see an empty database. Never commit `.env` or service-account JSON.

## Production (Vercel)

The `main` branch deploys to Vercel. After changing **Environment Variables**, **Redeploy** or the old values stay in the running functions.

### Client (Vite) variables

These are public in the browser bundle. They identify the Firebase project; they do not grant CRM access by themselves.

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- Cloudinary unsigned preset values used by the browser upload path

### Server (Vercel functions) variables

| Variable | Purpose |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Admin SDK for webhooks, send, backup-related server work |
| `CRON_SECRET` | Daily renewal cron. If missing, the cron fails closed (503) |
| `WHATSAPP_TOKEN` | **System User** token (dashboard 24-hour tokens expire) |
| `WHATSAPP_PHONE_NUMBER_ID` | Cloud API phone number id |
| `WHATSAPP_APP_SECRET` | Verifies inbound webhook signatures |
| `WHATSAPP_VERIFY_TOKEN` | Same string you type in Meta → Verify token |
| `WHATSAPP_TEMPLATE_NAME` | Approved renewal template (default `renewal_reminder`) |
| `WHATSAPP_TEMPLATE_LANG` | Template language (default `en`) |
| `WHATSAPP_TEMPLATE_PARAMS` | Variable order if the Meta template changes |
| `WHATSAPP_DEFAULT_COUNTRY_CODE` | Default `91` |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Signed server uploads for inbound WhatsApp media |

## WhatsApp Cloud API

Webhook (Meta Callback URL):

```text
https://gohil-investments.vercel.app/api/whatsapp-webhook
```

1. Put `WHATSAPP_VERIFY_TOKEN` in Vercel Production and **Redeploy**.
2. In Meta, paste the URL + the same verify token → **Verify and save**.
3. Subscribe to the **`messages`** field.
4. **Publish** the Meta app. Unpublished apps only get dashboard test webhooks.
5. Use a System User token, not a temporary dashboard token.

Meta will not accept `*.vercel.app` as the *business website* during company verification. That field needs a domain you own (for example `gohilinvestments.com`) pointed at this Vercel project. The webhook URL above still uses the Vercel hostname and that is correct.

Outbound free text is allowed only inside the 24-hour window opened by the **client’s** last inbound message. Outside that window, send an approved template.

Turn **Vercel Deployment Protection** off for this project (or allow unauthenticated `/api/whatsapp-webhook`). Meta cannot pass a Vercel login page.

## Backup

**Backup → Download Full Backup** writes clients, policies, claims, commission, and related records to one JSON file. Keep a copy on Google Drive or an external disk.

- Restore updates matching records and adds missing ones.
- Inbox messages are not overwritten.
- Firebase Auth passwords and deleted Storage files are not restored.
- If a collection is denied by rules (for example `client_activities`), backup **skips it** and still downloads the rest.

Take a backup before insurer-name merge or any bulk data change.

## Android

The APK loads the live website. A normal Vercel deploy updates the phone app without a new APK.

Rebuild the APK only for icon, name, package id, or Capacitor config. See [ANDROID_APP_GUIDE.md](ANDROID_APP_GUIDE.md).

The phone needs internet. `server.url` in `capacitor.config.json` is intentional — do not remove it without a new release process.

## Roles

- **admin** — full CRM, staff management, deletes, backup restore / merge tools
- **staff** — day-to-day clients, policies, claims, inbox (no deletes)

Owner emails are hardcoded as admin in `src/hooks/useAuth.jsx` **and** `firestore.rules`. Keep both lists in sync.

There is no self-signup into the CRM.

## Repo map

```text
src/pages/           screens
src/components/      forms, layout, searchable selects
src/firebase/        Firestore access, backup, insurer merge
src/utils/           validation, commission, insurers, WhatsApp helpers
api/                 Vercel functions (webhook, send, renewal cron)
firestore.rules      access control — deploy with Firebase CLI when rules change
storage.rules        Storage access control
```

Data shape: [schema_reference.md](schema_reference.md).  
Contributor / architecture notes: [CLAUDE.md](CLAUDE.md).

## Safety

- Do not commit secrets, service accounts, or the Node installer that was accidentally added to git history.
- Do not rewrite commission / renewal / persistency logic unless the owner asked.
- Prefer a branch + PR for code changes. `main` is production.
