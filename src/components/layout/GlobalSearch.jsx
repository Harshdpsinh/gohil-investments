import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClients } from '../../hooks/useClients'
import { usePolicies } from '../../hooks/usePolicies'
import AppIcon from '../ui/AppIcon'

function digits(value) {
  return String(value || '').replace(/\D/g, '')
}

export default function GlobalSearch({ compact = false }) {
  const { clients } = useClients()
  const { policies } = usePolicies()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const box = useRef(null)

  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (term.length < 2) return []
    const num = digits(term)
    const hits = []
    for (const c of clients) {
      const hay = `${c.name || ''} ${c.mobile || ''} ${c.pan || ''} ${c.email || ''}`.toLowerCase()
      if (hay.includes(term) || (num.length >= 4 && digits(c.mobile).includes(num))) {
        hits.push({ type: 'Client', id: c.id, label: c.name, sub: c.mobile, to: `/clients/${c.id}` })
      }
      if (hits.length >= 8) break
    }
    for (const p of policies) {
      const hay = `${p.policyNumber || ''} ${p.clientName || ''} ${p.insurer || ''}`.toLowerCase()
      if (hay.includes(term) || (num.length >= 4 && digits(p.policyNumber).includes(num))) {
        hits.push({ type: 'Policy', id: p.id, label: p.policyNumber || p.planName || 'Policy', sub: p.clientName, to: '/policies' })
      }
      if (hits.length >= 12) break
    }
    return hits.slice(0, 12)
  }, [q, clients, policies])

  useEffect(() => {
    const onDoc = e => {
      if (!box.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={box} className={`relative ${compact ? 'w-full' : 'w-full max-w-xl'}`}>
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
        <AppIcon name="search" size={16} />
      </span>
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Search name, mobile, PAN, policy number"
        className="form-input w-full pl-10 pr-16"
      />
      <kbd className="command-hint pointer-events-none absolute inset-y-0 right-2 my-auto h-5 items-center">Ctrl K</kbd>
      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {results.map(hit => (
            <li key={`${hit.type}-${hit.id}`}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-teal-50 dark:hover:bg-teal-950/40"
                onClick={() => {
                  navigate(hit.to)
                  setQ('')
                  setOpen(false)
                }}
              >
                <span className="font-semibold">{hit.label}</span>
                <span className="text-[11px] text-slate-400">{hit.type}{hit.sub ? ` · ${hit.sub}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && q.trim().length >= 2 && results.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-500 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          No record found
        </div>
      )}
    </div>
  )
}
