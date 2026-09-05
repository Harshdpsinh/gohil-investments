// src/components/commission/StatementImportModal.jsx
// Upload a commission statement, verify every row against the policy book,
// then save. Nothing is written until "Verify & Save Records" is pressed.
import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../ui/Modal'
import { parseImportFile } from '../../utils/exportUtils'
import {
  assertTypedPolicyNumber,
  canPostAgainstPolicy,
  candidateMismatches,
  commissionRateField,
  legacyPostingKey,
  matchCandidates,
  matchClientCandidates,
  matchStatement,
  newPolicyDraft,
  normaliseStatement,
  postedAmounts,
  postingKey,
  summarise,
  isMaskedPolicyNumber,
} from '../../utils/commissionImport'
import { addClient, addCommissionTransaction, addPolicy, updatePolicy } from '../../firebase/firestore'
import { upsertCommissionMaster } from '../../firebase/commissionOps'
import { expectedCommission } from '../../utils/commissionReconcile'
import {
  canUpdateStructure,
  policyStructureStamp,
  proposeMasterUpsert,
} from '../../utils/commissionStructure'
import { fmtCurrency } from '../../utils/dateUtils'
import { insurerOptions } from '../../utils/insurers'
import { isStaleChunkError, reloadIfPageIsStale, reloadOnceForStaleChunk } from '../../utils/staleChunk'

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

