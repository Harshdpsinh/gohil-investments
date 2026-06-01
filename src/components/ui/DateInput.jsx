import { useEffect, useState } from 'react'
import { fmtDate, parseAnyDate, toInputDate } from '../../utils/dateUtils'

function parseDmy(text) {
  const match = String(text || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return ''
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) return ''
  return toInputDate(date)
}

export default function DateInput({ value, onChange, className = 'form-input', ...props }) {
  const [text, setText] = useState('')

  useEffect(() => {
    setText(value ? fmtDate(value) : '')
  }, [value])

  const commit = (nextText) => {
    const trimmed = String(nextText || '').trim()
    if (!trimmed) {
      onChange?.('')
      return
    }
    const parsed = parseDmy(trimmed) || toInputDate(parseAnyDate(trimmed))
    if (parsed) {
      onChange?.(parsed)
      setText(fmtDate(parsed))
    }
  }

  const formatWhileTyping = (raw) => {
    const digits = String(raw || '').replace(/\D/g, '').slice(0, 8)
    if (digits.length <= 2) return digits
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="dd/mm/yyyy"
      value={text}
      onChange={e => {
        const next = formatWhileTyping(e.target.value)
        setText(next)
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(next)) commit(next)
      }}
      onBlur={() => commit(text)}
      className={className}
      {...props}
    />
  )
}
