import { useEffect, useMemo, useRef, useState } from 'react'

function norm(value) {
  return String(value || '').trim().toLowerCase()
}

export default function SearchableSelect({
  value = '',
  options = [],
  onChange,
  placeholder = 'Search name…',
  emptyText = 'No record found',
  required = false,
  allowCustom = false,
  className = '',
  name,
}) {
  const box = useRef(null)
  const selected = options.find(opt => String(opt.value) === String(value))
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(selected?.label || (allowCustom ? value : '') || '')

  useEffect(() => {
    if (open) return
    setQuery(selected?.label || (allowCustom ? value : '') || '')
  }, [selected?.label, value, allowCustom, open])

  const filtered = useMemo(() => {
    const q = norm(query)
    if (!q) return options.slice(0, 80)
    return options.filter(opt => {
      const hay = `${opt.label || ''} ${opt.hint || ''} ${opt.value || ''}`
      return norm(hay).includes(q)
    }).slice(0, 80)
  }, [options, query])

  useEffect(() => {
    const onDoc = event => {
      if (!box.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = opt => {
    onChange?.(opt.value, opt)
    setQuery(opt.label || '')
    setOpen(false)
  }

  const onBlurCommit = () => {
    if (!allowCustom) return
    const match = options.find(opt => norm(opt.label) === norm(query))
    if (match) {
      onChange?.(match.value, match)
      setQuery(match.label)
      return
    }
    if (query.trim() && query.trim() !== value) onChange?.(query.trim())
  }

  return (
    <div ref={box} className={`relative ${className}`}>
      <input
        name={name}
        required={required && !value}
        value={open ? query : (selected?.label || (allowCustom ? value : '') || query)}
        placeholder={placeholder}
        autoComplete="off"
        className="form-input w-full"
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onChange={event => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onBlur={onBlurCommit}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (filtered[0]) pick(filtered[0])
            else if (allowCustom && query.trim()) {
              onChange?.(query.trim())
              setOpen(false)
            }
          }
          if (event.key === 'Escape') setOpen(false)
        }}
      />
      {open && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">{emptyText}</li>
          ) : filtered.map(opt => (
            <li key={String(opt.value)}>
              <button
                type="button"
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${String(opt.value) === String(value) ? 'bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200' : ''}`}
                onMouseDown={event => event.preventDefault()}
                onClick={() => pick(opt)}
              >
                <span className="font-medium">{opt.label}</span>
                {opt.hint ? <span className="text-[11px] text-slate-400">{opt.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
