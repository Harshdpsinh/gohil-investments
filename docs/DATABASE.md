# DATABASE

## Prompt

Read and write the collections that already exist. Do not add a field that changes the meaning of an old row, and do not run a migration unless the user asks.

Firestore is the database. There is no SQL database in this repo. `schema_reference.md` is the older field list. This file is the one to follow when they disagree.

## Collections

`clients` `policies` `proposals` `claims` `users` `families` `audit_logs` `documents` `message_logs` `leads` `lead_followups` `endorsements` `commission_master` `commission_transactions` `renewal_reminder_settings` `renewal_reminder_logs` `whatsapp_messages` `sub_brokers` `sales_managers` `reports_saved_filters` `client_activities` `occasion_logs`

Subcollection: `clients/{id}/documents/{docId}`.

## Rules that are easy to break

- `users/{uid}.role` is `admin`, `staff`, or `reader`. Owner emails are also admin inside `firestore.rules`. Keep that list in sync with `src/utils/roles.js` and `api/_shared.js`.
- `whatsapp_messages` is written by the Admin SDK only. The browser may mark `read`.
- `audit_logs` is create-only, and only an admin can create one. A failed log must not roll back the action.
- Policy delete sets `deleted: true`. It does not remove the document.
- `clientName` on a policy is a copy. Change it through the cascade, not with a one-off update.
- Insurer strings are stored as typed. Canonical names are for reports only. Do not rewrite the stored value to "clean it up".
- Commission identity (`postingKey`, `policyId`, `clientId`) stays frozen after insert. See `commissionIdentityFrozen` in `firestore.rules`.
- Blank, `-`, `N/A` are missing. A shared client name is not a match.
- Business Done reads `policies.startDate`. Commission reads `commission_transactions`. Do not point either screen at the other collection.

## Policy fields worth remembering

`policyNumber` `clientId` `insurer` `policyType` `planName` `premium` `frequency` `startDate` `expiryDate` `status` `fyCommission` `ryCommission` `parentPolicyId` `policyYear` `nextPremiumDue` `policyPdfUrl` `policyPdfPublicId` `policyPdfDelivery` `policyPdfHash` `deleted`

`policyPdfDelivery: "authenticated"` means the file needs the signed Cloudinary URL. Older rows have a public `policyPdfUrl` and no delivery flag. Leave those URLs alone.

## Backup

`BACKUP_COLLECTIONS` in `firestore.js` is the allow-list. Restore skips `whatsapp_messages` overwrites and only creates missing `audit_logs`.
