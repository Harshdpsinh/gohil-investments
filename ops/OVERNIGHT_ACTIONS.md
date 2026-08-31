# Overnight QA — 2026-08-31 (IST)

**Scope:** production https://gohil-investments.vercel.app vs repo `Harshdpsinh/gohil-investments` @ `main` (`e1677d79`).
**Agent constraints observed:** no mutations, no config changes, no owner sign-in, no Forgot password, no WhatsApp send, no password lookup/invention.
**Reader session:** **not available** on the QA device (login page only; no pre-signed session). Firestore not read as `reader@gmail.com`.
**Sentry:** **ABSENT** (no `sentry` references in repo code search). No p50/p95 invented.

---

## 1. Findings (ranked by severity)

### Sev-1 — Daily Renewal Alerts workflow fails every scheduled run (nodemailer missing)

**What:** GitHub Action `🔔 Daily Renewal Alerts` fails at import with `ERR_MODULE_NOT_FOUND: Cannot find package 'nodemailer'`.

**Evidence:**
- Latest scheduled failure: https://github.com/Harshdpsinh/gohil-investments/actions/runs/33367167573 (2026-08-31T07:09–07:10 UTC, conclusion **failure**).
- Job log (tail): `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'nodemailer' imported from .../.github/scripts/send-renewal-alerts.js` under Node v20.20.2 after `npm ci`.
- `package.json` on `main` has no `nodemailer` dependency (verified).
- Open fix PR (not merged): https://github.com/Harshdpsinh/gohil-investments/pull/25 — adds `nodemailer` + pins Node 22.
- Pattern: runs 138–158 (and earlier) also **failure** on the same workflow.

**Impact:** Owner does not receive the 7:00 AM IST renewal summary email. (Separate Vercel cron `api/renewal-reminders.js` for WhatsApp templates is a different channel and was not exercised tonight.)

**Repro:** Actions → Daily Renewal Alerts → view any recent schedule run log; or `npm ci` + `node .github/scripts/send-renewal-alerts.js` without nodemailer installed.

---

### Sev-2 (info / resolved) — Prior Sev-0 “Deploy Firebase Rules 8/8 failed” is **no longer true**

**Claimed as of mission brief (earlier 2026-08-31):** run https://github.com/Harshdpsinh/gohil-investments/actions/runs/33357754150 (run #8) failed with 403 on serviceusage for firebasestorage; repo rules not production until green.

**Observed tonight:**
| Run | URL | Conclusion | Notes |
| --- | --- | --- | --- |
| #8 | https://github.com/Harshdpsinh/gohil-investments/actions/runs/33357754150 | **failure** | Historical; matches brief |
| #9 | https://github.com/Harshdpsinh/gohil-investments/actions/runs/33412170860 | **failure** | Still pre-fix |
| #10 | https://github.com/Harshdpsinh/gohil-investments/actions/runs/33412946650 | **success** | Firestore rules deploy only (storage split) |
| #11 | https://github.com/Harshdpsinh/gohil-investments/actions/runs/33414219673 | **success** | Firestore **and** Storage rules steps both **success** |

**Evidence (run #11 job steps):** Deploy Firestore rules success; Deploy Storage rules success (https://github.com/Harshdpsinh/gohil-investments/actions/runs/33414219673/job/99560897581).

**Implication:** Repo `firestore.rules` / `storage.rules` on `main` at `e1677d79` are the ones that reached production via the green job. Prior “rules not production” standing is **closed** pending any manual Firebase console drift (not checked without console access).

---

### Sev-3 — Overnight reader path blocked: no signed-in session

**What:** Mission allows exercising flows as `reader@gmail.com` only if a session is already available or the operator signed that account in. Neither was true; login form only.

**Evidence:**
- Production root returns HTTP **200** and renders Sign In (“Welcome back”) — screenshot of desktop login chrome.
- Agent did **not** invent/store a password, did **not** click Forgot password, did **not** sign in as owner emails.

**Impact:** Could not verify reader read access, write denials, or `agent_action_log` UI against live data tonight.

---

### Sev-4 (observational) — Unauthenticated API surface

| Endpoint | Observed |
| --- | --- |
| `GET /` | 200 |
| `GET /api/whatsapp-webhook` | 403 |
| `GET /api/renewal-reminders` | body `{"error":"Unauthorized"}` (fails closed without cron secret — consistent with README/CLAUDE) |

No mutation performed.

---

### Sev-5 (backlog, non-blocking) — Open feature PRs not on production

Open PRs (not merged): #25 (nodemailer), #16/#15 (Family 360 / occasions), #12 (searchable selects), #11 (portal chrome), #10 (insurer name merge), #9 (commission reconcile). Production is only what is on `main`.

---

## 2. Claimed vs observed

| Claim | Observed 2026-08-31 night |
| --- | --- |
| Deploy Firebase Rules failed 8/8; latest run 33357754150 403 serviceusage/firebasestorage; rules not production until green | **Stale.** Run #8 failed as claimed; **run #10 and #11 succeeded**. Latest #11 green; Firestore + Storage deploy steps succeeded. |
| Sentry available for traces / p50/p95 | **ABSENT** — no Sentry integration in repo. |
| Exercise CRM as reader@gmail.com | **Blocked** — no session on device; no password use allowed. |
| Read Firestore as reader | **Not done** (depends on session). |
| Production site up | **Yes** — login page 200. |
| Daily renewal email alerts healthy | **No** — continuous Action failures; nodemailer missing; fix in open PR #25. |
| Vercel renewal WhatsApp cron fail-closed | Unauthenticated call returns Unauthorized — **consistent** with design. |

---

## 3. Cleanup (proposed only — Execute? unchecked)

> **Execute?** ☐ unchecked — proposals only. Do not run from this agent session.

1. **Merge PR #25** (or equivalent) so `nodemailer` is installed by `npm ci` and Node is current for Daily Renewal Alerts; then **Run workflow** once manually and confirm email or clean no-due exit.
2. **Operator sign-in** as `reader@gmail.com` on the QA device (or provide an already-authenticated browser session) so the next overnight can verify:
   - business collection reads
   - write controls denied by rules (not only UI)
   - `agent_action_log` append on denied attempts
3. **Optional:** confirm in Firebase Console that production rules revision matches post–run #11 deploy (no agent IAM/console write).
4. **Do not** from agent: deploy rules, grant IAM, merge to main, send WhatsApp, mutate Firestore, click Forgot password, or print passwords.

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
