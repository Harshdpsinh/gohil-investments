# Overnight QA — 2026-09-01 (IST)

**Scope:** production https://gohil-investments.vercel.app vs repo `Harshdpsinh/gohil-investments` @ `main` (`e1677d79`).
**Agent constraints observed:** no mutations, no config changes, no owner sign-in, no Forgot password, no WhatsApp send, no password lookup/invention.
**Reader session:** **not available** on the QA device (login page only; no pre-signed session). Firestore not read as `reader@gmail.com`.
**Sentry:** **ABSENT** (no `sentry` references in repo code search). No p50/p95 invented.

---

## 1. Findings (ranked by severity)

### Sev-1 — Daily Renewal Alerts workflow fails every scheduled run (nodemailer missing)

**What:** GitHub Action `🔔 Daily Renewal Alerts` fails at import with `ERR_MODULE_NOT_FOUND: Cannot find package 'nodemailer'`.

**Evidence:**
- Latest scheduled failure (tonight): https://github.com/Harshdpsinh/gohil-investments/actions/runs/33477336826 (2026-09-01T06:22–06:23 UTC, conclusion **failure**, run #159).
- Job log (tail): `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'nodemailer' imported from .../.github/scripts/send-renewal-alerts.js` under Node v20.20.2 after `npm ci`.
- Env in the failing step shows `GMAIL_APP_PASSWORD:` empty and split `FIREBASE_*` vars empty (script falls back to `FIREBASE_SERVICE_ACCOUNT`, which is present).
- `package.json` on `main` has **no** `nodemailer` dependency (verified via API).
- Script imports: `import nodemailer from 'nodemailer'` in `.github/scripts/send-renewal-alerts.js`.
- Pattern: continuous failures across scheduled runs (including #159 tonight and prior nights).

**Secondary defect in same script (latent):** HTML CTA still points at placeholder `https://your-app-url.vercel.app/renewals` instead of production `https://gohil-investments.vercel.app/renewals`.

**Impact:** Owner does not receive the 7:00 AM IST renewal summary email. (Separate Vercel cron `api/renewal-reminders.js` for WhatsApp templates is a different channel and was not exercised tonight.)

**Repro:** Actions → Daily Renewal Alerts → open run 33477336826 log; or `npm ci` + `node .github/scripts/send-renewal-alerts.js` without nodemailer installed.

---

### Sev-2 (resolved) — Prior Sev-0 “Deploy Firebase Rules 8/8 failed” remains closed

**Claimed as of original mission brief (2026-08-31):** run https://github.com/Harshdpsinh/gohil-investments/actions/runs/33357754150 (run #8) failed with 403 on serviceusage for firebasestorage; repo rules not production until green.

**Re-verified 2026-09-01 night:**
| Run | URL | Conclusion | Notes |
| --- | --- | --- | --- |
| #8 | https://github.com/Harshdpsinh/gohil-investments/actions/runs/33357754150 | **failure** | Historical; matches brief |
| #9 | https://github.com/Harshdpsinh/gohil-investments/actions/runs/33412170860 | **failure** | Still pre-fix |
| #10 | https://github.com/Harshdpsinh/gohil-investments/actions/runs/33412946650 | **success** | Firestore rules deploy only (storage split) |
| #11 | https://github.com/Harshdpsinh/gohil-investments/actions/runs/33414219673 | **success** | Firestore **and** Storage rules steps both **success** |

**Evidence (run #11 job steps):** Deploy Firestore rules → success; Deploy Storage rules → success (https://github.com/Harshdpsinh/gohil-investments/actions/runs/33414219673/job/99560897581).

**Implication:** Repo `firestore.rules` / `storage.rules` on `main` at `e1677d79` reached production via the green job. Standing Sev-0 is **closed**. No new rules push since #11 (no regression observed in Actions).

---

### Sev-3 — Overnight reader path blocked: no signed-in session

**What:** Mission allows exercising flows as `reader@gmail.com` only if a session is already available or the operator signed that account in. Neither was true; login form only.

**Evidence:**
- Production root renders Sign In (“Welcome back”) — desktop screenshot captured 2026-09-01.
- Agent did **not** invent/store a password, did **not** click Forgot password, did **not** sign in as owner emails.

**Impact:** Could not verify reader read access, write denials, or `agent_action_log` UI against live data tonight.

---

### Sev-4 (observational) — Node / engine drift on Daily Renewal Alerts runner

**What:** Workflow pins Node 20 (`actions/setup-node@v4` + `node-version: '20'`). Logs show many `EBADENGINE` warnings (`firebase-admin@14` requires `>=22`, jsdom/undici similarly). Not the primary failure (nodemailer is), but will become blocking if engines are enforced.

**Evidence:** Run 33477336826 job log — multiple `npm warn EBADENGINE` lines before the nodemailer crash; post-job note that Node 20 is deprecated on Actions runners.

---

## 2. Claimed vs observed

| Claim | Observed 2026-09-01 night |
| --- | --- |
| Deploy Firebase Rules failed 8/8; latest run 33357754150 403 serviceusage/firebasestorage; rules not production until green | **Still closed.** Run #8 failed as claimed; **run #10 and #11 succeeded**. Latest #11 green; Firestore + Storage deploy steps succeeded. No newer rules run. |
| Sentry available for traces / p50/p95 | **ABSENT** — no Sentry integration in repo. |
| Exercise CRM as reader@gmail.com | **Blocked** — no session on device; no password use allowed. |
| Read Firestore as reader | **Not done** (depends on session). |
| Production site up | **Yes** — login page loads. |
| Daily renewal email alerts healthy | **No** — continuous Action failures; nodemailer missing from `package.json`; latest failure run 33477336826. |
| Gmail secrets complete for alerts | **Partial** — `GMAIL_USER` and `ALERT_EMAIL_TO` present; `GMAIL_APP_PASSWORD` empty in failing-step env dump. |

---

## 3. Cleanup (proposed only — Execute? unchecked)

> **Execute?** ☐ unchecked — proposals only. Do not run from this agent session.

1. **Add `nodemailer` to `package.json` dependencies** (and lockfile via `npm install nodemailer`) so `npm ci` in Daily Renewal Alerts can resolve the import.
2. **Bump the workflow Node version** to 22 (align with `firebase-admin@14` and deploy-rules workflow) in `.github/workflows/renewal-alerts.yml`.
3. **Set / restore `GMAIL_APP_PASSWORD`** repository secret if it is intentionally empty (env dump showed blank).
4. **Fix CTA URL** in `.github/scripts/send-renewal-alerts.js` from `https://your-app-url.vercel.app/renewals` to `https://gohil-investments.vercel.app/renewals`.
5. **Manually run** Daily Renewal Alerts once after the above and confirm either a clean “no renewals due” exit or a delivered email.
6. **Operator sign-in** as `reader@gmail.com` on the QA device (or provide an already-authenticated browser session) so the next overnight can verify:
   - business collection reads
   - write controls denied by rules (not only UI)
   - `agent_action_log` append on denied attempts
7. **Optional:** confirm in Firebase Console that production rules revision still matches post–run #11 deploy (no agent IAM/console write).
8. **Do not** from agent: deploy rules, grant IAM, merge to main, send WhatsApp, mutate Firestore, click Forgot password, or print passwords.

---

## Constraints checklist (self)

- [x] No data mutation / config change / cleanup execution
- [x] No owner email sign-in
- [x] No password invent/lookup/store/print
- [x] No Forgot password
- [x] No WhatsApp send
- [x] No merge to main
- [x] Sentry: ABSENT stated, no invented latency metrics
- [x] Branch `feat/overnight-actions` only; do not merge
