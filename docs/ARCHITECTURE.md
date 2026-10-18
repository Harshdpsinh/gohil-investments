# ARCHITECTURE

## Prompt

Extend the shape below. Do not add a second backend, a second database, or a second WhatsApp sender.

## Shape

```text
Browser (Vite + React)
  ├─ Firebase Auth          sign-in
  ├─ Firestore              client SDK, rules in firestore.rules
  └─ /api/* on Vercel       only where a secret is required

Android (Capacitor) loads https://gohil-investments.vercel.app
  The phone app is not a separate bundle of dist/.
```

## Layers

| Layer | Path | Rule |
| --- | --- | --- |
| Screens | `src/pages/`, `src/components/` | No money maths here |
| Pure logic | `src/utils/` | No `firebase` or `react` import |
| Data access | `src/firebase/firestore.js`, `commissionOps.js`, `storage.js` | Every collection write goes through here |
| Auth | `src/hooks/useAuth.jsx`, `src/utils/roles.js` | Roles: `admin`, `staff`, `reader` |
| Secrets | `api/*.js` | Firebase Admin. A leading `_` file is not a route |

`firestore.js` is already large. New commission writes go in `commissionOps.js`. New validation goes in `src/utils/validation.js`.

## Two clocks

- Vercel cron `0 4 * * *` → `api/renewal-reminders.js` → WhatsApp utility template.
- GitHub Action 01:30 UTC → email summary to the owner.

They are not duplicates. Do not merge them.

## Cascades

Editing a client or a policy rewrites the denormalised `clientName` and `clientMobile` on related rows (`cascadeUpdateClient`, `cascadeUpdatePolicyLinks`). A policy delete is soft (`deleted`, `deletedAt`) except the recycle bin, which is admin-only and permanent.

## Android

`server.url` in `capacitor.config.json` is deliberate. Removing it means every web fix needs a new Play Store build. Do not remove it.
