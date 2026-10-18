# FEATURE

## Prompt

Add one feature to the CRM. Use this shape and stop when it is done. Do not tidy neighbouring code.

## Fill this in before writing

- **Who uses it:** admin, staff, or reader.
- **Screen:** which existing route, or a new route next to its neighbours in `src/App.jsx`.
- **Data:** which collection, which new fields, and why old documents still make sense with the field missing.
- **Rules:** which of `isStaff`, `isAdmin`, `canReadBusiness` applies. Update `firestore.rules` in the same change.
- **Pure logic:** the function in `src/utils/` and the test that pins it.
- **Out of scope:** the list of things this feature will not recalculate.

## Built-in refusals

- A feature that "fixes" historical commission by rewriting `commission_transactions` is out of scope unless the user names the rows.
- A feature that sends WhatsApp must use the existing sender. Utility template outside the 24-hour window. Free text only inside it.
- A feature that uploads a file must use `uploadWithFreeFallback`. Do not call Cloudinary from the page.
- A feature that deletes a policy must soft-delete, then offer the recycle bin.

## Finish

The user can do the new thing on the existing screen, old records still open, and the new test passes.
