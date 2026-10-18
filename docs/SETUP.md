# SETUP

## Prompt

Get the existing app running. Do not create a new Firebase project and do not point `.env` at a different one. A second project looks like an empty CRM and hides the real book.

## Local

Node 20+.

```bash
npm install
npm run dev
npm test
npm run lint
```

`.env` needs the `VITE_FIREBASE_*` values from the live project, plus `VITE_CLOUDINARY_CLOUD_NAME`. Never commit `.env`.

The upload preset variable is obsolete. Leaving it in an old `.env` does nothing.

## Production

`main` deploys to `https://gohil-investments.vercel.app`. After any environment-variable change, Redeploy. The old function keeps the old values until then.

Server variables that fail closed when missing:

| Variable | If missing |
| --- | --- |
| `CRON_SECRET` | Renewal cron returns 503 |
| `BHASH_WEBHOOK_SECRET` | BHASH inbound returns 401 |
| `BHASH_API_KEY` + `BHASH_BUSINESS_CODE` + `BHASH_TEMPLATE_CODE` | Templates do not go out through BHASH |
| `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` | Inbox replies and the Meta path stop |
| `WHATSAPP_APP_SECRET` | Meta webhook rejects the body |
| `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET` | New uploads cannot be signed |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Every admin route 500s |

The full list is in the root [README.md](../README.md).

## Android

The debug APK build is `npm run android:apk` on Windows. The installed app still loads the live site, so a web deploy is what staff see.

## Webhook URLs

- Meta: `https://gohil-investments.vercel.app/api/whatsapp-webhook`
- BHASH: `https://gohil-investments.vercel.app/api/bhash-webhook?secret=<BHASH_WEBHOOK_SECRET>`

Do not paste the secret into a source file or into the inbox UI.
