# Overnight actions — 2026-08-31 IST
Status: REVIEW ONLY — nothing below was executed.
Tester constraint: reader@gmail.com only if session already available (no password lookup / no Forgot password).
App: https://gohil-investments.vercel.app
Repo: Harshdpsinh/gohil-investments @ main `e1677d79`
Sentry: **ABSENT** (no DSN / @sentry in production bundle or repo search).

Use this file in the morning: tick **Execute?** only for rows you want done, then do those yourself. The overnight agent must not tick them or run them.

---

## 1. Findings ranked by severity

### Sev-1 — Daily Renewal Alerts workflow fails every scheduled run

- **Symptom:** Job `send-alerts` exits with `ERR_MODULE_NOT_FOUND: Cannot find package 'nodemailer'`.
- **EVIDENCE:**
  - Latest failure: https://github.com/Harshdpsinh/gohil-investments/actions/runs/33367167573 (2026-08-31 ~07:09 UTC, conclusion `failure`).
  - Same pattern on prior days (runs 157, 156, … down through dozens of consecutive failures).
  - Log tail: `node .github/scripts/send-renewal-alerts.js` → `Cannot find package 'nodemailer' imported from .../send-renewal-alerts.js`.
  - Workflow also runs under Node 20 (deprecated on Actions) and installs the full app tree without ensuring `nodemailer` is a dependency of the script path.
- **Impact:** No automated renewal email alerts. Operational gap for due renewals.
- **Repro:** Open Actions → “🔔 Daily Renewal Alerts” → any recent scheduled run → job `send-alerts`.

### Sev-1 (cleared overnight) — Deploy Firebase Rules was 8/8 failed

- **Prior known Sev-0 (as of earlier 2026-08-31):** run https://github.com/Harshdpsinh/gohil-investments/actions/runs/33357754150 — conclusion **failure**, 403 on `serviceusage.googleapis.com` for `firebasestorage.googleapis.com`.
- **Re-verified tonight:** that run remains `failure` (historical). Subsequent runs after the fix that deploys Firestore rules alone are **green**:
  - Run 10: https://github.com/Harshdpsinh/gohil-investments/actions/runs/33412946650 — `success` (commit “actually deploy Firestore rules…”).
  - Run 11: https://github.com/Harshdpsinh/gohil-investments/actions/runs/33414219673 — `success` (commit “stop the repeating staff-provision errors”).
- **Conclusion:** Repo rules for Firestore are now being deployed. The prior Sev-0 is **closed** for current main. Storage rules may still be out of band if the workflow deliberately skips storage (by design after the fix).

### Sev-2 — Sentry absent

- **EVIDENCE:** Production JS bundle (`/assets/index-CKg2eUmr.js`) has no `sentry` / `ingest.sentry` string. Code search `sentry repo:Harshdpsinh/gohil-investments` → 0 hits. No p50/p95 available.
- **Impact:** No traces, issues, or latency percentiles by endpoint. Overnight QA cannot query Sentry.

### Sev-2 — Authenticated reader QA blocked (no session)

- **Constraint respected:** Did not invent or look up a password; did not click Forgot password; did not sign in as owner emails.
- **Observed:** Production serves login UI only. Browser has no existing `reader@gmail.com` session.
- **Blocked:** Firestore reads as reader, write-probe permission-denied checks, sidebar Reader badge, route loads under auth, agent_action_log UI.
- **EVIDENCE:** Live URL returns SPA shell + login form (“Welcome back”, placeholder `you@gohilinvestments.com`). Network/console from anonymous load only.

### Sev-3 — Production anonymous surface healthy

- **EVIDENCE:** `GET https://gohil-investments.vercel.app` → HTTP 200, Vercel cache HIT, title “Gohil Investments”, Firebase project id embedded as `gohil-investments`, authDomain `gohil-investments.firebaseapp.com`.
- Login form and Forgot password link render; no crash on cold load.

---

## 2. Claimed-vs-observed table

