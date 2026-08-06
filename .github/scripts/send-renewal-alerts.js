// .github/scripts/send-renewal-alerts.js
// ─────────────────────────────────────────────────────────────
// Queries Firestore for policies expiring in ≤ 30 days,
// builds a rich HTML email, and sends it via Gmail.
// Called by the GitHub Actions workflow every morning.
// ─────────────────────────────────────────────────────────────
import admin from 'firebase-admin'
import nodemailer from 'nodemailer'
// Same due-date rule as the app and the WhatsApp cron. This script used to work
// off p.expiryDate with a bare new Date(), which read legacy DD/MM/YYYY dates as
// MM/DD/YYYY and ignored nextPremiumDue, life policies and multi-year terms —
// so its "expiring in 30 days" list never matched what the Renewals page showed.
import { getDueDate, daysUntilPolicyDue, fmtDate } from '../../src/utils/dateUtils.js'

// ── Firebase Admin init (uses service account from secrets) ──
// Prefer the whole service-account JSON: deploy-firestore-rules.yml already
// needs that secret, so this workflow costs no extra ones. The three split
// vars stay as a fallback for anyone who set them before.
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT
admin.initializeApp({
  credential: admin.credential.cert(
    serviceAccountJson
      ? JSON.parse(serviceAccountJson)
      : {
          projectId:   process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // GitHub replaces \n literals; restore real newlines
          privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }
  ),
})

const db = admin.firestore()

// Policies in these states are finished and must never be chased. Same list as
// the app and the WhatsApp cron.
const STOP_STATUSES = new Set(['Renewed-Out', 'Cancelled', 'Matured'])

// ── Helper: format currency ────────────────────────────────────
function fmtCurrency(val) {
  const n = parseFloat(val || 0)
  if (isNaN(n)) return '₹0'
  return '₹' + n.toLocaleString('en-IN')
}

// ── Colour for urgency ────────────────────────────────────────
function urgencyColor(days) {
  if (days < 0)  return '#dc2626'   // red   – overdue
  if (days <= 7) return '#ea580c'   // orange – critical
  if (days <= 15)return '#d97706'   // amber  – urgent
  return               '#2563eb'   // blue   – upcoming
}

async function main() {
  console.log('📋 Fetching policies from Firestore…')

  const snap = await db.collection('policies').get()
  const allPolicies = snap.docs.map(d => ({ id: d.id, ...d.data() }))

  // Filter: active policies expiring within 30 days (including overdue)
  const DAYS_WINDOW = 30
  const alertPolicies = allPolicies
    .filter(p => {
      if (STOP_STATUSES.has(String(p.status || '').trim()) || p.is_renewed) return false
      const d = daysUntilPolicyDue(p)
      return d !== null && d <= DAYS_WINDOW
    })
    .sort((a, b) => (daysUntilPolicyDue(a) ?? 9999) - (daysUntilPolicyDue(b) ?? 9999))

  console.log(`Found ${alertPolicies.length} policies needing attention.`)

  if (alertPolicies.length === 0) {
    console.log('✅ No renewals due in the next 30 days. No email sent.')
    return
  }

  // ── Build HTML email ─────────────────────────────────────────
  const overdue  = alertPolicies.filter(p => daysUntilPolicyDue(p) <  0)
  const critical = alertPolicies.filter(p => { const d = daysUntilPolicyDue(p); return d >= 0 && d <= 7 })
  const upcoming = alertPolicies.filter(p => daysUntilPolicyDue(p) > 7)

  const tableRows = alertPolicies.map(p => {
    const days    = daysUntilPolicyDue(p)
    const color   = urgencyColor(days)
    const daysLbl = days < 0 ? `${Math.abs(days)}d OVERDUE` : `${days}d`
    return `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111">${p.clientName || '—'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:12px">${p.policyNumber || '—'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${p.policyType || '—'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${p.insurer || '—'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${fmtCurrency(p.premium)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${fmtDate(getDueDate(p))}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-weight:700;color:${color}">${daysLbl}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${p.clientMobile || p.phone || '—'}</td>
      </tr>`
  }).join('')

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  })

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">

<div style="max-width:900px;margin:24px auto;background:#fff;border-radius:12px;
            overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);padding:28px 32px">
    <h1 style="margin:0;color:#fff;font-size:22px">🏦 Gohil Investments</h1>
    <p style="margin:4px 0 0;color:#bfdbfe;font-size:13px">
      Daily Renewal Alert · ${today}
    </p>
  </div>

  <!-- Summary strip -->
  <div style="display:flex;gap:0;border-bottom:1px solid #e5e7eb">
    ${[
      ['⚠️ Overdue',   overdue.length,  '#fee2e2', '#dc2626'],
      ['🔴 Critical ≤7d', critical.length, '#fff7ed', '#ea580c'],
      ['📅 Upcoming',  upcoming.length, '#eff6ff', '#2563eb'],
      ['📋 Total',     alertPolicies.length, '#f0fdf4', '#16a34a'],
    ].map(([label, count, bg, color]) => `
      <div style="flex:1;text-align:center;padding:16px 8px;background:${bg}">
        <div style="font-size:24px;font-weight:700;color:${color}">${count}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px">${label}</div>
      </div>`
    ).join('')}
  </div>

  <!-- Table -->
  <div style="padding:24px;overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#1e3a8a">
          ${['Client','Policy No','Type','Insurer','Premium','Expiry','Days Left','Phone']
            .map(h => `<th style="padding:10px;text-align:left;color:#fff;font-size:12px;
                                  font-weight:600;white-space:nowrap">${h}</th>`)
            .join('')}
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </div>

  <!-- CTA -->
  <div style="padding:0 24px 28px;text-align:center">
    <p style="color:#6b7280;font-size:13px;margin-bottom:16px">
      Log in to your dashboard to process renewals and send WhatsApp reminders.
    </p>
    <a href="https://your-app-url.vercel.app/renewals"
       style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
              padding:12px 32px;border-radius:8px;font-weight:600;font-size:14px">
      🔗 Open Renewal Tracker
    </a>
  </div>

  <!-- Footer -->
  <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 24px;
              text-align:center;font-size:11px;color:#9ca3af">
    Gohil Investments · Bhavnagar, Gujarat · 7698997894<br/>
    This is an automated alert generated by GitHub Actions at 7:00 AM IST.
  </div>

</div>
</body>
</html>`

  // ── Send email via Gmail SMTP ─────────────────────────────────
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  })

  const recipients = process.env.ALERT_EMAIL_TO

  await transporter.sendMail({
    from:    `"Gohil Investments Alerts" <${process.env.GMAIL_USER}>`,
    to:      recipients,
    subject: `🔔 ${alertPolicies.length} Renewal Alert(s) — ${overdue.length} Overdue · ${today}`,
    html,
  })

  console.log(`✅ Alert email sent to: ${recipients}`)
  console.log(`   Total policies: ${alertPolicies.length} | Overdue: ${overdue.length}`)
}

main().catch(err => {
  console.error('❌ Alert script failed:', err)
  process.exit(1)
})
