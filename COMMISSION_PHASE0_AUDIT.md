# Commission Module Phase 0 Audit

Audit date: 19 June 2026

## Existing data model

The CRM already has these collections. This implementation extends them without renaming or deleting existing fields.

| Collection | Existing purpose | Existing key fields |
|---|---|---|
| `commission_master` | Commission-rate rules | insurer, product, insuranceType, policyYear, businessType, premiumMin/Max, commissionPct, rewardPct, active |
| `commission_transactions` | Posted commission ledger | policyId/number, clientId/name, insurer, premium, expected/received/reward, TDS, GST, netReceived, difference, payoutDate/month, status, reconciliationBatchId, remarks |
| `commission_import_templates` | Reusable insurer mappings | name, insurer, fileType, fieldMap, active |
| `commission_reconciliation_batches` | Uploaded statement/import history | insurer, statementMonth, originalFile URL/name, extractedText, status, summary, confirmedAt, rolledBackAt |
| `commission_reconciliation_rows` | Staging and review rows | batchId, uploaded identity/amount fields, matchedPolicyId/number, matchConfidence, status, note |

Existing transaction records remain compatible. New fields are additive and optional.

## Bug and risk register

| ID | Location | Severity | Root cause | Proposed scoped fix |
|---|---|---:|---|---|
| COM-001 | `CommissionReconciliationPage.confidenceFor` | Critical | Exact policy number is accepted without checking insurer, client, plan, or premium. A reused/mistyped policy number can post to the wrong policy. | Score every identity attribute, require consistency for exact status, and route conflicts to manual review. |
| COM-002 | `CommissionReconciliationPage.acceptRow` | Critical | No transaction/row idempotency key is checked before posting. Retries or two clicks can create duplicate transactions. | Persist deterministic `rowHash`/`postingKey`; query existing transaction and refuse duplicate unless force-confirmed. |
| COM-003 | `CommissionReconciliationPage.acceptRow` | High | `payoutMonth` uses the currently selected upload form month, not the reopened batch's month. | Persist month on every row and resolve posting month from row/batch. |
| COM-004 | reconciliation import loop | High | Rows are written sequentially one document at a time; large statements are slow and can stop halfway without a useful resumable summary. | Chunk staging writes at 400 operations and update progress. |
| COM-005 | `parseImportFile` | High | Only the first Excel sheet is read. CSV dialect/header-row variation is not normalized. | Parse all workbook sheets, detect the best header row, normalize aliases, and retain source sheet/row. |
| COM-006 | reconciliation PDF branch | High | PDF/image statements always create zero rows and manual-review status. | Add local text-PDF extraction and optional local OCR fallback; never auto-post extracted rows. |
| COM-007 | reconciliation matching | High | Confidence is only `high/medium/unmatched`; no numeric score or explanation is retained. Plan name, contact identifiers, dates, and PAN are not considered. | Store 0-100 score, reason, conflicts, and candidate IDs. Fuzzy matches remain suggestions only. |
| COM-008 | reconciliation UI | High | There is no inline correction, bulk exact confirmation, status/confidence filtering, ignore/unmatched action, calculation breakdown, or mobile card view. | Add review controls and cards while retaining the existing manual policy include/match flows. |
| COM-009 | `commission_transactions` | High | Posted records lack source file/hash, row hash, matching method, gross/deduction/reward breakdown, and audit identity. | Add optional immutable audit fields and source references. |
| COM-010 | `getAllCommission*` helpers | Medium | Collection reads are unbounded and sorted client-side. | Keep compatibility now; add capped history helpers and pagination for large datasets. |
| COM-011 | Firestore rules | Medium | Authenticated users can create/update reconciliation rows and transactions; UI is admin-only, but rules do not enforce admin writes. | Restrict commission writes to admins while allowing authenticated reads where required. |
| COM-012 | statement storage | Medium | Upload can continue after storage failure, leaving a batch without a source document reference. | Preserve review rows but label source as unavailable and block claims that require source verification. |
| COM-013 | `CommissionPage` / Dashboard | High | Existing totals are estimates from policy FY/RY percentages, not posted commission transactions. | Add actual received summaries while retaining estimated figures under explicit labels. |
| COM-014 | numeric forms | Medium | Commission master and reconciliation include forms rely mostly on HTML number inputs; negative/overflow values can reach helper coercion. | Validate finite values and explicit ranges before writes. |
| COM-015 | client commission visibility | Medium | Client profile has no posted policy/month/source commission history. | Add a read-only commission section keyed by clientId with legacy name fallback. |
| COM-016 | renewal date validation | Medium | Renewal form compares ISO strings through `new Date()` while other paths use local start-of-day parsing. UTC parsing can differ near timezone boundaries. | Flagged only; do not alter proven renewal logic in this commission change. Add regression tests around IST boundaries. |
| COM-017 | renewal legacy fallback | Medium | Policies missing both `nextPremiumDue` and a valid start/expiry date remain invisible to renewal calculations. | Existing migration/backfill should report unresolved records. No silent commission-module change. |
| COM-018 | policy/client full-table subscriptions | Medium | Large collections remain client-side and several reports derive from full arrays. | Defer server pagination because changing shared subscriptions can affect renewal/import behavior. |
| COM-019 | Cloudinary unsigned uploads | Medium | Client-side unsigned uploads cannot securely delete old assets unless a valid delete token/server endpoint remains available. | Existing deletion strategy retained; commission source files record provider metadata and surface deletion failures. |
| COM-020 | Android document flows | Medium | Browser file inputs and blob URLs are unreliable in WebView; native adapters exist but commission upload does not use them. | Reuse the Android picker/document adapters and render mobile review cards. |
| COM-021 | duplicate/client merge dependency | Medium | Name-only fallback can bind unrelated people with the same name; mobile formatting variants reduce exact matches. | Commission matching never auto-confirms name-only matches and uses normalized contact identifiers only as supporting evidence. |
| COM-022 | currency display | Low | Some imported text displays mojibake for the rupee symbol when source encoding is wrong. | Centralize numeric parsing and continue rendering through `fmtCurrency(en-IN)`. |

