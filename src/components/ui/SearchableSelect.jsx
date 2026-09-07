// Combobox: type to filter a long list (clients, policies) then pick one id.
// The menu is portalled so it is not clipped by overflow:auto modal bodies.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import AppIcon from './AppIcon'

const norm = value => String(value || '').trim().toLowerCase()

export function filterOptions(options = [], query = '') {
  const q = norm(query)
  if (!q) return options
  return options.filter(opt => {
    const hay = `${opt.label || ''} ${opt.hint || ''} ${opt.value || ''}`
    return norm(hay).includes(q)
  })
}

export default function SearchableSelect({
  value = '',
  options = [],
  onChange,
  placeholder = 'Type a name to find…',
  emptyText = 'No match',
  required = false,
  disabled = false,
  className = '',
  name,
}) {
  const box = useRef(null)
  const input = useRef(null)
  const selected = options.find(opt => String(opt.value) === String(value))
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  const filtered = useMemo(
    () => filterOptions(options, open ? query : '').slice(0, 80),
    [options, open, query],
  )

  useEffect(() => {
    if (!open) return
    const place = () => {
      const rect = input.current?.getBoundingClientRect()
      if (!rect) return
      setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    const onDoc = event => {
      if (box.current?.contains(event.target)) return
      if (event.target?.closest?.('[data-searchable-select-menu]')) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = opt => {
    onChange?.(opt.value, opt)
    setQuery('')
    setOpen(false)
  }

  const shown = open ? query : (selected?.label || '')

  return (
    <div ref={box} className={`relative ${className}`}>
      <span className="pointer-events-none absolute inset-y-0 left-0 z-[1] flex items-center pl-3 text-slate-400">
        <AppIcon name="search" size={16} />
      </span>
      <input
        ref={input}
        name={name}
        disabled={disabled}
        required={required && !value}
        value={shown}
        placeholder={placeholder}
        autoComplete="off"
        aria-expanded={open}
        aria-autocomplete="list"
        role="combobox"
        className="form-input w-full pl-10"
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onChange={event => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (filtered[0]) pick(filtered[0])
          }
          if (event.key === 'Escape') setOpen(false)
        }}
      />
      {open && createPortal(
        <ul
          data-searchable-select-menu
          role="listbox"
          className="fixed z-[240] max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          style={{ top: pos.top, left: pos.left, width: Math.max(pos.width, 180) }}
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">{emptyText}</li>
          ) : filtered.map(opt => (
            <li key={String(opt.value)} role="option" aria-selected={String(opt.value) === String(value)}>
              <button
                type="button"
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${String(opt.value) === String(value) ? 'bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200' : ''}`}
                onMouseDown={event => event.preventDefault()}
                onClick={() => pick(opt)}
              >
                <span className="min-w-0 truncate font-medium">{opt.label}</span>
                {opt.hint ? <span className="shrink-0 text-[11px] text-slate-400">{opt.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  )
}

export function toClientOptions(clients = []) {
  return clients.map(c => ({
    value: c.id,
    label: c.name || 'Unnamed',
    hint: c.mobile || '',
  }))
}
