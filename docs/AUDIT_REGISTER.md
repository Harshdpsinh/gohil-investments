# Codebase Audit Register (audit-only)

**Repo:** [Harshdpsinh/gohil-investments](https://github.com/Harshdpsinh/gohil-investments)  
**Baseline:** `main` @ `ae06f16` (squash-merge of [#37](https://github.com/Harshdpsinh/gohil-investments/pull/37), 2026-09-05 IST)  
**Live:** https://gohil-investments.vercel.app (main auto-deploys)  
**Method:** Local clone — `git fetch` / `checkout main` / `pull`; file reads via shell `rg` + Read; post-merge verification of #37 symbols against current tree. Prior draft: `/workspace/repro-packs/docs-AUDIT_REGISTER.md` (pre-#37).  
**Scope:** Re-validate Phase0 COM-001…COM-022 and NEW-001…008 after #37; document what #37 fixed; keep still-open items. **No feature code. No E2E.**

> **Note on architecture drift:** Phase 0 described `CommissionReconciliationPage` + staging collections (`commission_reconciliation_*`). Current main uses `StatementImportModal` + direct `commission_transactions` posts via `addCommissionTransaction`. Statuses below map the *original risk* onto the *current* implementation.

> **Note on checklist drift:** `COMMISSION_IMPLEMENTATION_CHECKLIST.md` still marks multi-sheet parse, OCR statement import, numeric match scores, client-profile actuals, etc. as done. Several claims remain **false on current `main`** (see **Stale checklist claims**). Prefer this register over the checklist for open risk.

---

## Status legend

| Status | Meaning |
|---|---|
| **Still present** | Risk still observable on `main` |
| **Fixed on main** | Mitigated on current `main` (including via #37) |
| **Partial** | Some mitigation on `main`, residual risk remains |
| **Could not verify** | Insufficient evidence from local reads alone |
| **N/A (superseded)** | Original surface gone; risk replaced by a NEW item or fixed differently |

---

## Executive summary (post-#37)

| Severity band | Count |
|---|---:|
| Critical / High **open** on main | **2** (NEW-004 Partial + COM-005) |
| Phase0 COM-001…022 open on main (Still present + Partial) | **15** |
| Phase0 Fixed on main / N/A | **7** |
| NEW findings open (Still present + Partial) | **5** (NEW-004…008; NEW-001…003 closed) |

### What #37 fixed (ported from #9, squash-merged `ae06f16`)

| Item | Fix on main |
|---|---|
| **NEW-001 / COM-021 bulk gate** | `StatementImportModal` `postable`: `matched` always; `review` only if `includedReview` — Include-only bulk save |
| **NEW-002** | `commissionRateField` → writes `ryCommission` on renewals, `fyCommission` on fresh |
| **NEW-003** | `txnGross` + `tdsSummary` / `netByPolicy` use gross; TDS haircut no longer looks like shortfall |
| **postedAmounts** | Gross vs net when TDS/Net Payment columns exist |
| **Star last-4 + review OK** | Preserved from main (`isMaskedPolicyNumber` / `last4` / #36 OK path) |
| **`useCommissionLedger`** | **Added** as `src/hooks/useCommissionLedger.js` — **NOT wired** into `CommissionPage` (see NEW-004) |

### Top Critical / High still open on main

1. **NEW-004 / COM-010 Partial (High)** — `CommissionPage` still calls `getCommissionTransactionsPage({ pageSize: 100 })` directly; unpaid / awaited flags wrong until operator loads more / entire ledger. Hook `useCommissionLedger` / `fetchEntireCommissionLedger` exists but has **zero imports** outside its own file.
2. **COM-005 Still present (High)** — `parseImportFile` still uses only `wb.SheetNames[0]` despite checklist claiming multi-sheet support.

---

## Verification runs (this audit)

| Command | Runtime | Result |
|---|---|---|
| vitest run | Node v22.19.0 | PASS — 34 files / 722 tests |
| vitest run | Node v20.19.2 | FAIL env — 681 passed, 6 worker errors |
| vite build | Node v22.19.0 | PASS |

---

## Phase 0 re-validation (COM-001 … COM-022)

### COM-001 — Exact policy number accepted without identity checks
- **Status:** **Partial** (matching strong; bulk gate now safe)
- **Evidence:** `src/utils/commissionImport.js` `matchRow` / `withIdentity` require name + insurer agreement for exact numbers; conflicts → `review`. Masked Star last-4 needs name + premium/date.
- **Residual:** Operator can still Include a review row into bulk save (intentional). Per-row OK (#36) can post a single review row after human confirm.

### COM-002 — No idempotency before posting
- **Status:** **Fixed on main**
- **Evidence:** `postingKey` / `legacyPostingKey` in `commissionImport.js`; `addCommissionTransaction` in `src/firebase/firestore.js` uses `runTransaction`, rejects duplicates with `commission/duplicate-post` after checking current + legacy doc ids.

### COM-003 — `payoutMonth` from upload form, not row/batch
- **Status:** **Still present**
- **Evidence:** `StatementImportModal.jsx` builds `payoutMonth` from selected month/year UI and stamps every payload; row `payoutMonth` from the sheet is ignored for the written ledger field (row date may still land in `payoutDate`).

### COM-004 — Sequential staging writes / non-resumable
- **Status:** **Partial** / **N/A (superseded)**
- **Evidence:** Staging collections are gone on main. Import still posts **sequentially** in a `for` loop (`StatementImportModal.save` / `okRow`). No chunked batch progress for large statements. `rewriteIciciInsurerNames` does chunk 400.

### COM-005 — Only first Excel sheet; weak CSV/header handling
- **Status:** **Still present**
- **Evidence:** `exportUtils.parseImportFile`:
  ```js
  const ws = clampSheetRange(wb.Sheets[wb.SheetNames[0]])
  ```
  Alias/header mapping exists in `commissionImport.mapColumns`, but multi-sheet + best-header-row detection are **not** on main. Checklist claims otherwise — **doc drift**.

### COM-006 — PDF/image → zero rows
- **Status:** **Partial**
- **Evidence:** Text-PDF path via `pdfStatement.parsePdfStatement` (pdf.js text layer). `pdfOcr.js` exists for **policy schedules**, not wired into `StatementImportModal` (modal only calls `parsePdfStatement`). Scanned commission PDFs still yield empty / “no policy-level rows”.

### COM-007 — No numeric score / explanation retained
- **Status:** **Partial**
- **Evidence:** Status enums `matched` / `review` / `unmatched` + `reason` string. No 0–100 `matchScore`, `matchConflicts`, or `candidatePolicyIds` persisted on ledger rows. `matchCandidates` is UI-only.

### COM-008 — Weak review UI
- **Status:** **Partial** (largely improved)
- **Evidence:** `StatementImportModal` + `ImportRowReview` + `CommissionReviewDrawer` provide inline edits, skip, per-row OK, filters via Commission page. Not the original reconciliation table/cards design; mobile card workflow for import is limited.

### COM-009 — Posted records lack audit / source fields
- **Status:** **Partial** (improved by #37)
- **Evidence:** Ledger gets `postingKey`, `createdBy`, `createdByEmail`, `remarks` (filename + row). and via `postedAmounts` gross/`netReceived`/`tds`. Still missing: `sourceFileHash`, `sourceFileUrl`, `matchingMethod`, `reconciliationRowId`.

### COM-010 — Unbounded `getAllCommission*`
- **Status:** **Partial**
- **Evidence:** `getCommissionTransactionsPage` (limit ≤250) exists; `getAllCommissionTransactions()` still unbounded via `listFoundationDocs`. Commission page defaults to pageSize 100 (NEW-004). `useCommissionLedger` auto-pages but is unwired.

### COM-011 — Rules: any auth can write commission
- **Status:** **Partial**
- **Evidence:** `firestore.rules` — `commission_master` admin-only; `commission_transactions` **create/update: if isStaff()** (not admin-only). Reads: `canReadBusiness()` (staff + reader). Catch-all deny for undefined collections. Better than “any signed-in user”, not full Phase0 admin-write intent.

### COM-012 — Upload continues after storage failure
- **Status:** **N/A (superseded)** / **Could not verify**
- **Evidence:** Current `StatementImportModal` does **not** upload the statement to Firebase Storage / Cloudinary; it parses in-browser and posts ledger rows. Source-file availability risk replaced by NEW-005 (no durable source artifact).

### COM-013 — Totals are estimates, not posted ledger
- **Status:** **Fixed on main**
- **Evidence:** `commissionReconcile.reconcilePolicies` joins book ↔ ledger; page shows actual vs estimated. #37 `txnGross` makes join TDS-correct.

### COM-014 — Numeric forms / negative overflow
- **Status:** **Partial**
- **Evidence:** `manualCommissionPayload` requires `Number.isFinite(amount)`; `toNumber` strips currency. No explicit max/range guard on import amounts; negatives allowed (reversals — intentional). HTML `inputMode="decimal"` only.

### COM-015 — Client profile has no posted commission history
- **Status:** **Still present**
- **Evidence:** `ClientProfilePage.jsx` tabs: overview / policies / family / claims / docs — **no commission section**; no ledger query by `clientId`.

### COM-016 — Renewal date UTC vs local parsing
- **Status:** **Still present** (intentionally deferred)
- **Evidence:** Phase0 flagged only; commission module did not change renewal date paths. `api/renewal-reminders.js` now imports shared `getDueDate` / `parseAnyDate` (good), but IST boundary regression tests were not verified here.

### COM-017 — Policies missing due dates invisible to renewals
- **Status:** **Still present** (intentionally deferred)
- **Evidence:** Still depends on `getDueDate` fields; no commission-module change.

### COM-018 — Full-table policy/client subscriptions
- **Status:** **Still present**
- **Evidence:** `usePolicies` / `useClients` still drive Commission matching with full in-memory arrays; `renewal-reminders` still `policies.get()` full collection (comment documents why). Checklist: deliberately unchanged.

### COM-019 — Cloudinary unsigned uploads / delete
- **Status:** **Partial**
- **Evidence:** `api/cloudinary-delete.js` — Firebase ID token + `assertStaff` + signed Cloudinary destroy. Unsigned browser uploads still exist for client docs; commission statements are not stored (COM-012).

### COM-020 — Android WebView file inputs
- **Status:** **Could not verify** / **Partial**
- **Evidence:** Modal uses `<input type="file">` + drag/drop. Native share exists (`shareGeneratedFile` / FileProvider for **exports**). No clear Android picker adapter on the import path from remote reads.

### COM-021 — Name-only auto-bind
- **Status:** **Partial** (bulk risk Fixed on main via #37)
- **Evidence:** Name-only → `status: 'review'` (`matchRow`). Bulk save no longer posts review without Include (#37). Residual: Include + per-row OK remain human paths.

### COM-022 — Mojibake rupee display
- **Status:** **Fixed on main** (low residual)
- **Evidence:** Parsing via `toNumber` (strip non-numeric); display via `fmtCurrency` / `en-IN`. Residual only if source encoding corrupts digits themselves.

---

## #37 / #9 delta (historical)

| Change | On main after #37? |
|---|---|
| `postedAmounts()` gross vs net | **Yes** |
| `commissionRateField` → `ryCommission` on renewals | **Yes** |
| `txnGross` + TDS summary without double-count | **Yes** |
| Include-only / matched+Include bulk save | **Yes** |
| Star Health last-4 matching | **Yes** (preserved) |
| Review-row OK posting (#36) | **Yes** (preserved) |
| `useCommissionLedger` hook file | **Yes** (file present) |
| `useCommissionLedger` wired into `CommissionPage` | **No** — page still uses `getCommissionTransactionsPage` directly |

PR #9 is superseded by #37; do not merge #9 onto main (would risk regressing Star mask / review UX).

---

---

## NEW findings

### NEW-001 — Bulk save posts uncertain (`review`) matches
- **Severity:** Critical (when open)
- **Status:** **Fixed on main** (#37)
- **Evidence:** `postable` requires `status === 'matched'` or (`review` && `includedReview`).

### NEW-002 — Statement % always written to `fyCommission`
- **Severity:** High (when open)
- **Status:** **Fixed on main** (#37)
- **Evidence:** `commissionRateField(policy, businessType)` used in save + OK paths.

### NEW-003 — Reconcile treats TDS haircut as commission shortfall
- **Severity:** High (when open)
- **Status:** **Fixed on main** (#37)
- **Evidence:** `txnGross`; `netByPolicy` / `tdsSummary` sum gross.

### NEW-004 — Default ledger page truncates reconcile truth
- **Severity:** High
- **Status:** **Partial** — hook landed, **UI still truncated**
- **Path:** `CommissionPage.jsx` `getCommissionTransactionsPage({ pageSize: 100 })`; incomplete banner + load-more remain.
- **Also:** `src/hooks/useCommissionLedger.js` exports hook/helpers but **no other file imports them**.
- **Impact:** False awaited/unpaid until operator loads remaining pages.

### NEW-005 — No durable statement source artifact / hash
- **Severity:** Medium  
- **Status:** Still present  
- **Path:** `StatementImportModal` — parse only; remarks store filename string only.  
- **Impact:** Cannot prove which file produced a posting; COM-012 storage path abandoned without replacement.

### NEW-006 — Firestore: staff (non-admin) may create/update commission ledger
- **Severity:** Medium  
- **Status:** Still present (by design?)  
- **Path:** `firestore.rules` `match /commission_transactions/{id}` → `allow create, update: if isStaff();`  
- **Impact:** Any provisioned staff token can post/alter money rows; UI may be admin-gated but rules are source of truth.

### NEW-007 — Missing explicit rules for legacy commission staging collections
- **Severity:** Low (deny-by-default is safe)  
- **Status:** Informational  
- **Path:** `firestore.rules` — no `commission_reconciliation_*` / `commission_import_templates` matches; fall through to `match /{document=**} { allow read, write: if false; }`.  
- **Impact:** Old client builds that still write staging docs fail closed. Storage still has `/commission/{batchId}/**` path.

### NEW-008 — Unbounded client-side collection reads (perf / cost)
- **Severity:** Medium  
- **Status:** Still present  
- **Paths:**  
  - `ClientProfilePage` → `getAllClaims()` then filter by client  
  - `api/renewal-reminders.js` → full `policies.get()`; birthday path full `clients.get()`  
  - `getAllCommissionTransactions()` still exported  
- **Impact:** Cost/latency grow with book size; WhatsApp cron already documents the constraint.

### API auth patterns (positive / residual)

| Endpoint | Auth | Notes |
|---|---|---|
| `api/renewal-reminders.js` | `Authorization: Bearer ${CRON_SECRET}`; **fail-closed** if secret missing | Good. Full-collection scan (NEW-008). |
| `api/whatsapp-webhook.js` | HMAC `x-hub-signature-256` + `WHATSAPP_APP_SECRET`; raw body; timingSafeEqual | Good. Fail-closed if secret missing. |
| `api/whatsapp-send.js` | Firebase ID token + `assertStaff` | Good. Freeform gated by 24h inbound window server-side. |
| `api/cloudinary-delete.js` | ID token + staff | Good. |
| `api/provision-user.js` | ID token + **admin** role | Good. |
| `api/_shared.js` | `verifyIdToken` via Identity Toolkit REST (avoids jose ESM break) | Good pattern. |

No hardcoded secrets found in the reviewed API sources (env-driven). Firebase web API key in client is expected/public; rules correctly treat it as non-authorizing.

### Storage rules (summary)

- Staff/reader gated via Firestore profile lookup; size/content-type limits on writes.  
- `/commission/{batchId}/**` allows staff writes (PDF/image/csv/xls) — unused by current StatementImport UI.  
- Default deny for other paths. Generally sound.

---

## Phase0 open count on main (post-#37)

| ID | Status on main |
|---|---|
| COM-001 | Partial |
| COM-002 | Fixed on main |
| COM-003 | Still present |
| COM-004 | Partial |
| COM-005 | Still present |
| COM-006 | Partial |
| COM-007 | Partial |
| COM-008 | Partial |
| COM-009 | Partial |
| COM-010 | Partial |
| COM-011 | Partial |
| COM-012 | N/A (superseded) |
| COM-013 | Fixed on main |
| COM-014 | Partial |
| COM-015 | Still present |
| COM-016 | Still present |
| COM-017 | Still present |
| COM-018 | Still present |
| COM-019 | Partial |
| COM-020 | Could not verify / Partial |
| COM-021 | Partial (bulk fixed) |
| COM-022 | Fixed on main |

**Open on main:** **15** (Still present + Partial; COM-020 counted Partial).  
**Fixed / closed:** COM-002, COM-013, COM-022 (+ COM-012 superseded).  
**NEW closed by #37:** NEW-001, NEW-002, NEW-003.

---

## Stale checklist claims (`COMMISSION_IMPLEMENTATION_CHECKLIST.md`)

Leave the checklist file mostly untouched this PR — these lines are **aspirational / wrong vs `main` @ ae06f16**:

| Checklist claim (marked done) | Reality on main |
|---|---|
| Multi-sheet XLS/XLSX/CSV parsing with header-row detection | **False** — `SheetNames[0]` only (COM-005) |
| Scanned-PDF OCR fallback through Tesseract in statement import | **False** — modal uses `parsePdfStatement` only (COM-006) |
| Numeric 0–100 match confidence + conflicts + candidate IDs | **False** — enum + reason string only (COM-007) |
| Staging writes chunked to 400 with progress | **N/A** — staging gone; sequential ledger posts (COM-004) |
| File-hash / row-hash duplicate detection | **Partial** — postingKey yes; no `sourceFileHash` (NEW-005) |
| Import history/reopen selector with source link | **False** — no durable source artifact (NEW-005) |
| Actual commission totals on Client Profile | **False** — no commission tab (COM-015) |
| Reusable custom insurer column-mapping profiles | **Could not verify / likely overstated** |
| No uncertain match is automatically posted | **True after #37** (was false pre-#37) |

A full checklist rewrite is out of scope for this audit-only PR.

---

## Recommended fix order (docs only — no implementation in this PR)

1. Wire `useCommissionLedger` into `CommissionPage` (close NEW-004 / tighten COM-010).
2. Multi-sheet `parseImportFile` (COM-005).
3. Client profile commission section (COM-015).
4. Tighten `commission_transactions` writes to `isAdmin()` if product intent is admin-only (COM-011 / NEW-006).
5. Persist source file hash/URL when importing (NEW-005).
6. Align or annotate `COMMISSION_IMPLEMENTATION_CHECKLIST.md` to match main.

---

## Audit metadata

| Field | Value |
|---|---|
| Audit-only | Yes — documentation only |
| Feature code changed | None |
| Branch | `docs/audit-register-2026-09-05` |
| Baseline commit | `ae06f164a0c43877dfab7a3417a467dbd8191491` (#37) |
| Prior draft | `/workspace/repro-packs/docs-AUDIT_REGISTER.md` |
| Sources | Phase0 audit, checklist, firestore/storage rules, commissionImport/Reconcile, StatementImportModal, CommissionPage, useCommissionLedger, ClientProfilePage, exportUtils, pdfStatement, api/*, gh pr view 37, vitest/vite |
| Generated | 2026-09-05 Asia/Calcutta |
