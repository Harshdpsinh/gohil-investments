import { useEffect, useState } from 'react'

export default function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const text = String(value ?? '').trim()
  if (!text) return null

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        throw new Error('clipboard unavailable')
      }
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.left = '-9999px'
      document.body.appendChild(area)
      area.select()
      try {
        document.execCommand('copy')
      } catch {
        document.body.removeChild(area)
        return
      }
      document.body.removeChild(area)
    }
    setCopied(true)
  }

  return (
    <button
      type="button"
      onClick={event => { event.stopPropagation(); copy() }}
      className="ml-1 inline text-[11px] font-bold text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
      aria-live="polite"
      aria-label={copied ? `${label} copied` : label}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
