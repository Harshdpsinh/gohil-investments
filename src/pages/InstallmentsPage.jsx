import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePolicies } from '../hooks/usePolicies'
import { fmtCurrency, fmtDate } from '../utils/dateUtils'
import { listInstallments } from '../utils/installments'
import { openWhatsAppLink } from '../services/whatsappService'
import AppIcon from '../components/ui/AppIcon'
import toast from 'react-hot-toast'

const TONE = {
  overdue: 'badge-red',
  today: 'badge-red',
  week: 'badge-yellow',
  month: 'badge-blue',
  later: 'badge-gray',
}

export default function InstallmentsPage() {
  const { policies, loading } = usePolicies()
  const navigate = useNavigate()
  const rows = useMemo(() => listInstallments(policies), [policies])

  const sendWa = row => {
    const p = row.policy
    const mobile = p.clientMobile
    if (!mobile) {
      toast.error('No mobile on this policy')
      return
    }
    const msg =
      `Dear ${p.clientName || 'Customer'},\n\n` +
      `Your ${p.policyType || 'insurance'} premium of ${fmtCurrency(p.premium)} for policy ${p.policyNumber} ` +
      `(${p.frequency}) is due on ${fmtDate(row.dueDate)}.\n\n` +
      `Please complete the payment to keep the cover active.\n\n` +
      `Gohil Investments\nHarshdipsinh Gohil — 7698997894\nBhavnagar, Gujarat`
    try {
      openWhatsAppLink({ mobile, message: msg })
    } catch (err) {
      toast.error(err.message)
    }
  }

  if (loading) return <div className="p-8 text-slate-400">Loading installments…</div>

  return (
    <div className="fintech-page space-y-5">
      <div className="fintech-header">
        <div>
          <p className="fintech-kicker">Premiums</p>
          <h1 className="fintech-title">Installments due</h1>
          <p className="fintech-subtitle">Monthly, quarterly and half-yearly premiums in the next 45 days. Yearly renewals stay on Renewals.</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card text-sm text-slate-500">No installment premiums in this window.</div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                {['Due', 'Status', 'Client', 'Policy', 'Insurer', 'Frequency', 'Premium', ''].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.policy.id} className="table-row">
                  <td className="table-cell">{fmtDate(row.dueDate)} · {row.days === 0 ? 'today' : row.days > 0 ? `${row.days}d` : `${Math.abs(row.days)}d late`}</td>
                  <td className="table-cell"><span className={TONE[row.status.id]}>{row.status.label}</span></td>
                  <td className="table-cell font-semibold">{row.policy.clientName || '—'}</td>
                  <td className="table-cell">{row.policy.policyNumber}</td>
                  <td className="table-cell">{row.policy.insurer}</td>
                  <td className="table-cell">{row.frequency}</td>
                  <td className="table-cell text-right">{fmtCurrency(row.policy.premium)}</td>
                  <td className="table-cell">
                    <div className="flex gap-2">
                      <button className="btn-whatsapp" onClick={() => sendWa(row)}>WA</button>
                      <button className="btn-secondary text-xs" onClick={() => navigate('/policies')}>Open</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
