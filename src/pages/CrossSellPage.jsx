import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClients } from '../hooks/useClients'
import { usePolicies } from '../hooks/usePolicies'
import { computeCoverageGaps } from '../utils/policySchemas'
import { crossSellMessage } from '../utils/occasions'
import { openWhatsAppLink } from '../services/whatsappService'
import AppIcon from '../components/ui/AppIcon'
import toast from 'react-hot-toast'

const isActive = p => !['Renewed-Out', 'Cancelled', 'Matured'].includes((p.status || '').trim())

export default function CrossSellPage() {
  const { clients, loading: cLoad } = useClients()
  const { policies, loading: pLoad } = usePolicies()
  const navigate = useNavigate()

  const rows = useMemo(() => {
    const active = policies.filter(isActive)
    return clients
      .map(client => {
        const own = active.filter(p => p.clientId === client.id)
        const gaps = computeCoverageGaps(own)
        return { client, gaps, policyCount: own.length }
      })
      .filter(row => row.gaps.length > 0)
      .sort((a, b) => b.gaps.length - a.gaps.length)
  }, [clients, policies])

  const sendWa = row => {
    if (!row.client.mobile) {
      toast.error('No mobile on this client')
      return
    }
    try {
      openWhatsAppLink({ mobile: row.client.mobile, message: crossSellMessage(row.client, row.gaps) })
    } catch (err) {
      toast.error(err.message)
    }
  }

  if (cLoad || pLoad) return <div className="p-8 text-slate-400">Loading coverage gaps…</div>

  return (
    <div className="fintech-page space-y-5">
      <div className="fintech-header">
        <div>
          <p className="fintech-kicker">Growth</p>
          <h1 className="fintech-title">Coverage gaps</h1>
          <p className="fintech-subtitle">Same gap rules as the client profile. This page turns them into a call list.</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card text-sm text-slate-500">No coverage gaps on active policies.</div>
      ) : (
        <div className="space-y-3">
          {rows.map(row => (
            <div key={row.client.id} className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold">{row.client.name}</p>
                <p className="text-xs text-slate-500">{row.client.mobile || 'No mobile'} · {row.policyCount} active policies</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {row.gaps.map(g => (
                    <span key={g.id} className={`text-xs font-semibold ${g.color} rounded-full px-3 py-1`}>{g.label}</span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn-whatsapp" onClick={() => sendWa(row)}>
                  <AppIcon name="message" size={16} /> WhatsApp
                </button>
                <button className="btn-secondary" onClick={() => navigate(`/clients/${row.client.id}`)}>Profile</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
