// src/pages/WhatsAppInboxPage.jsx
// Read and answer what clients send to the business WhatsApp number.
//
// The rule that shapes the whole screen: free text is only allowed for 24 hours
// after the client's own last message. Outside that, Meta accepts nothing but
// an approved template. So the window countdown is shown per conversation
// rather than being discovered when a send fails.
import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useClients } from '../hooks/useClients'
import { usePolicies } from '../hooks/usePolicies'
import { markConversationRead, subscribeWhatsAppMessages } from '../firebase/firestore'
import { sendWhatsApp } from '../utils/whatsappSender'
import {
  buildConversations, formatWindow, matchConversationClient,
} from '../utils/whatsappInbox'
import { fmtCurrency, fmtDate, getDueDate, daysUntilPolicyDue } from '../utils/dateUtils'
import PageHeader from '../components/ui/PageHeader'
import EmptyState from '../components/ui/EmptyState'
import AppIcon from '../components/ui/AppIcon'

const time = ts => new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
const day = ts => new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

// Delivery states, in the order Meta reports them.
const TICK = { sent: '✓', delivered: '✓✓', read: '✓✓', failed: '!' }

export default function WhatsAppInboxPage() {
  const { clients } = useClients()
  const { policies } = usePolicies()
  const [messages, setMessages] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [activeWaId, setActiveWaId] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const threadRef = useRef(null)

  useEffect(() => {
    const unsub = subscribeWhatsAppMessages(
      rows => { setMessages(rows); setLoading(false) },
      err => {
        // A missing composite index is the likely first failure here, and its
        // message contains the link to create it — so show it, do not swallow.
        setError(err.message || 'Could not load WhatsApp messages.')
        setLoading(false)
      }
    )
    return unsub
  }, [])

  const conversations = useMemo(() => buildConversations(messages), [messages])
  const active = conversations.find(c => c.waId === activeWaId) || null

  const activeClient = useMemo(
    () => (active ? matchConversationClient(active.waId, clients) : null),
    [active, clients]
  )
  const clientPolicies = useMemo(() => {
    if (!activeClient) return []
    return policies
      .filter(p => p.clientId === activeClient.id && !p.deleted)
      .sort((a, b) => daysUntilPolicyDue(a) - daysUntilPolicyDue(b))
  }, [activeClient, policies])

  // Opening a conversation clears its badge.
  useEffect(() => {
    if (!active?.unread) return
    const unread = active.messages.filter(m => m.direction === 'in' && !m.read).map(m => m.id)
    markConversationRead(active.waId, unread).catch(() => {})
  }, [active])

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [active?.messages.length, activeWaId])

  const send = async () => {
    const body = draft.trim()
    if (!body || !active || sending) return
    setSending(true)
    try {
      const result = await sendWhatsApp({ number: active.waId, text: body })
      if (result.ok) {
        setDraft('')
        // The webhook mirrors it back; nothing to insert locally.
        toast.success('Sent.')
      } else {
        toast.error(result.error || 'Could not send.')
      }
    } finally {
      setSending(false)
    }
  }

  const totalUnread = conversations.reduce((n, c) => n + c.unread, 0)

  return (
    <div className="fintech-page space-y-4">
      <PageHeader
        icon="message"
        title="WhatsApp Inbox"
        subtitle={
          conversations.length
            ? `${conversations.length} conversation${conversations.length === 1 ? '' : 's'}${totalUnread ? ` · ${totalUnread} unread` : ''}`
            : 'Replies from clients arrive here'
        }
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          <strong>Could not load messages.</strong> {error}
          {/^Missing or insufficient permissions/i.test(error) && (
            <span className="mt-1 block text-red-700 dark:text-red-300">
              The Firestore rules for <code>whatsapp_messages</code> have not been published yet.
              Publish <code>firestore.rules</code> in the Firebase Console and this will clear.
            </span>
          )}
        </div>
      )}

      {error ? null : !loading && !conversations.length ? (
        <EmptyState
          icon="message"
          title="No conversations yet"
          description="Messages clients send to your business number will appear here. Nothing arrives until the WhatsApp number is live and its webhook is pointed at this app."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">

          {/* Conversation list */}
          <div className="fintech-panel max-h-[70vh] overflow-y-auto p-2">
            {loading && <p className="p-4 text-xs text-gray-500">Loading…</p>}
            {conversations.map(convo => {
              const client = matchConversationClient(convo.waId, clients)
              const on = convo.waId === activeWaId
              return (
                <button
                  key={convo.waId}
                  onClick={() => setActiveWaId(convo.waId)}
                  className={`mb-1 w-full rounded-lg p-2.5 text-left transition-colors ${
                    on ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-bold text-gray-900 dark:text-gray-100">
                      {client?.name || convo.profileName || convo.waId}
                    </span>
                    <span className="shrink-0 text-[10px] text-gray-400">{day(convo.lastAt)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{convo.preview || '—'}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      convo.window.open
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                        : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                    }`}>
                      {formatWindow(convo.window.remainingMs)}
                    </span>
                    {convo.unread > 0 && (
                      <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{convo.unread}</span>
                    )}
                    {!client && <span className="text-[10px] text-amber-600 dark:text-amber-400">not a client</span>}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Thread */}
          <div className="fintech-panel flex max-h-[70vh] flex-col">
            {!active ? (
              <p className="p-8 text-center text-sm text-gray-500">Pick a conversation to read it.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-3 dark:border-slate-700">
                  <div>
                    <p className="text-sm font-extrabold text-gray-950 dark:text-white">
                      {activeClient?.name || active.profileName || active.waId}
                    </p>
                    <p className="text-xs text-gray-500">+{active.waId}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    active.window.open
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                      : 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100'
                  }`}>
                    {active.window.open ? `Free replies · ${formatWindow(active.window.remainingMs)}` : 'Window closed'}
                  </span>
                </div>

                {/* What this person actually holds — the reason to answer from
                    the CRM rather than a generic inbox. */}
                {clientPolicies.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto border-b border-slate-200 p-2 dark:border-slate-700">
                    {clientPolicies.slice(0, 4).map(policy => {
                      const days = daysUntilPolicyDue(policy)
                      return (
                        <div key={policy.id} className="min-w-[10rem] shrink-0 rounded-lg border border-slate-200 p-2 text-[11px] dark:border-slate-700">
                          <p className="font-bold text-gray-900 dark:text-gray-100">{policy.policyType} · {policy.insurer}</p>
                          <p className="font-mono text-gray-500">{policy.policyNumber}</p>
                          <p className="text-gray-600 dark:text-gray-300">{fmtCurrency(policy.premium)}</p>
                          <p className={days <= 30 ? 'font-bold text-red-600 dark:text-red-400' : 'text-gray-500'}>
                            Due {fmtDate(getDueDate(policy))}{days <= 30 ? ` · ${days}d` : ''}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div ref={threadRef} className="flex-1 space-y-2 overflow-y-auto p-3">
                  {active.messages.map(message => (
                    <div
                      key={message.id || message.messageId}
                      className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                        message.direction === 'out'
                          ? 'ml-auto bg-emerald-100 dark:bg-emerald-900/40'
                          : 'bg-slate-100 dark:bg-slate-800'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">{message.text || `[${message.type}]`}</p>
                      <p className="mt-0.5 text-right text-[10px] text-gray-500">
                        {time(message.timestamp)}
                        {message.direction === 'out' && (
                          <span className={message.status === 'read' ? ' text-blue-600 dark:text-blue-400' : message.status === 'failed' ? ' text-red-600' : ''}>
                            {' '}{TICK[message.status] || ''}
                          </span>
                        )}
                      </p>
                      {message.error && <p className="text-[10px] font-semibold text-red-600">{message.error}</p>}
                    </div>
                  ))}
                </div>

                <div className="border-t border-slate-200 p-3 dark:border-slate-700">
                  {active.window.open ? (
                    <div className="flex gap-2">
                      <input
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                        placeholder="Type a reply…"
                        className="form-input flex-1"
                        disabled={sending}
                      />
                      <button className="btn-primary" disabled={sending || !draft.trim()} onClick={send}>
                        {sending ? '…' : <AppIcon name="message" size={16} />}
                      </button>
                    </div>
                  ) : (
                    <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                      <strong>The 24-hour window has closed.</strong> Meta will not deliver free text now — only
                      an approved template. Send the renewal reminder from the Renewals page, or wait for this
                      client to message you again, which reopens the window for another 24 hours.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
