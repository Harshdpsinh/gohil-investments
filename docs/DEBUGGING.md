# DEBUGGING

## Prompt

Find the break. Fix that break. Do not rewrite the feature while you are in there, and do not edit live client data to "see if it helps".

## Order

1. Reproduce with one example: which screen, which policy number, what you expected, what happened.
2. If it is money, dates, matching, or message text, look in `src/utils/` first. The page is usually only displaying the result.
3. If it is "permission denied", the lock is `firestore.rules` or `assertStaff`, not the button.
4. If WhatsApp did not arrive, separate the hops: CRM log, Vercel function, BHASH or Meta response, phone. A row in `whatsapp_messages` only proves our server accepted the send.
5. If a new PDF will not open, check `policyPdfDelivery`. Authenticated files need the signed URL from `cloudinary-confirm`. Old files are public URLs and should still open.
6. If inbound chat never appears, the BHASH URL must include `?secret=` equal to `BHASH_WEBHOOK_SECRET`, and that variable must be on the deployment. Adding the variable without a Redeploy does nothing.
7. Add a unit test that fails the way the bug failed, then fix it.

## Do not

- Turn a soft-deleted policy back on by editing Firestore from a script unless the user asks.
- Relax a rule to make a test user succeed.
- Swallow a 400 from an upload and store the file somewhere else.

## Checked on 18 Oct 2026

`npm test`: 860 passed, 58 files. No failing test.

One bug fixed while writing these prompts: a file Cloudinary refused (wrong type, signed-out, or rate limit) was then uploaded to Firebase Storage anyway. `cloudinaryFailureShouldFallback` now allows a fallback only for a 5xx or a network failure. Business rules, stored rows, and reminder text were not changed.

Not a code bug, still required in Vercel: `BHASH_WEBHOOK_SECRET`. Until it is set and the BHASH webhook URL carries it, inbound replies stay rejected on purpose.
