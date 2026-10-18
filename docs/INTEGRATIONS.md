# INTEGRATIONS

## Prompt

Use the connection that already exists. Do not add a second provider for the same job.

| Job | Provider | Where |
| --- | --- | --- |
| Login and data | Firebase Auth + Firestore | `src/firebase/`, `firestore.rules` |
| Files | Cloudinary, signed | `src/firebase/storage.js`, `api/cloudinary-*.js` |
| Utility WhatsApp templates | BHASH when `BHASH_API_KEY` is set, otherwise Meta Cloud API | `api/whatsapp-send.js`, `api/renewal-reminders.js` |
| Inbox replies and the 24-hour window | Meta Cloud API | `api/whatsapp-send.js`, `api/whatsapp-webhook.js` |
| BHASH inbound | BHASH webhook | `api/bhash-webhook.js` |
| Daily reminder run | Vercel cron | `vercel.json` → `api/renewal-reminders.js` |
| Daily email to the owner | GitHub Action + Gmail SMTP | `.github/scripts/send-renewal-alerts.js` |
| Host | Vercel | `main` branch |
| Phone | Capacitor Android loading the live site | `capacitor.config.json` |

## Rules

- BHASH sends the approved template. The variable order is client name, insurer plus type, policy number, due date, premium. The office numbers are fixed text in the template, not variables.
- A message the office starts outside the 24-hour window must be that template. Free text is rejected.
- The green WhatsApp buttons on Renewals and Policies are `wa.me` links. They are not the API. Leave them.
- Inbound media from Meta is copied to Cloudinary by the webhook because Meta deletes it. Do not fetch that media URL without the bearer token.
- Cloudinary `auto/upload` is what the signed browser upload uses, because `raw/upload` broke the PDF viewer. Keep that endpoint.

## Adding a new outside service

Needs a named user request, a server-side secret, a staff or signature check, and a line in this table. No new service for something Firebase or the current WhatsApp path already does.
