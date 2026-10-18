# PRD

## Prompt

You are specifying a change to Gohil Investments CRM, the private tool the Bhavnagar office uses to run an insurance book. Write the change as a small addition to this product. Do not redesign it.

## Who it is for

- **Admin** (the owners) — full book, staff accounts, deletes, backup, commission.
- **Staff** — clients, policies, claims, renewals, inbox. No deletes.
- **Reader** — can look, cannot write. Firestore rules enforce this, not the screen.

There is no public signup. A Firebase account is useless until an admin provisions `users/{uid}`.

## What it must keep doing

- Hold the client book and the policy book, including the PDF schedule.
- Show renewals from the policy start and end dates already stored. Do not invent a new due-date rule.
- Separate **Business Done** (what was sold, April–March, from `startDate`) from **Commission** (what the insurer actually paid, often 30–90 days later).
- Send the approved utility WhatsApp reminder on the office schedule, and show replies in `/inbox`.
- Let an admin download a JSON backup and restore it without wiping the inbox.

## What a change must not do

- Recalculate historical commission.
- Merge two clients because the names look alike.
- Send a second marketing-style WhatsApp. The live notice is a utility template with the policy, the due date, the premium, and the two office numbers.
- Add a customer-facing portal.

## Done when

A staff member can finish the same job they finished yesterday, plus the one new behaviour, and `npm test` still passes without touching live Firestore.