| Claim (from mission / repo docs / prior status) | Observed 2026-08-31 night |
| --- | --- |
| Deploy Firebase Rules 8/8 failed; run 33357754150 is latest failure | Run 33357754150 still **failure**. Newer runs 10 and 11 on main are **success**. Sev-0 cleared for current main. |
| Repo rules not production until job green | Job is green on latest main pushes → Firestore rules path is deploying. |
| Sentry exists for traces / p50 / p95 | **ABSENT** — no Sentry in bundle or repo. |
| Can exercise flows as reader@gmail.com if session available | **No session** on this device; login required; password not used. |
| Production CRM at gohil-investments.vercel.app | Up; anonymous login page loads; Firebase client config present. |
| Daily renewal automation | Workflow exists but fails every schedule (missing `nodemailer`). |
| Attach staff profile workflow | Run https://github.com/Harshdpsinh/gohil-investments/actions/runs/33414228839 **success** (workflow_dispatch). |

---

## 3. Do first (actionable)

| # | Severity | Where | Symptom | Proposed fix | Risk if ignored | Execute? |
|---|----------|-------|---------|--------------|-----------------|----------|
| 1 | Sev-1 | `.github/workflows/renewal-alerts.yml` + `.github/scripts/send-renewal-alerts.js` | Scheduled job cannot import `nodemailer` | Add `nodemailer` to the path the workflow installs (package.json dependency or isolated install in the job); pin Node 22+ to match engine warnings | Daily renewal emails never send | [ ] |
| 2 | Sev-2 | Observability | No Sentry | Optional: add Sentry (client + Vercel) if error/latency visibility is required | Blind to production JS errors | [ ] |
| 3 | Sev-2 | Overnight QA process | No reader session for night agent | Operator signs in as reader once on the QA device, or provides a short-lived session; do not put password in chat/logs | Auth-gated QA stays blocked | [ ] |

Severity guide: **Sev-0** live write by reader or rules not deployed. **Sev-1** broken automation / empty critical path. **Sev-2** observability or process gap. **Sev-3** cosmetic.

---

## Cleanup / data repair (proposed only — do not run overnight)

These are jobs the agent is *not* allowed to click: merge insurer names, mark commissions paid, delete duplicates, rewrite stored strings, import statements, send WhatsApp, mutate Firestore, deploy rules, grant IAM, merge to main.

| # | Kind | Collection / UI | Proposed change | Why it was not executed | Execute? |
|---|------|-----------------|-----------------|-------------------------|----------|
| 1 | Merge insurer names | `policies`, `commission_transactions` | Normalize stored ICICI variants via existing Commission banner | Live-data lock; no admin session used | [ ] |
| 2 | One-time settle | `commission_transactions` | Mark pre-upload book paid if still needed | Live-data lock | [ ] |
| 3 | Dependency fix | package / workflow | Install `nodemailer` for renewal script | Code change — branch + PR next day, not overnight mutate | [ ] |

No full PAN / Aadhaar / phone collected or stored.

---

## Code / rules patches (PR next day only)

| # | File | Change | Why |
|---|------|--------|-----|
| 1 | `package.json` and/or `.github/workflows/renewal-alerts.yml` | Ensure `nodemailer` is installed for the renewal script; prefer Node 22 | Fixes consecutive Daily Renewal Alerts failures |
| 2 | (optional) Sentry bootstrap | Client DSN + release if product wants it | Observability |

Do not merge overnight. Open a PR from this branch or a dedicated fix branch.

---

## Checks that passed (anonymous / repo only)

- Production URL responds 200
- Login UI renders without console-blocking errors (anonymous)
- Firebase client config present in bundle (`projectId: gohil-investments`)
- Deploy Firebase Rules: latest main runs **success** (10, 11)
- Attach staff workflow: last dispatch **success**
- Sentry search: intentionally reported as ABSENT

---

## Blocked / could not verify

- Login as `reader@gmail.com` (no pre-existing session; password not obtained)
- Sidebar Reader badge / amber read-only banner
- Authenticated route loads (`/dashboard`, `/clients`, `/policies`, `/renewals`, `/claims`, `/commission`, `/business`, `/inbox`)
- Write probe → `permission-denied` under reader rules
- Firestore data shape as reader
- Sentry issues / p50 / p95 by endpoint

---

## How to act in 5 minutes

1. Read **Do first**. Prioritize fixing Daily Renewal Alerts (`nodemailer`).
2. Confirm Deploy Firebase Rules stays green on next main push.
3. Tick **Execute?** only on rows you want; data rows only as **admin**.
4. For reader overnight QA next night: leave a signed-in reader session on the QA browser, or accept auth-gated checks remain blocked.
5. Leave unticked rows for later.
