# TESTING

## Prompt

Pin the behaviour with a unit test before changing it. Never point a test at live Firestore.

## How this repo tests

- `npm test` runs Vitest once. Config is `vitest.config.js`, separate from `vite.config.js`.
- Pure tests are `*.test.js` next to the source, in Node. No `globals`.
- Component tests are `*.test.jsx` with `// @vitest-environment jsdom` on line 1 and `afterEach(cleanup)` from Testing Library.
- Mock Firebase at the module. Copy the style in `src/firebase/firestore.test.js`.
- `npm run lint` allows at most 19 warnings. Lower that number when you remove warnings. Never raise it.
- `npm run test:e2e` is Playwright. Do not add an end-to-end test that logs into the live book.

## What is worth a test

Dates, commission match, posting keys, insurer keys, PDF field splits, WhatsApp payload text, webhook parsing, upload allow-lists, the webhook secret check.

## What is not

- A test that writes a client.
- A snapshot of a 800-line page.
- A test that needs `BHASH_API_KEY` or the Cloudinary secret. Cover that logic with a pure function and a fake status code, the way `cloudinaryAccess.test.js` does.

## Last full run

860 tests, 58 files, all passing, before the upload-fallback fix in this change. Re-run `npm test` after any util edit.