## Scope decisions

- Existing renewal, CliMer, policy import, date-storage, WhatsApp normalization, and policy PDF history logic are not rewritten.
- New commission fields are optional, so old Firestore documents remain readable.
- Uncertain matches are staged only. They are never posted without confirmation.
- OCR is local/free and optional because large scanned PDFs can be slow on low-memory Android devices.

## Target schema additions

### Reconciliation batch

`fileHash`, `fileType`, `uploadedBy`, `uploadedByEmail`, `mappingProfileId`, `totalRows`, `resolvedRows`, `duplicateRows`, `unmatchedRows`, `errorRows`, `lastOpenedAt`, `completedAt`.

### Reconciliation row

`sourceSheet`, `sourceRowNumber`, `sourceData`, `uploadedPlanName`, `uploadedCategory`, `uploadedMobile`, `uploadedEmail`, `uploadedPan`, `commissionRate`, `rewardCommission`, `deduction`, `commissionDate`, `policyDate`, `rowHash`, `matchScore`, `matchReason`, `matchConflicts`, `candidatePolicyIds`, `confirmedBy`, `confirmedAt`, `postingKey`, `transactionId`.

### Commission transaction

`grossCommission`, `commissionRate`, `deduction`, `matchingMethod`, `sourceType`, `sourceFileName`, `sourceFileUrl`, `sourceFileHash`, `sourceRowHash`, `reconciliationRowId`, `createdBy`, `createdByEmail`, `postedAt`.

## UI surfaces

| Surface | Purpose/layout |
|---|---|
| Reconciliation upload | Insurer, month, mapping profile, native file picker, progress and duplicate-file warning. |
| Reconciliation preview | Desktop review table plus mobile stacked cards, search/status/confidence filters, inline amounts, score/reason chips and calculation disclosure. |
| Match drawer/modal | Ranked policy candidates with identity conflicts visible before confirmation. |
| Import history | Batch progress, counts, source link and reopen action. |
| Manual entry | Validated client/policy commission entry sharing the same ledger schema. |
| Client profile | Total actual commission, policy-wise and month-wise history, source file link. |
| Dashboard | Actual month comparison, unresolved count, top insurer/category and monthly upload reminder. |
