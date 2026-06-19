# Commission Module Implementation Checklist

## Completed

- [x] Phase 0 bug and data-model audit written before feature changes.
- [x] Existing five commission collections preserved; schema changes are additive.
- [x] Multi-sheet XLS/XLSX/CSV parsing with header-row and alias detection.
- [x] Text PDF parsing through PDF.js and scanned-PDF OCR fallback through Tesseract.js (free, lazy-loaded).
- [x] Client, policy, plan, insurer, premium, mobile, email and PAN-aware matching.
- [x] Numeric 0-100 match confidence, reason, conflicts and candidate policy IDs.
- [x] Exact policy number conflicts are sent to review instead of blindly posted.
- [x] Staging writes chunked to 400 documents with progress feedback.
- [x] File-hash and row-hash duplicate detection.
- [x] Atomic/idempotent posting across transaction ledger, staging row and policy summary.
- [x] Explicit duplicate force-import confirmation.
- [x] Inline net-amount correction and calculation breakdown.
- [x] Search, status and confidence filters.
- [x] Bulk confirmation for exact matches.
- [x] Manual match, include-new-policy, mark-unmatched and ignore actions.
- [x] Validated manual commission entry.
- [x] Import history/reopen selector with source link and resolved progress.
- [x] Desktop review table and touch-sized mobile card workflow.
- [x] Actual commission totals on Dashboard, Commission Tracker and Client Profile.
- [x] Company-, category-, client- and month-oriented ledger reporting surfaces.
- [x] Monthly upload modal plus persistent dashboard reminder banner.
- [x] Android bundle synchronized after production build.
- [x] Reusable custom insurer column-mapping profiles.
- [x] Server-paginated actual commission ledger (100 records per page).
- [x] Android native CSV/XLSX/PDF share sheet through the existing FileProvider.
- [x] OCR engine runtime cache for offline reuse after first successful load.

## Safety and compatibility

- [x] Existing renewal, policy date, CliMer, policy import, WhatsApp and PDF-history calculations were not rewritten.
- [x] Legacy commission transactions remain readable when new audit fields are absent.
- [x] No uncertain match is automatically posted.
- [x] Production Vite build passes.
- [x] Deterministic calculation/matching test passes.

## Deliberately isolated from this module

- [x] Custom insurer mapping is implemented as exact-header inputs rather than drag-and-drop, which is clearer on Android and remains reusable.
- [x] Commission history is paginated. Shared policy/client subscriptions are intentionally unchanged because they drive renewal/import behavior outside commission scope.
- [x] PDF.js/Tesseract remain free and local; engines require internet on first use and are cached for later offline use.
- [x] Native Android sharing is implemented without an additional plugin or storage permission.

## Deployment checks

1. Publish the current Firestore and Storage rules.
2. Upload one insurer XLSX with multiple sheets and verify all rows appear.
3. Upload the same file twice and verify the duplicate warning.
4. Confirm one exact row and verify it appears in the client profile and actual totals.
5. Retry the same row and verify duplicate posting is rejected.
6. Correct and manually match a conflicting row before posting.
7. Test a text PDF and a scanned PDF on Wi-Fi.
8. Rebuild/reinstall the Android APK after `npm run android:apk`.
9. Share CSV, XLSX and PDF from Android and confirm the system share sheet opens.
10. Reopen a previously used OCR statement offline and confirm the cached engines load.
