// src/components/commission/StatementImportModal.jsx
// Upload an insurer commission statement, review what matched, then post.
// Nothing is written until the user presses Post.
import { useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../ui/Modal'
import { parseImportFile } from '../../utils/exportUtils'
import { matchStatement, normaliseStatement, postingKey, summarise } from '../../utils/commissionImport'
import { addCommissionTransaction, updatePolicy } from '../../firebase/firestore'
import { fmtCurrency } from '../../utils/dateUtils'

const STATUS_STYLE = {
  matched: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  review: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  unmatched: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
}

export default function StatementImportModal({ open, onClose, policies, user, onPosted }) {
  const fileRef = useRef(null)
  const [rows, setRows] = useState([])
  const [skipped, setSkipped] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState('')

  const stats = useMemo(() => summarise(rows), [rows])
  const postable = rows.filter(r => r.policy && !skipped.has(r.sourceRow))

  const reset = () => { setRows([]); setSkipped(new Set()); setFileName(''); if (fileRef.current) fileRef.current.value = '' }

  const onPick = async e => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const raw = await parseImportFile(file)
      const parsed = normaliseStatement(raw)
      if (!parsed.length) throw new Error('No usable rows found. Check the file has a header row.')
      setRows(matchStatement(parsed, policies))
      setFileName(file.name)
      setSkipped(new Set())
    } catch (err) {
      toast.error(err.message || 'Could not read that file.')
      reset()
    } finally {
      setBusy(false)
    }
  }

  const toggle = sourceRow => setSkipped(prev => {
    const next = new Set(prev)
    if (next.has(sourceRow)) next.delete(sourceRow)
    else next.add(sourceRow)
    return next
  })

  const post = async () => {
    if (!postable.length) return
    setBusy(true)
    let posted = 0, duplicates = 0, failed = 0

    for (const row of postable) {
      try {
        await addCommissionTransaction({
          policyId: row.policy.id,
          policyNumber: row.policy.policyNumber,
          clientId: row.policy.clientId || '',
          clientName: row.policy.clientName || row.clientName,
          insurer: row.policy.insurer || row.insurer,
          premium: row.premium || Number(row.policy.premium) || 0,
          receivedCommission: row.commissionAmount,
          netReceived: row.commissionAmount,
          payoutDate: row.payoutDate,
          payoutMonth: (row.payoutDate || '').slice(0, 7),
          status: 'posted',
          postingKey: postingKey(row),
          createdBy: user?.uid || '',
          createdByEmail: user?.email || '',
          remarks: `Imported from ${fileName} row ${row.sourceRow}`,
        })
        // Requirement: write the exact percentage back onto the policy.
        if (row.commissionPct > 0 && row.commissionPct <= 100) {
          await updatePolicy(row.policy.id, { fyCommission: row.commissionPct })
        }
        posted += 1
      } catch (err) {
        if (err?.code === 'commission/duplicate-post') duplicates += 1
        else { failed += 1; console.error('Commission post failed:', row.policyNumber, err) }
      }
    }

    setBusy(false)
    const parts = [`${posted} posted`]
    if (duplicates) parts.push(`${duplicates} already posted`)
    if (failed) parts.push(`${failed} failed`)
    failed ? toast.error(parts.join(' · ')) : toast.success(parts.join(' · '))
    if (posted) onPosted?.()
    reset()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : () => { reset(); onClose() }}
      title="Import Commission Statement"
      subtitle="Upload the insurer's .xlsx or .csv payout file, check the matches, then post."
      size="xl"
      footerContent={
        <>
          <button className="btn-secondary" disabled={busy} onClick={() => { reset(); onClose() }}>Cancel</button>
          <button className="btn-primary" disabled={busy || !postable.length} onClick={post}>
            {busy ? 'Working…' : `Post ${postable.length} row${postable.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      {!rows.length ? (
        <div className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={onPick}
            disabled={busy}
            className="form-input"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Column names are detected automatically — Policy No, Insured Name, Company,
            Premium, Commission %, Brokerage Amount and common variants all work.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Rows" value={stats.total} />
            <Tile label="Matched" value={stats.matched} tone="text-emerald-600 dark:text-emerald-400" />
            <Tile label="Needs review" value={stats.review} tone="text-amber-600 dark:text-amber-400" />
            <Tile label="Statement total" value={fmtCurrency(stats.amount)} />
          </div>

          <div className="max-h-[46vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                <tr>
                  {['Row', 'Policy', 'Client', 'Commission', 'Status', ''].map(h => (
                    <th key={h} className="table-header whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map(row => {
                  const off = skipped.has(row.sourceRow)
                  return (
                    <tr key={row.sourceRow} className={off ? 'opacity-40' : ''}>
                      <td className="table-cell text-gray-400">{row.sourceRow}</td>
                      <td className="table-cell font-mono">{row.policyNumber || '—'}</td>
                      <td className="table-cell">
                        <div className="font-semibold">{row.clientName || '—'}</div>
                        <div className="text-[11px] text-gray-500">{row.insurer}</div>
                      </td>
                      <td className="table-cell font-semibold">
                        {fmtCurrency(row.commissionAmount)}
                        {row.commissionPct > 0 && <span className="ml-1 text-gray-500">({row.commissionPct}%)</span>}
                      </td>
                      <td className="table-cell">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[row.status]}`}>
                          {row.status}
                        </span>
                        <div className="mt-0.5 text-[11px] text-gray-500">{row.reason}</div>
                      </td>
                      <td className="table-cell">
                        {row.policy ? (
                          <button onClick={() => toggle(row.sourceRow)} className="font-semibold text-blue-600 dark:text-blue-400">
                            {off ? 'Include' : 'Skip'}
                          </button>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Rows with no matched policy are never posted. Re-posting the same statement is
            safe — duplicates are rejected by the ledger.
          </p>
        </div>
      )}
    </Modal>
  )
}

function Tile({ label, value, tone = '' }) {
  return (
    <div className="rounded-xl border border-slate-200 p-2 dark:border-slate-700">
      <p className="text-[10px] font-bold tracking-wide text-gray-500">{label}</p>
      <p className={`text-base font-extrabold ${tone}`}>{value}</p>
    </div>
  )
}
