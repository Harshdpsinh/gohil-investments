import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useClients } from '../hooks/useClients'
import { usePolicies } from '../hooks/usePolicies'
import { fmtDate } from '../utils/dateUtils'
import { anniversaryGreeting, birthdayGreeting, listOccasions } from '../utils/occasions'
import { openWhatsAppLink } from '../services/whatsappService'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'

const isActive = policy => !['Renewed-Out', 'Cancelled', 'Matured'].includes((policy.status || '').trim())

export default function WishesPage() {
  const { clients } = useClients()
  const { policies } = usePolicies()
  const [draft, setDraft] = useState(null)

  const rows = useMemo(() => listOccasions(clients, { withinDays: 14 }), [clients])
  const today = rows.filter(row => row.days === 0)
  const upcoming = rows.filter(row => row.days > 0)

  const openWish = row => {
    const count = policies.filter(policy => policy.clientId === row.client.id && isActive(policy)).length
    const message = row.kind === 'anniversary'
      ? anniversaryGreeting(row.client)
      : birthdayGreeting(row.client, count)
    setDraft({ ...row, message })
  }

  const send = () => {
    if (!draft?.client?.mobile) {
      toast.error('No mobile number on this client.')
      return
    }
    try {
      openWhatsAppLink({ mobile: draft.client.mobile, message: draft.message })
    } catch (err) {
      toast.error(err.message || 'Could not open WhatsApp.')
    }
  }

  return (
    <div className="fintech-page space-y-4">
      <PageHeader
        icon="clients"
        title="Wishes"
        subtitle="Birthdays and anniversaries in the next 14 days. Send uses the same WhatsApp path as Clients."
      />

      <WishList title={`Today (${today.length})`} rows={today} onWish={openWish} empty="No birthday or anniversary today." />
      <WishList title={`Upcoming (${upcoming.length})`} rows={upcoming} onWish={openWish} empty="None in the next two weeks." />

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.kind === 'anniversary' ? 'Anniversary wish' : 'Birthday wish'}
        subtitle={draft?.client?.name}
        footerContent={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>Close</button>
            <button type="button" className="btn-whatsapp" onClick={send}>Send WhatsApp</button>
          </>
        )}
      >
        <textarea
          className="form-input min-h-48"
          value={draft?.message || ''}
          onChange={event => setDraft(prev => ({ ...prev, message: event.target.value }))}
        />
      </Modal>
    </div>
  )
}

function WishList({ title, rows, onWish, empty }) {
  return (
    <div className="card space-y-2">
      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">{empty}</p>
      ) : rows.map(row => (
        <div key={`${row.client.id}-${row.kind}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{row.client.name}</p>
            <p className="text-[11px] text-slate-500">
              {row.kind === 'anniversary' ? 'Anniversary' : 'Birthday'}
              {' · '}
              {row.days === 0 ? 'Today' : `in ${row.days} day${row.days === 1 ? '' : 's'}`}
              {row.date ? ` · ${fmtDate(row.date)}` : ''}
            </p>
          </div>
          <button type="button" className="btn-whatsapp text-xs" onClick={() => onWish(row)}>Wish</button>
        </div>
      ))}
    </div>
  )
}
