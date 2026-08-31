import { useEffect, useState } from 'react'
import { subscribeAgentAttempts } from '../../firebase/agentActionLog'
import { useAuth } from '../../hooks/useAuth'

function when(value) {
  if (!value) return '—'
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
}

export default function WriteAttemptLog() {
  const { isAdmin, isReader } = useAuth()
  const [rows, setRows] = useState([])

  useEffect(() => {
    if (!isAdmin && !isReader) return undefined
    return subscribeAgentAttempts(setRows)
  }, [isAdmin, isReader])

  if (!isAdmin && !isReader) return null

  return (
    <div className="m-3 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="font-bold text-slate-900 dark:text-slate-100">Write attempts</p>
      <p className="mt-1 text-xs text-slate-500">
        Append-only <span className="font-mono">agent_action_log</span>.
        A denied row is the attempt. An empty list means no SDK write was logged — not that nothing happened.
      </p>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">No attempts logged yet.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-xs">
          {rows.slice(0, 12).map(row => (
            <li key={row.id} className="flex flex-wrap gap-x-2 font-mono">
              <span className={row.outcome === 'succeeded' ? 'font-bold text-red-600' : 'text-amber-700'}>
                {row.outcome}
              </span>
              <span>{row.op}</span>
              <span className="truncate text-slate-500">{row.path || row.message}</span>
              <span className="text-slate-400">{when(row.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
