import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClients } from '../../hooks/useClients'
import { usePolicies } from '../../hooks/usePolicies'
import AppIcon from '../ui/AppIcon'

const PAGES = [
  { label: 'Dashboard', to: '/dashboard', hint: 'Home' },
  { label: 'Clients', to: '/clients', hint: 'Client book' },
  { label: 'Policies', to: '/policies', hint: 'Policy book' },
  { label: 'Renewals', to: '/renewals', hint: 'Due list' },
  { label: 'Renewal pipeline', to: '/pipeline', hint: '30 / 15 / 7 / expired board' },
  { label: 'WhatsApp Inbox', to: '/inbox', hint: 'Messages' },
  { label: 'Commission', to: '/commission', hint: 'Ledger' },
  { label: 'Business Done', to: '/business', hint: 'Sold book' },
  { label: 'Claims', to: '/claims', hint: 'Claims board' },
  { label: 'Coverage gaps', to: '/cross-sell', hint: 'Cross-sell' },
  { label: 'Proposals', to: '/proposals', hint: 'Quotes' },
  { label: 'Reports', to: '/reports', hint: 'Exports' },
  { label: 'Backup', to: '/backup', hint: 'Download JSON' },
]

function digits(value) {
  return String(value || '').replace(/\D/g, '')
}

export default function CommandPalette() {
  const navigate = useNavigate()
  const { clients } = useClients()
  const { policies } = usePolicies()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    const onKey = event => {
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(value => !value)
        setQ('')
        setActive(0)
      }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 20)
      return () => window.clearTimeout(id)
    }
    return undefined
  }, [open])

  const items = useMemo(() => {
    const term = q.trim().toLowerCase()
    const num = digits(term)
    const rows = []

    for (const page of PAGES) {
      if (!term || page.label.toLowerCase().includes(term) || page.hint.toLowerCase().includes(term)) {
        rows.push({ kind: 'Page', label: page.label, sub: page.hint, to: page.to })
      }
    }

    if (term.length >= 2) {
      for (const client of clients) {
        const hay = `${client.name || ''} ${client.mobile || ''} ${client.pan || ''} ${client.email || ''}`.toLowerCase()
        if (hay.includes(term) || (num.length >= 4 && digits(client.mobile).includes(num))) {
          rows.push({
            kind: 'Client',
            label: client.name || 'Unnamed client',
            sub: [client.mobile, client.pan].filter(Boolean).join(' · '),
            to: `/clients/${client.id}`,
          })
        }
        if (rows.length > 40) break
      }
      for (const policy of policies) {
        const hay = `${policy.policyNumber || ''} ${policy.clientName || ''} ${policy.insurer || ''} ${policy.planName || ''}`.toLowerCase()
        if (hay.includes(term) || (num.length >= 4 && digits(policy.policyNumber).includes(num))) {
          rows.push({
            kind: 'Policy',
            label: policy.policyNumber || policy.planName || 'Policy',
            sub: [policy.clientName, policy.insurer].filter(Boolean).join(' · '),
            to: '/policies',
          })
        }
        if (rows.length > 50) break
      }
    }

    return rows.slice(0, 18)
  }, [q, clients, policies])

  useEffect(() => {
    setActive(0)
  }, [q, open])

  const go = item => {
    if (!item) return
    navigate(item.to)
    setOpen(false)
    setQ('')
  }

  if (!open) return null

  return (
    <div className="command-palette-scrim" onClick={() => setOpen(false)}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
          <AppIcon name="search" size={16} />
          <input
            ref={inputRef}
            value={q}
            onChange={event => setQ(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive(i => Math.min(items.length - 1, i + 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive(i => Math.max(0, i - 1))
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                go(items[active])
              }
            }}
            placeholder="Search clients, PAN, mobile, policy no, or jump to a page"
            className="w-full border-0 bg-transparent text-sm outline-none"
          />
          <kbd className="hidden rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 sm:inline">ESC</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {items.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-slate-500">No record found</li>
          )}
          {items.map((item, index) => (
            <li key={`${item.kind}-${item.to}-${item.label}-${index}`}>
              <button
                type="button"
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                  index === active ? 'bg-teal-50 dark:bg-teal-950/40' : ''
                }`}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(item)}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{item.label}</span>
                  {item.sub ? <span className="block truncate text-[11px] text-slate-500">{item.sub}</span> : null}
                </span>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">{item.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
