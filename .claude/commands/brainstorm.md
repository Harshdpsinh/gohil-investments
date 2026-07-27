---
description: Plan the architecture and edge cases for a change before any code is written
---

Do not write or edit any production code during this command. Planning only.

For the task described below, produce:

1. **Restated goal** — one or two sentences on what actually needs to change, in
   terms of user-visible behaviour.

2. **Files in the blast radius** — every file that will need to change, and every
   file that reads the data being changed. Check `src/firebase/firestore.js` for
   cascade functions and denormalised fields that will need syncing.

3. **Architectural approach** — where the logic belongs (data layer vs. page vs.
   component), and why. Note if the change would grow `PoliciesPage.jsx` or
   `firestore.js` further, and whether extraction is the better move.

4. **Edge cases** — at minimum consider:
   - Missing or malformed data already in Firestore from earlier app versions
   - Soft-deleted records (`deleted` / `deletedAt`)
   - `admin` vs `staff` role differences, and what Firestore rules will actually permit
   - Offline / slow network, and the Capacitor Android webview
   - Date handling — policy dates are stored as `YYYY-MM-DD` strings, not timestamps
   - Duplicate detection and the cascade update paths

5. **Test plan** — the specific unit tests to write first, and what each asserts.

6. **Open questions** — anything you need answered before starting.

Stop after presenting this. Wait for approval before writing tests or code.

Task: $ARGUMENTS
