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

  const goFirst = () => {
    if (results[0]) {
      navigate(results[0].to)
      setQ('')
      setOpen(false)
    }
  }

  return (
    <div ref={box} className={`portal-search relative ${compact ? 'w-full' : ''}`}>
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => { if (e.key === 'Enter') goFirst() }}
        placeholder="Search services, name, mobile, policy"
        className="form-input w-full"
      />
      <button type="button" className="portal-search-go" onClick={goFirst} aria-label="Search">
        <AppIcon name="search" size={16} />
      </button>
      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-2 max-h-80 w-full overflow-auto rounded-2xl border border-[#eadfce] bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {results.map(hit => (
            <li key={`${hit.type}-${hit.id}`}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[#f6f0e8] dark:hover:bg-violet-950/40"
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
    </div>
  )
}
