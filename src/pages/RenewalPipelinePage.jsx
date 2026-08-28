import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePolicies } from '../hooks/usePolicies'
import { fmtCurrency, fmtDate } from '../utils/dateUtils'
import { PIPELINE_COLUMNS, groupRenewalPipeline } from '../utils/renewalPipeline'
import { openWhatsAppLink } from '../services/whatsappService'
import AppIcon from '../components/ui/AppIcon'
import toast from 'react-hot-toast'

export default function RenewalPipelinePage() {
  const { policies, loading } = usePolicies()
  const navigate = useNavigate()
  const buckets = useMemo(() => groupRenewalPipeline(policies), [policies])

  const sendWa = policy => {
    if (!policy.clientMobile) {
      toast.error('No mobile on this policy')
      return
    }
    const msg =
      `Dear ${policy.clientName || 'Customer'},\n\n` +
      `Your ${policy.policyType || 'insurance'} policy ${policy.policyNumber} with ${policy.insurer || 'your insurer'} ` +
      `is due on ${fmtDate(policy.expiryDate || policy.nextPremiumDue)}.\n\n` +
      `Please contact us to renew without a break in cover.\n\n` +
      `Gohil Investments\nHarshdipsinh Gohil — 7698997894\nBhavnagar, Gujarat`
    try {
      openWhatsAppLink({ mobile: policy.clientMobile, message: msg })
    } catch (err) {
      toast.error(err.message)
    }
  }

  if (loading) return <div className="p-8 text-slate-400">Loading pipeline…</div>

  return (
    <div className="fintech-page space-y-5">
      <div className="fintech-header">
        <div>
          <p className="fintech-kicker">Renewals</p>
          <h1 className="fintech-title">Pipeline</h1>
          <p className="fintech-subtitle">Same due dates as the Renewals list, laid out as a board. Nothing is rewritten when you look at this view.</p>
        </div>
        <button className="btn-secondary" onClick={() => navigate('/renewals')}>Open list</button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {PIPELINE_COLUMNS.map(col => (
          <section key={col.id} className="flex w-72 shrink-0 flex-col rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="mb-3 flex items-baseline justify-between">
              <div>
                <h2 className="text-sm font-bold">{col.label}</h2>
                <p className="text-[11px] text-slate-500">{col.hint}</p>
              </div>
              <span className="text-xs font-bold text-teal-700">{(buckets[col.id] || []).length}</span>
            </div>
            <div className="space-y-2">
              {(buckets[col.id] || []).map(({ policy, days }) => (
                <article key={policy.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <p className="text-sm font-semibold">{policy.clientName || '—'}</p>
                  <p className="text-[11px] text-slate-500">{policy.policyNumber} · {policy.insurer}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-700">{fmtCurrency(policy.premium)} · {days < 0 ? `${Math.abs(days)}d late` : `${days}d`}</p>
                  <div className="mt-2 flex gap-2">
                    <button className="btn-whatsapp" onClick={() => sendWa(policy)}>WA</button>
                    <button className="btn-secondary text-xs" onClick={() => navigate('/renewals')}>Renew</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
