# API

## Prompt

Add a Vercel function only when the browser must not see a secret. Everything else stays a Firestore call from `src/firebase/`.

All routes live in `api/`. `api/_shared.js` is a library, not a URL. Every staff route checks a Firebase ID token and `assertStaff`. Fail closed when the required env var is missing.

## Routes

| Method | Path | Who | What |
| --- | --- | --- | --- |
| GET, POST | `/api/renewal-reminders` | `CRON_SECRET` | Daily utility reminders. 503 if the secret is unset. |
| POST | `/api/whatsapp-send` | staff | Template or free text. Free text only inside the 24-hour inbound window. 30 sends / 10 min / user. |
| GET, POST | `/api/whatsapp-webhook` | Meta signature | Inbound Cloud API messages. Signature is over the raw body. |
| GET, POST | `/api/bhash-webhook` | `BHASH_WEBHOOK_SECRET` query or `x-bhash-webhook-secret` | Inbound BHASH messages. 401 if the secret is missing or wrong. |
| GET | `/api/bhash-account` | staff | Wallet balance. |
| POST | `/api/provision-user` | admin | Fallback when the browser cannot write `users/{uid}`. |
| POST | `/api/cloudinary-sign` | staff | One signed authenticated upload. Type and folder are checked here. 40 / 10 min / user. |
| POST | `/api/cloudinary-confirm` | staff | Checks the format. Returns the signed delivery URL. Deletes the asset if the format is not allowed. |
| POST | `/api/cloudinary-delete` | staff | Destroys by `publicId`. Pass `type: authenticated` for new files, `upload` for old ones. |

## Upload contract

`cloudinary-sign` accepts only `gohil_investments/...` and only PDF, JPG, PNG, WEBP, CSV, XLS, XLSX, up to 25 MB. The browser posts the file to Cloudinary with the returned signature. It does not send `upload_preset`.

A 4xx from sign or confirm must be shown to the user. It must not be retried against Firebase Storage. A 5xx or a network failure may fall back. That rule is `cloudinaryFailureShouldFallback`.

## Response habit

JSON. `401` missing or bad token, `403` role, `400` bad input, `429` rate limit, `405` wrong method. Webhooks that an outside system will retry should still return 200 after a handled parse error, which is what the two webhook routes do.
