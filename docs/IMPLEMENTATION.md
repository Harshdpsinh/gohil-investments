# IMPLEMENTATION

## Prompt

Implement the requested change in the existing CRM. Leave every unrelated function as it is.

## Order

1. Name the files you will touch. If the list includes `firestore.js`, `PoliciesPage.jsx`, `RenewalsPage.jsx`, or `firestore.rules`, say why.
2. If the behaviour is pure (dates, money, matching, message text), write `src/utils/<name>.test.js` first.
3. Implement against that test. Keep Firebase and React out of the util.
4. Wire it through the existing data function or page. Do not add a parallel helper for a one-off.
5. Run the new test, then `npm test` if the change is wide.
6. Do not deploy a migration. Do not edit live documents from a script.

## Patterns already in the repo

- Server code imports shared helpers from `../src/utils/` so the same function is tested in Vitest and used on Vercel.
- Secrets stay in `process.env` inside `api/`. The client only sends a Firebase ID token.
- Audit rows go through `logAdminAction`. It swallows its own failure.
- Soft-delete policies. Hard-delete only from the recycle bin.
- Owner emails, if changed, change in every list: `roles.js`, `useAuth.jsx`, `firestore.rules`, `storage.rules`, `api/_shared.js`.

## Branch

```bash
git checkout -b feat/short-description
```

`main` deploys to Vercel. Merge only when the user wants it live.

## Stop if

The change needs a new collection, a new role, or a rewrite of old commission rows. Ask first.
