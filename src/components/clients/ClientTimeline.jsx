import { useEffect, useMemo, useState } from 'react'
import { fmtDateTime } from '../../utils/dateUtils'
import { buildClientTimeline, TIMELINE_TYPE_LABEL } from '../../utils/clientTimeline'
import { addClientActivity, subscribeClientActivities, subscribeWhatsAppMessages } from '../../firebase/firestore'
import { useAuth } from '../../hooks/useAuth'
import AppIcon from '../ui/AppIcon'
import toast from 'react-hot-toast'

const TONE = {
  client: 'badge-gray',
  policy: 'badge-blue',
  claim: 'badge-orange',
  endorsement: 'badge-purple',
  'whatsapp-in': 'badge-green',
  'whatsapp-out': 'badge-green',
  note: 'badge-yellow',
}

export default function ClientTimeline({ client, policies = [], claims = [] }) {
  const { user } = useAuth()
  const [notes, setNotes] = useState([])
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!client?.id) return undefined
    return subscribeClientActivities(client.id, setNotes)
  }, [client?.id])

  useEffect(() => {
    return subscribeWhatsAppMessages(setMessages, undefined, 180)
  }, [])

  const events = useMemo(
    () => buildClientTimeline({ client, policies, claims, messages, notes }),
    [client, policies, claims, messages, notes]
  )

  const onAdd = async e => {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    setSaving(true)
    try {
      await addClientActivity({
        clientId: client.id,
        title: body.slice(0, 80),
        body,
        createdBy: user?.email || '',
      })
      setDraft('')
      toast.success('Note added to timeline')
    } catch (err) {
      toast.error(err.message || 'Could not save note')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200">
          <AppIcon name="history" size={18} />
        </span>
        <h2 className="text-base font-bold">Timeline</h2>
        <span className="ml-auto text-xs font-semibold text-slate-500">{events.length}</span>
      </div>

      <form onSubmit={onAdd} className="mb-4 flex gap-2">
        <input
          className="form-input flex-1"
          placeholder="Add a note to this client…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={saving || !draft.trim()}>Save</button>
      </form>

      {events.length === 0 ? (
        <p className="text-sm text-slate-500">No activity recorded yet.</p>
      ) : (
        <ol className="space-y-3">
          {events.slice(0, 40).map(event => (
            <li key={event.id} className="flex gap-3 border-b border-slate-100 pb-3 last:border-0 dark:border-slate-800">
              <span className={`${TONE[event.type] || 'badge-gray'} mt-0.5 shrink-0`}>
                {TIMELINE_TYPE_LABEL[event.type] || event.type}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{event.title}</p>
                {event.body ? <p className="mt-0.5 text-xs text-slate-500">{event.body}</p> : null}
                <p className="mt-1 text-[11px] text-slate-400">
                  {event.atLabel ? fmtDateTime(event.atLabel) : fmtDateTime(event.at)}
                  {event.author ? ` · ${event.author}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
