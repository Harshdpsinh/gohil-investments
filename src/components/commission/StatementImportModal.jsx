// src/components/commission/StatementImportModal.jsx
// Upload a commission statement, verify every row against the policy book,
// then save. Nothing is written until "Verify & Save Records" is pressed.
import { useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../ui/Modal'
import { parseImportFile } from '../../utils/exportUtils'
import { matchStatement, normaliseStatement, postingKey, summarise } from '../../utils/commissionImport'
import { addCommissionTransaction, updatePolicy } from '../../firebase/firestore'
import { fmtCurrency } from '../../utils/dateUtils'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const STATUS_STYLE = {
  matched: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  review: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  unmatched: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
}

const sameish = (a, b) => {
  const k = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const x = k(a), y = k(b)
  return Boolean(x && y) && (x === y || x.includes(y) || y.includes(x))
}

const thisYear = new Date().getFullYear()
const YEARS = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2]

export default function StatementImportModal({ open, onClose, policies, user, onPosted }) {
  const fileRef = useRef(null)
  const [month, setMonth] = useState('')
  const [year, setYear] = useState(String(thisYear))
  const [mode, setMode] = useState('')            // 'single' | 'multi'
  const [insurer, setInsurer] = useState('')      // single-carrier only
  const [parsed, setParsed] = useState([])
  const [edits, setEdits] = useState({})          // sourceRow -> field overrides
  const [skipped, setSkipped] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const [format, setFormat] = useState('')
  const [noDetail, setNoDetail] = useState(false)

  const insurerOptions = useMemo(
    () => [...new Set(policies.map(p => p.insurer).filter(Boolean))].sort(),
    [policies]
  )

  // Gate: nothing may be uploaded until the statement is described.
  const ready = Boolean(month && year && mode && (mode === 'multi' || insurer))

  // Edits apply before matching, so correcting a policy number re-matches live.
  const rows = useMemo(() => {
    const applied = parsed.map(row => ({ ...row, ...(edits[row.sourceRow] || {}) }))
    return matchStatement(applied, policies, mode === 'single' ? insurer : '')
  }, [parsed, edits, policies, insurer, mode])

  const stats = useMemo(() => summarise(rows), [rows])
  const postable = rows.filter(r => r.policy && !skipped.has(r.sourceRow))
  const payoutMonth = month && year ? `${year}-${String(MONTHS.indexOf(month) + 1).padStart(2, '0')}` : ''

  const reset = () => {
    setParsed([]); setEdits({}); setSkipped(new Set())
    setFileName(''); setFormat(''); setNoDetail(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const closeAll = () => { reset(); setMonth(''); setMode(''); setInsurer(''); onClose() }

  const handleFile = async file => {
    if (!file || !ready) return
    setBusy(true)
    try {
      let list, detected
      if (/\.pdf$/i.test(file.name)) {
        // Loaded on demand: pdfjs is ~330KB and most statements are sheets.
        const { parsePdfStatement } = await import('../../utils/pdfStatement')
        const result = await parsePdfStatement(await file.arrayBuffer())
        list = result.rows
        detected = result.format
        if (!list.length) {
          setNoDetail(true); setFileName(file.name); setFormat(detected); setBusy(false)
          return
        }
      } else {
        list = normaliseStatement(await parseImportFile(file))
        detected = 'spreadsheet'
        if (!list.length) throw new Error('No usable rows found. Check the file has a header row.')
      }
      setParsed(list)
      setFormat(detected)
      setNoDetail(false)
      setFileName(file.name)
      setSkipped(new Set())
      setEdits({})
    } catch (err) {
      toast.error(err.message || 'Could not read that file.')
      reset()
    } finally {
      setBusy(false)
    }
  }

  const edit = (sourceRow, field, value) =>
    setEdits(prev => ({ ...prev, [sourceRow]: { ...(prev[sourceRow] || {}), [field]: value } }))

  const toggle = sourceRow => setSkipped(prev => {
    const next = new Set(prev)
    if (next.has(sourceRow)) next.delete(sourceRow)
    else next.add(sourceRow)
    return next
  })

  const save = async () => {
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
          insurer: row.insurer || insurer || row.policy.insurer || '',
          premium: row.premium || Number(row.policy.premium) || 0,
          receivedCommission: row.commissionAmount,
          netReceived: row.commissionAmount,
          payoutMonth,
          payoutDate: row.payoutDate || '',
          status: 'posted',
          postingKey: `${postingKey(row)}_${payoutMonth}`,
          createdBy: user?.uid || '',
          createdByEmail: user?.email || '',
          remarks: [
            `Imported from ${fileName} row ${row.sourceRow}`,
            row.businessType && `Business: ${row.businessType}`,
            row.planName && `Plan: ${row.planName}`,
          ].filter(Boolean).join(' · '),
        })
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
    const parts = [`${posted} saved`]
    if (duplicates) parts.push(`${duplicates} already posted`)
    if (failed) parts.push(`${failed} failed`)
    if (failed) toast.error(parts.join(' · '))
    else toast.success(parts.join(' · '))
    if (posted) onPosted?.()
    closeAll()
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : closeAll}
      title="Import Commission Statement"
      subtitle="Describe the statement, upload it, check every row, then save."
      size="xl"
      footerContent={
        <>
          <button className="btn-secondary" disabled={busy} onClick={closeAll}>Cancel</button>
          <button className="btn-primary" disabled={busy || !postable.length} onClick={save}>
            {busy ? 'Working…' : `Verify & Save ${postable.length} Record${postable.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Statement month *</span>
            <select className="form-input mt-1" value={month} disabled={!!parsed.length}
                    onChange={e => setMonth(e.target.value)}>
              <option value="">Select…</option>
              {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Year *</span>
            <select className="form-input mt-1" value={year} disabled={!!parsed.length}
                    onChange={e => setYear(e.target.value)}>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Statement type *</span>
            <select className="form-input mt-1" value={mode} disabled={!!parsed.length}
                    onChange={e => { setMode(e.target.value); setInsurer('') }}>
              <option value="">Select…</option>
              <option value="single">Single carrier statement</option>
              <option value="multi">Multi-company / broker bill</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-bold text-gray-600 dark:text-gray-300">
              {mode === 'multi' ? 'Carrier (per row)' : 'Carrier *'}
            </span>
            <select className="form-input mt-1" value={insurer}
                    disabled={mode !== 'single' || !!parsed.length}
                    onChange={e => setInsurer(e.target.value)}>
              <option value="">{mode === 'multi' ? 'Read from each row' : 'Select…'}</option>
              {insurerOptions.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        </div>

        {noDetail ? (
          <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              {fileName} contains no policy-level rows
            </p>
            <p className="text-sm text-amber-800 dark:text-amber-300">
              This statement reports totals only, so there is nothing to reconcile against
              individual policies. Nothing has been changed. Ask the insurer for the
              policy-wise annexure.
            </p>
            <button className="btn-secondary" onClick={reset}>Choose another file</button>
          </div>
        ) : !rows.length ? (
          <div
            onDragOver={e => { e.preventDefault(); if (ready) setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]) }}
            onClick={() => ready && fileRef.current?.click()}
            className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
              !ready
                ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60 dark:border-slate-700 dark:bg-slate-900'
                : dragging
                  ? 'cursor-pointer border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                  : 'cursor-pointer border-slate-300 hover:border-blue-400 dark:border-slate-600'
            }`}
          >
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.pdf" className="hidden"
                   onChange={e => handleFile(e.target.files?.[0])} />
            <p className="font-semibold text-gray-700 dark:text-gray-200">
              {busy
                ? 'Reading…'
                : ready
                  ? 'Drop the statement here, or click to choose'
                  : 'Select month, year and statement type first'}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              .csv, .xlsx and text .pdf accepted for any carrier
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label={format ? `Rows · ${format}` : 'Rows'} value={stats.total} />
              <Tile label="Matched" value={stats.matched} tone="text-emerald-600 dark:text-emerald-400" />
              <Tile label="Needs review" value={stats.review} tone="text-amber-600 dark:text-amber-400" />
              <Tile label="Statement total" value={fmtCurrency(stats.amount)} />
            </div>

            <div className="max-h-[44vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                  <tr>
                    {['Row', 'Field', 'From statement (editable)', 'In your database', 'Status', ''].map(h => (
                      <th key={h} className="table-header whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {rows.map(row => {
                    const off = skipped.has(row.sourceRow)
                    const db = row.policy
                    return (
                      <tr key={row.sourceRow} className={off ? 'opacity-40 align-top' : 'align-top'}>
                        <td className="table-cell text-gray-400">{row.sourceRow}</td>
                        <td className="table-cell">
                          <Field>Policy</Field><Field>Client</Field><Field>Insurer</Field>
                          <Field>Premium</Field><Field>Commission</Field>
                        </td>
                        <td className="table-cell w-[26%] min-w-[190px]">
                          <Cell value={row.policyNumber} mono
                                onChange={v => edit(row.sourceRow, 'policyNumber', v)} />
                          <Cell value={row.clientName}
                                onChange={v => edit(row.sourceRow, 'clientName', v)} />
                          <Cell value={row.insurer || insurer}
                                onChange={v => edit(row.sourceRow, 'insurer', v)} />
                          <Cell value={row.premium} numeric
                                onChange={v => edit(row.sourceRow, 'premium', Number(v) || 0)} />
                          <Cell value={row.commissionAmount} numeric
                                onChange={v => edit(row.sourceRow, 'commissionAmount', Number(v) || 0)} />
                        </td>
                        <td className="table-cell w-[26%] min-w-[190px]">
                          <Val mono match={db && sameish(db.policyNumber, row.policyNumber)}>{db?.policyNumber || '—'}</Val>
                          <Val match={db && sameish(db.clientName, row.clientName)}>{db?.clientName || '—'}</Val>
                          <Val match={db && sameish(db.insurer, row.insurer || insurer)}>{db?.insurer || '—'}</Val>
                          <Val match={db && Math.abs(Number(db.premium || 0) - row.premium) < 1}>
                            {db ? fmtCurrency(db.premium) : '—'}
                          </Val>
                          <Val>{db ? `${db.fyCommission || 0}% on file` : '—'}</Val>
                        </td>
                        <td className="table-cell">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[row.status]}`}>
                            {row.status}
                          </span>
                          <div className="mt-0.5 text-[11px] text-gray-500">{row.reason}</div>
                          {mode === 'multi' && row.insurer && (
                            <div className="mt-1 inline-block rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold dark:bg-slate-700">
                              {row.insurer}
                            </div>
                          )}
                          {row.businessType && (
                            <div className="mt-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                              {row.businessType}
                            </div>
                          )}
                          {row.commissionAmount < 0 && (
                            <div className="mt-0.5 text-[11px] font-semibold text-red-600">Reversal / negative</div>
                          )}
                        </td>
                        <td className="table-cell">
                          {db ? (
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
              Edit any value on the left to correct a mis-parse — rows re-match as you type.
              Rows with no matched policy are never saved. Everything posts against{' '}
              <strong>{month} {year}</strong>, and re-uploading the same statement is safe.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}

// The three stacked columns must share one row height or they drift apart.
const ROW = 'flex h-8 items-center'

function Field({ children }) {
  return <div className={`${ROW} text-[11px] font-bold uppercase tracking-wide text-gray-400`}>{children}</div>
}

function Val({ children, mono, match }) {
  const tone = match === undefined ? '' : match ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
  return <div className={`${ROW} truncate ${mono ? 'font-mono' : ''} ${tone}`}>{children}</div>
}

function Cell({ value, onChange, mono, numeric }) {
  return (
    <input
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      inputMode={numeric ? 'decimal' : undefined}
      className={`h-8 w-full rounded border border-transparent bg-transparent px-1 hover:border-slate-300 focus:border-blue-500 focus:bg-white focus:outline-none dark:focus:bg-slate-900 ${mono ? 'font-mono' : ''}`}
    />
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