export default function StatementImportModal({ open, onClose, policies, clients = [], user, onPosted }) {
  const fileRef = useRef(null)
  const [month, setMonth] = useState('')
  const [year, setYear] = useState(String(thisYear))
  const [mode, setMode] = useState('')            // 'single' | 'multi'
  const [insurer, setInsurer] = useState('')      // single-carrier only
  const [parsed, setParsed] = useState([])
  const [edits, setEdits] = useState({})          // sourceRow -> field overrides
  const [skipped, setSkipped] = useState(() => new Set())
  const [includedReview, setIncludedReview] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const [format, setFormat] = useState('')
  const [noDetail, setNoDetail] = useState(false)
  const [reviewing, setReviewing] = useState(null) // sourceRow
  const [postedRows, setPostedRows] = useState(() => new Set())

  // A tab left open across a deploy still has the old hashed pdfStatement URL.
  // Check the live page (and warm the parser) as soon as this sheet opens, so
  // a missing chunk reloads before a statement is dropped.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      if (await reloadIfPageIsStale()) return
      try {
        await import('../../utils/pdfStatement')
      } catch (err) {
        if (!cancelled) reloadOnceForStaleChunk(err)
      }
    })()
    return () => { cancelled = true }
  }, [open])

  // Every known carrier plus whatever the book already uses, deduped. It used
  // to list only insurers already on a policy, so a statement from a carrier
  // whose first policy had not been entered yet could not be imported at all.
  const carriers = useMemo(() => insurerOptions(policies.map(p => p.insurer)), [policies])

  // Gate: nothing may be uploaded until the statement is described.
  const ready = Boolean(month && year && mode && (mode === 'multi' || insurer))

  // Edits apply before matching, so correcting a policy number re-matches live.
  const rows = useMemo(() => {
    const applied = parsed.map(row => ({ ...row, ...(edits[row.sourceRow] || {}) }))
    return matchStatement(applied, policies, mode === 'single' ? insurer : '')
  }, [parsed, edits, policies, insurer, mode])

  const stats = useMemo(() => summarise(rows), [rows])
  const postable = rows.filter(r => {
    if (!r.policy || skipped.has(r.sourceRow) || postedRows.has(r.sourceRow)) return false
    if (r.status === 'matched') return true
    if (r.status === 'review') return includedReview.has(r.sourceRow)
    return false
  })
  const payoutMonth = month && year ? `${year}-${String(MONTHS.indexOf(month) + 1).padStart(2, '0')}` : ''
  const reviewRow = rows.find(r => r.sourceRow === reviewing) || null

  useEffect(() => {
    if (!rows.length) return
    if (reviewing && rows.some(r => r.sourceRow === reviewing)) return
    const next = rows.find(r => r.status === 'review' && !postedRows.has(r.sourceRow))
      || rows.find(r => !postedRows.has(r.sourceRow))
    setReviewing(next?.sourceRow ?? null)
  }, [rows, reviewing, postedRows])

  const reset = () => {
    setParsed([]); setEdits({}); setSkipped(new Set()); setIncludedReview(new Set())
    setFileName(''); setFormat(''); setNoDetail(false)
    setReviewing(null); setPostedRows(new Set())
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
      setIncludedReview(new Set())
      setEdits({})
      setPostedRows(new Set())
      setReviewing(null)
    } catch (err) {
      if (reloadOnceForStaleChunk(err)) return
      toast.error(
        isStaleChunkError(err)
          ? 'This page is out of date. Refresh, then drop the statement again.'
          : (err.message || 'Could not read that file.'),
      )
      reset()
    } finally {
      setBusy(false)
    }
  }

  const edit = (sourceRow, field, value) =>
    setEdits(prev => ({ ...prev, [sourceRow]: { ...(prev[sourceRow] || {}), [field]: value } }))

  const toggle = (sourceRow, status) => {
    if (status === 'review') {
      setIncludedReview(prev => {
        const next = new Set(prev)
        if (next.has(sourceRow)) next.delete(sourceRow)
        else next.add(sourceRow)
        return next
      })
      return
    }
    setSkipped(prev => {
      const next = new Set(prev)
      if (next.has(sourceRow)) next.delete(sourceRow)
      else next.add(sourceRow)
      return next
    })
  }

  const payloadFor = row => {
    const amounts = postedAmounts(row)
    const expected = expectedCommission(row.policy)
    return {
    policyId: row.policy.id,
    policyNumber: row.policy.policyNumber,
    clientId: row.policy.clientId || '',
    clientName: row.policy.clientName || row.clientName,
    insurer: row.insurer || insurer || row.policy.insurer || '',
    businessType: row.businessType || '',
    planName: row.planName || '',
    premium: row.premium || Number(row.policy.premium) || 0,
    receivedCommission: amounts.receivedCommission,
    netReceived: amounts.netReceived,
    expectedCommission: expected,
    difference: amounts.receivedCommission - expected,
    tds: amounts.tds,
    gst: row.gst || 0,
    payoutMonth,
    payoutDate: row.payoutDate || '',
    status: 'posted',
    postingKey: `${postingKey(row)}_${payoutMonth}`,
    legacyPostingKeys: [
      `${legacyPostingKey(row)}_${payoutMonth}`,
      legacyPostingKey(row),
    ],
    createdBy: user?.uid || '',
    createdByEmail: user?.email || '',
    remarks: `Imported from ${fileName} row ${row.sourceRow}`,
    ...(row._structure ? {
      structureUpdated: true,
      previousPct: row._structure.previousPct,
      newPct: row._structure.newPct,
      sourceFileName: fileName || '',
      structureUpdatedAt: row._structure.structureUpdatedAt || new Date().toISOString(),
      structureUpdatedBy: user?.email || user?.uid || '',
    } : {}),
  }
  }

  const markPosted = sourceRow => {
    setPostedRows(prev => new Set(prev).add(sourceRow))
    const remaining = rows.filter(r => r.sourceRow !== sourceRow && r.status === 'review' && !postedRows.has(r.sourceRow))
    setReviewing(remaining[0]?.sourceRow ?? sourceRow)
  }

  const applyStructure = async (row, policy) => {
    const proposal = proposeMasterUpsert(row, policy, { sourceFileName: fileName, user })
    if (!proposal) {
      throw new Error('Cannot update structure without a bound policy and a statement rate.')
    }
    // Strip test-only guards before write
    const { guards, ...payload } = proposal.payload
    await upsertCommissionMaster({ ...proposal, payload })
    const stamp = policyStructureStamp({ ...proposal, payload }, { sourceFileName: fileName })
    await updatePolicy(policy.id, stamp)
    return { ...proposal, payload, stamp }
  }

  const updateStructureRow = async (row, policy) => {
    if (!policy?.id) {
      toast.error('Pick the matching policy, then update structure.')
      return
    }
    if (!canUpdateStructure(row, policy)) {
      toast.error('Structure update needs a matched or review-bound row with a rate.')
      return
    }
    const proposal = proposeMasterUpsert(row, policy, { sourceFileName: fileName, user })
    const year = proposal?.payload?.policyYear || 'FY'
    const msg = `Update commission structure for ${proposal.payload.insurer || 'carrier'} · ${proposal.payload.product || 'plan'} · ${year}?\n\n${proposal.previousPct}% → ${proposal.newPct}%\nSource: ${fileName || 'statement'}`
    if (!window.confirm(msg)) return
    setBusy(true)
    try {
      await applyStructure(row, policy)
      toast.success(`Structure updated (${year}: ${proposal.previousPct}% → ${proposal.newPct}%).`)
    } catch (err) {
      toast.error(err.message || 'Could not update commission structure.')
    } finally {
      setBusy(false)
    }
  }

  const okRow = async (row, policy, { updateStructure = false } = {}) => {
    if (!policy?.id) {
      toast.error('Pick the matching policy, then press OK.')
      return
    }
    if (!canPostAgainstPolicy(row, policy)) {
      toast.error('This is a different policy. Add it as new, or skip the row.')
      return
    }
    setEdits(prev => ({
      ...prev,
      [row.sourceRow]: {
        ...(prev[row.sourceRow] || {}),
        policyNumber: policy.policyNumber,
        clientName: policy.clientName,
      },
    }))
    const readyRow = { ...row, policy, policyNumber: policy.policyNumber, clientName: policy.clientName }
    if (updateStructure && canUpdateStructure(readyRow, policy)) {
      const proposal = proposeMasterUpsert(readyRow, policy, { sourceFileName: fileName, user })
      const year = proposal?.payload?.policyYear || 'FY'
      const msg = `Also update commission structure for ${proposal.payload.insurer || 'carrier'} · ${proposal.payload.product || 'plan'} · ${year}?\n\n${proposal.previousPct}% → ${proposal.newPct}%`
      if (!window.confirm(msg)) return
    }
    setBusy(true)
    try {
      let structureMeta = null
      if (updateStructure && canUpdateStructure(readyRow, policy)) {
        const applied = await applyStructure(readyRow, policy)
        structureMeta = {
          previousPct: applied.previousPct,
          newPct: applied.newPct,
          structureUpdatedAt: applied.stamp.structureUpdatedAt,
        }
      }
      const readyWithStructure = structureMeta
        ? { ...readyRow, _structure: structureMeta }
        : readyRow
      await addCommissionTransaction(payloadFor(readyWithStructure))
      markPosted(row.sourceRow)
      toast.success(structureMeta
        ? 'Commission + structure updated. Check Commission Tracker.'
        : 'Commission updated. You can check it on Commission Tracker.')
      onPosted?.()
    } catch (err) {
      if (err?.code === 'commission/duplicate-post') {
        markPosted(row.sourceRow)
        toast.success('Already in the commission book.')
      } else {
        toast.error(err.message || 'Could not update that commission.')
      }
    } finally {
      setBusy(false)
    }
  }

  const addPolicyAndPost = async (row, draft) => {
    let number
    try {
      number = assertTypedPolicyNumber(draft.policyNumber, row.policyNumber)
    } catch (err) {
      toast.error(err.message)
      return
    }
    setBusy(true)
    try {
      let clientId = draft.clientId
      let clientName = draft.clientName || row.clientName
      if (!clientId) {
        const created = await addClient({ name: clientName, kycStatus: 'Pending' })
        clientId = created.id
      }
      const payload = newPolicyDraft(row, {
        ...draft,
        policyNumber: number,
        clientId,
        clientName,
        insurer: row.insurer || insurer || draft.insurer,
      })
      const createdPolicy = await addPolicy(payload)
      const policy = { id: createdPolicy.id, ...payload }
      await addCommissionTransaction(payloadFor({ ...row, policy, policyNumber: number, clientName }))
      markPosted(row.sourceRow)
      toast.success('New policy added and commission posted. Check the policy book and Commission Tracker.')
      onPosted?.()
    } catch (err) {
      toast.error(err.message || 'Could not add that policy.')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!postable.length) return
    setBusy(true)
    let posted = 0, duplicates = 0, failed = 0

    for (const row of postable) {
      try {
        await addCommissionTransaction(payloadFor(row))
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
            {/* Free-type, not a fixed select: a carrier missing from the list
                must never block an import. Anything typed is kept verbatim. */}
            <input
              className="form-input mt-1"
              list="statement-carrier-options"
              value={insurer}
              disabled={mode !== 'single' || !!parsed.length}
              placeholder={mode === 'multi' ? 'Read from each row' : 'Type or select carrier…'}
              onChange={e => setInsurer(e.target.value)}
            />
            <datalist id="statement-carrier-options">
              {carriers.map(name => <option key={name} value={name} />)}
            </datalist>
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

            <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1 max-h-[44vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                  <tr>
                    {['Row', 'Field', 'From statement (editable)', 'In your database', 'Status', ''].map(h => (
                      <th key={h || 'actions'} className="table-header whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {rows.map(row => {
                    const reviewOn = row.status === 'review' && includedReview.has(row.sourceRow)
                    const off = skipped.has(row.sourceRow) || (row.status === 'review' && !reviewOn && !postedRows.has(row.sourceRow))
                    const db = row.policy
                    const saved = postedRows.has(row.sourceRow)
                    const active = reviewing === row.sourceRow
                    const rateField = db ? commissionRateField(db, row.businessType) : 'fyCommission'
                    const rateOnFile = db ? Number(db[rateField] || 0) : 0
                    return (
                      <tr
                        key={row.sourceRow}
                        className={`${off ? 'opacity-40' : ''} ${active ? 'bg-teal-50/80 dark:bg-teal-950/20' : ''} align-top cursor-pointer`}
                        onClick={() => setReviewing(row.sourceRow)}
                      >
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
                          <Val>{db ? `${rateOnFile}% ${rateField === 'ryCommission' ? 'RY' : 'FY'} on file` : '—'}</Val>
                        </td>
                        <td className="table-cell">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${saved ? STATUS_STYLE.matched : STATUS_STYLE[row.status]}`}>
                            {saved ? 'posted' : row.status}
                          </span>
                          <div className="mt-0.5 text-[11px] text-gray-500">{saved ? 'Updated in commission book' : row.reason}</div>
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
                          <button type="button" onClick={e => { e.stopPropagation(); setReviewing(row.sourceRow) }} className="block font-semibold text-teal-700 dark:text-teal-300">
                            Review
                          </button>
                          {!saved && (
                            <button type="button" onClick={e => { e.stopPropagation(); toggle(row.sourceRow, db ? row.status : '') }} className="mt-1 block font-semibold text-blue-600 dark:text-blue-400">
                              {row.status === 'review' && db
                                ? (reviewOn ? 'Skip' : 'Include')
                                : (skipped.has(row.sourceRow) ? 'Include' : 'Skip')}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <ImportRowReview
              row={reviewRow}
              policies={policies}
              clients={clients}
              defaultInsurer={insurer}
              posted={reviewRow ? postedRows.has(reviewRow.sourceRow) : false}
              skipped={reviewRow ? skipped.has(reviewRow.sourceRow) : false}
              busy={busy}
              onOk={okRow}
              onAddPolicy={addPolicyAndPost}
              onSkip={sourceRow => toggle(sourceRow, '')}
              onUpdateStructure={updateStructureRow}
            />
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Same policy (number or last-4 + name + premium) goes on that row.
              Same person, different number or premium — add as a new policy, do not park
              commission on their old one. Skip anything you do not want. Verify & Save
              only posts green matched rows (and review rows you Include). Everything
              posts against <strong>{month} {year}</strong>.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}

// The three stacked columns must share one row height or they drift apart.
const ROW = 'flex min-h-8 items-start py-0.5'

function Field({ children }) {
  return <div className={`${ROW} text-[11px] font-bold uppercase tracking-wide text-gray-400`}>{children}</div>
}

function Val({ children, mono, match }) {
  const tone = match === undefined ? '' : match ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
  return <div className={`${ROW} whitespace-normal break-words ${mono ? 'font-mono' : ''} ${tone}`}>{children}</div>
}

// `block` on the input is load-bearing: .table-cell sets white-space:nowrap, and
// an inline-block input inside it never line-breaks — all five then sit on one
// line and spill across the "In your database" and "Status" columns.
function Cell({ value, onChange, mono, numeric }) {
  return (
    <input
      value={value ?? ''}
      title={value ?? ''}
      onChange={e => onChange(e.target.value)}
      inputMode={numeric ? 'decimal' : undefined}
      className={`block min-h-8 w-full whitespace-normal break-words rounded border border-transparent bg-transparent px-1 hover:border-slate-300 focus:border-blue-500 focus:bg-white focus:outline-none dark:focus:bg-slate-900 ${mono ? 'font-mono' : ''}`}
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

function ImportRowReview({
  row, policies, clients = [], defaultInsurer, posted, skipped, busy,
  onOk, onAddPolicy, onSkip, onUpdateStructure,
}) {
  const [pickedId, setPickedId] = useState('')
  const [alsoStructure, setAlsoStructure] = useState(false)
  const [fullNumber, setFullNumber] = useState('')
  const [startDate, setStartDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [clientId, setClientId] = useState('')

  const candidates = useMemo(() => {
    if (!row) return []
    const hits = matchCandidates(row, policies)
    if (row.policy && !hits.some(p => p.id === row.policy.id)) return [row.policy, ...hits]
    return hits
  }, [row, policies])
  const clientHits = useMemo(
    () => (row ? matchClientCandidates(row, policies, clients) : []),
    [row, policies, clients],
  )

  useEffect(() => {
    if (!row) return
    setPickedId('')
    setAlsoStructure(false)
    const draft = newPolicyDraft(row, {})
    setFullNumber(isMaskedPolicyNumber(row.policyNumber) ? '' : (row.policyNumber || ''))
    setStartDate(draft.startDate)
    setExpiryDate(draft.expiryDate)
    setClientId(clientHits[0]?.clientId || '')
  }, [row, clientHits])

  const fit = candidates.find(p => canPostAgainstPolicy(row, p))
  const activeId = (pickedId && candidates.some(p => p.id === pickedId)) ? pickedId : (fit?.id || '')
  const picked = candidates.find(p => p.id === activeId) || null
  const pickedOk = picked ? canPostAgainstPolicy(row, picked) : false
  const pickedIssues = picked ? candidateMismatches(row, picked) : []
  const chosenClient = clientHits.find(c => c.clientId === clientId) || clientHits[0] || null
  const needsNewPolicy = !pickedOk

  return (
    <aside className="w-full shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40 lg:w-80">
      {!row ? (
        <p className="text-sm text-slate-500">Open a row to review it.</p>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-teal-700 dark:text-teal-300">Review this row</p>
            <p className="mt-1 text-sm font-extrabold break-words text-slate-950 dark:text-white">{row.clientName || '—'}</p>
            <p className="font-mono text-xs break-all text-slate-500">{row.policyNumber || 'no policy no.'}</p>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              {fmtCurrency(row.commissionAmount)} commission · premium {fmtCurrency(row.premium)}
              {row.insurer || defaultInsurer ? ` · ${row.insurer || defaultInsurer}` : ''}
            </p>
          </div>

          {posted ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
              Updated in the commission book. Check it on Commission Tracker.
            </p>
          ) : skipped ? (
            <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              Skipped — this row will not be saved.
            </p>
          ) : pickedOk ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100">
              Same policy — last-4, name and premium agree. OK posts commission here.
            </p>
          ) : (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              {clientHits.length
                ? 'This looks like a new policy for someone already in the book. Do not put commission on their old number. Add it, or skip.'
                : 'No matching policy. Add it as new, or skip this row.'}
            </p>
          )}

          {candidates.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-auto">
              {candidates.map(policy => {
                const issues = candidateMismatches(row, policy)
                const ok = canPostAgainstPolicy(row, policy)
                return (
                  <li key={policy.id}>
                    <label className={`flex cursor-pointer gap-2 rounded-lg border px-2.5 py-2 text-xs ${activeId === policy.id ? 'border-teal-500 bg-white dark:bg-slate-800' : 'border-transparent hover:bg-white/70 dark:hover:bg-slate-800/70'}`}>
                      <input
                        type="radio"
                        name={`import-review-${row.sourceRow}`}
                        checked={activeId === policy.id}
                        onChange={() => setPickedId(policy.id)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block break-words font-semibold">{policy.clientName}</span>
                        <span className="block font-mono text-[11px] break-all text-slate-500">{policy.policyNumber}</span>
                        <span className="block text-[11px] text-slate-500">
                          {policy.insurer} · premium {fmtCurrency(policy.premium)}
                        </span>
                        {issues.length > 0 && (
                          <span className="mt-0.5 block text-[11px] font-semibold text-red-600">
                            Different policy · {issues.join(' · ')}
                          </span>
                        )}
                        {ok && (
                          <span className="mt-0.5 block text-[11px] font-semibold text-emerald-700">Same policy</span>
                        )}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}

          {pickedOk && picked && canUpdateStructure(row, picked) && (
            <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={alsoStructure}
                disabled={busy || posted}
                onChange={e => setAlsoStructure(e.target.checked)}
              />
              <span>Also update commission structure (master rate for this insurer / plan / FY·RY)</span>
            </label>
          )}

          {pickedOk && (
            <button
              type="button"
              className="btn-primary w-full"
              disabled={busy || posted || skipped}
              onClick={() => onOk(row, picked, { updateStructure: alsoStructure })}
            >
              {busy ? 'Saving…' : posted ? 'Already updated' : alsoStructure ? 'OK · commission + structure' : 'OK · update this commission'}
            </button>
          )}

          {pickedOk && picked && canUpdateStructure(row, picked) && (
            <button
              type="button"
              className="btn-secondary w-full"
              disabled={busy}
              onClick={() => onUpdateStructure?.(row, picked)}
            >
              Update structure only
            </button>
          )}

          {needsNewPolicy && !posted && (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Add as new policy</p>
              {clientHits.length > 0 && (
                <label className="block text-xs">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Existing client</span>
                  <select
                    className="form-input mt-1"
                    value={clientId}
                    onChange={e => setClientId(e.target.value)}
                  >
                    {clientHits.map(c => (
                      <option key={c.clientId || c.clientName} value={c.clientId}>
                        {c.clientName}{c.samplePolicyNumber ? ` · existing ${c.samplePolicyNumber}` : ''}
                      </option>
                    ))}
                    <option value="">New client — create from this name</option>
                  </select>
                </label>
              )}
              <label className="block text-xs">
                <span className="font-semibold text-slate-600 dark:text-slate-300">Full policy number *</span>
                <input
                  className="form-input mt-1 font-mono"
                  value={fullNumber}
                  placeholder="Type the full number (not ************2955)"
                  onChange={e => setFullNumber(e.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Start</span>
                  <input type="date" className="form-input mt-1" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </label>
                <label className="block text-xs">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Expiry</span>
                  <input type="date" className="form-input mt-1" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
                </label>
              </div>
              <button
                type="button"
                className="btn-primary w-full"
                disabled={busy || skipped}
                onClick={() => onAddPolicy(row, {
                  policyNumber: fullNumber,
                  clientId: chosenClient?.clientId || clientId,
                  clientName: chosenClient?.clientName || row.clientName,
                  startDate,
                  expiryDate,
                  insurer: row.insurer || defaultInsurer,
                })}
              >
                {busy ? 'Saving…' : 'Add policy & post commission'}
              </button>
            </div>
          )}

          {!posted && (
            <button
              type="button"
              className="btn-secondary w-full"
              disabled={busy}
              onClick={() => onSkip(row.sourceRow)}
            >
              {skipped ? 'Undo skip' : 'Skip this row'}
            </button>
          )}
        </div>
      )}
    </aside>
  )
}
