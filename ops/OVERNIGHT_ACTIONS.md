# Overnight actions — YYYY-MM-DD IST
Status: REVIEW ONLY — nothing below was executed.
Tester: reader@gmail.com
App: https://gohil-investments.vercel.app
Rules SHA: (main commit that last deployed firestore.rules)

Use this file in the morning: tick **Execute?** only for rows you want done, then do those yourself (or ask in chat). The overnight agent must not tick them or run them.

---

## Do first (Sev-0 / Sev-1)

| # | Severity | Where | Symptom | Proposed fix | Risk if ignored | Execute? |
|---|----------|-------|---------|--------------|-----------------|----------|
| 1 | Sev-0 | Firestore / live write | Example: reader Save on a client succeeded | Re-deploy `firestore.rules`; confirm `canReadBusiness()` is read-only for `reader` | Book can be edited by the tester | [ ] |
| 2 | Sev-1 | `/commission` | Example: page crashes or book is empty for reader | Check Vercel deploy + `commission_transactions` read rule | Cannot verify paid/unpaid | [ ] |

Severity: **Sev-0** write succeeded or rules missing `isReader`. **Sev-1** crash / empty book. **Sev-2** UI glitch.

---

## Cleanup / data repair (do not run overnight)

These are the jobs the agent is *not* allowed to click: merge ICICI names, mark old commissions paid, delete duplicates, rewrite stored insurer strings, import statements, send WhatsApp.

| # | Kind | Collection / UI | Proposed change | Why it was not executed | Execute? |
|---|------|-----------------|-----------------|-------------------------|----------|
| 1 | Merge insurer names | `policies`, `commission_transactions` | Rewrite stored `ICIC` / `ICICI` → ICICI Lombard (Life → ICICI Prudential) using the existing Commission banner | Live-data lock — agent is reader-only | [ ] |
| 2 | One-time settle | `commission_transactions` | Mark pre-upload book as paid via “Mark existing policies as paid” | Live-data lock | [ ] |
| 3 | Duplicate / bad row | name the screen + last 4 of policy no | Describe the edit; do not apply it overnight | Live-data lock | [ ] |

---

## Code / rules patches

| # | File | Change | Why |
|---|------|--------|-----|
| 1 | `firestore.rules` | (only if a rule bug was found) | |
| 2 | `src/…` | (only if a UI crash has a clear one-line fix) | |

Do not merge these overnight. Open a PR the next day if you tick them.

---

## Checks that passed

- Login as `reader@gmail.com` works
- Sidebar badge is **Reader**; amber read-only banner visible
- `/dashboard` `/clients` `/policies` `/renewals` `/claims` `/commission` `/business` `/inbox` load
- One write probe returned `permission-denied`

---

## Blocked / could not verify

- (login failed / rules Action not green / Vercel not Ready / missing reader profile)

---

## How to act in 5 minutes

1. Read **Do first**. If any Sev-0 exists, fix that before anything else.
2. Tick **Execute?** only on rows you want.
3. Data rows: do them signed in as **admin** (Commission banners, Manage Staff). Never as reader.
4. Code rows: branch + PR, not a direct push to `main`.
5. Leave unticked rows for later. Blank tables mean a clean night.
