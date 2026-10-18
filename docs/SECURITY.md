# SECURITY

## Prompt

Keep the locks that are already in place. A UI check is not a lock.

## Identity

- Firebase Auth proves the person. `users/{uid}.role` proves they may enter.
- Roles: `admin`, `staff`, `reader`. Owner emails are admin even before the profile exists. The lists must match across rules, `roles.js`, and `api/_shared.js`.
- `reader` can read business collections and cannot write them. That is `firestore.rules`, not a banner.
- There is no per-client partition. A staff member can see the whole book. Do not pretend otherwise.

## WhatsApp

- Meta webhook: `WHATSAPP_APP_SECRET` over the raw body, timing-safe compare.
- BHASH webhook: BHASH does not sign the body. `BHASH_WEBHOOK_SECRET` on the URL is the lock. Missing secret is a 401, not an open door.
- `whatsapp_messages` is server-written. The browser cannot forge an inbound row.
- Send path verifies the ID token and the staff role. 30 messages per 10 minutes per user, per warm server instance.

## Files

- New uploads are `type=authenticated`, signed by `api/cloudinary-sign.js`, folder `gohil_investments/` only.
- Allowed types are checked on the server before the signature is issued, and again on confirm.
- A rejected upload must not fall through to Firebase. See `cloudinaryFailureShouldFallback`.
- Old public Cloudinary URLs stay as they are. Do not rewrite them.
- `vercel.json` sends `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and HSTS.

## Audit

`logAdminAction` writes `audit_logs` for staff create, role change, backup restore, policy delete, client delete, and commission post or edit. Only an admin can create those rows. The log is best-effort.

## Do not add

- A public signup form.
- The Cloudinary upload preset back into the client bundle.
- A webhook that trusts the JSON because the URL is "unlisted".
