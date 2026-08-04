// src/components/policies/PdfExtractReview.jsx
// Read a policy schedule PDF, show what was found beside what is already on
// record, and let the user commit it.
//
// Nothing is written from here. Confirming hands the values to PolicyForm,
// which already owns validation, client linking and saving — so an extracted
// policy goes through exactly the same checks as a hand-typed one. This is the
// same review-then-commit shape as the commission importer, and for the same
// reason: machine extraction is a typing aid, not an authority.
import { useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../ui/Modal'
import { extractPolicyFields, matchExtractedPolicy, buildFieldReview } from '../../utils/policyPdfExtract'
import { fmtCurrency } from '../../utils/dateUtils'

const LABEL = {
  policyNumber: 'Policy number', clientName: 'Client name', insurer: 'Insurer',
  policyType: 'Policy type', planName: 'Plan', premium: 'Premium',
  sumInsured: 'Sum insured', startDate: 'Start date', expiryDate: 'Expiry date',
  maturityDate: 'Maturity date', nominee: 'Nominee', registrationNo: 'Registration no',
}

// Red for nothing found, yellow for found-but-unsure — as specified.
const STATE = {
  missing:   { row: 'bg-red-50 dark:bg-red-950/30',      chip: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',       text: 'Not in PDF — type it in' },
  uncertain: { row: 'bg-amber-50 dark:bg-amber-950/30',  chip: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100', text: 'Unclear — please check' },
  conflict:  { row: 'bg-orange-50 dark:bg-orange-950/20', chip: 'bg-orange-100 text-orange-900 dark:bg-orange-900/50 dark:text-orange-100', text: 'Differs from record' },
  fill:      { row: '',                                   chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200', text: 'Will be filled in' },
  agree:     { row: '',                                   chip: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',  text: 'Already matches' },
}

const MONEY_FIELDS = new Set(['premium', 'sumInsured'])

export default function PdfExtractReview({ open, onClose, policies = [], onUse }) {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const [extracted, setExtracted] = useState(null)
  const [edits, setEdits] = useState({})

  const fields = useMemo(
    () => (extracted ? { ...extracted.fields, ...edits } : {}),
    [extracted, edits]
  )

  // Re-matches as the user corrects a value, so fixing a mistyped policy
  // number immediately flips "create" to "update".
  const match = useMemo(
    () => (extracted ? matchExtractedPolicy(fields, policies) : null),
    [extracted, fields, policies]
  )

  const rows = useMemo(() => {
    if (!extracted) return []
    return buildFieldReview({ fields, status: extracted.status }, match?.policy || null)
  }, [extracted, fields, match])

  const reset = () => {
    setExtracted(null); setEdits({}); setFileName('')
    if (fileRef.current) fileRef.current.value = ''
  }

  const closeAll = () => { reset(); onClose() }

  const handleFile = async file => {
    if (!file) return
    if (!/\.pdf$/i.test(file.name)) { toast.error('Please choose a PDF policy schedule.'); return }
    setBusy(true)
    try {
      // pdfjs is ~330KB — loaded only when someone actually reads a PDF.
      const { extractLines } = await import('../../utils/pdfStatement')
      const pages = await extractLines(await file.arrayBuffer())
      const result = extractPolicyFields(pages)
      if (!result.found.length) {
        toast.error('Nothing readable found. This may be a scanned PDF — those need typing in by hand.')
        setBusy(false)
        return
      }
      setExtracted(result)
      setEdits({})
      setFileName(file.name)
    } catch (err) {
      toast.error(err.message || 'Could not read that PDF.')
      reset()
    } finally {
      setBusy(false)
    }
  }

  const use = () => {
    const cleaned = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => String(v ?? '').trim() !== '')
    )
    onUse({
      mode: match.action === 'update' ? 'edit' : 'add',
      policy: match.policy || null,
      fields: cleaned,
      fileName,
    })
    closeAll()
  }

  const counts = extracted && {
    filled: rows.filter(r => r.state === 'fill' || r.state === 'agree').length,
    check: rows.filter(r => r.state === 'uncertain' || r.state === 'conflict').length,
    blank: rows.filter(r => r.state === 'missing').length,
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : closeAll}
      title="Read details from a policy PDF"
      subtitle="Everything is checked against your records before anything is saved."
      size="xl"
      footerContent={
        <>
          <button className="btn-secondary" disabled={busy} onClick={closeAll}>Cancel</button>
          {extracted && (
            <button className="btn-primary" disabled={busy} onClick={use}>
              {match?.action === 'update' ? 'Fill in this policy' : 'Create policy from these details'}
            </button>
          )}
        </>
      }
    >
      {!extracted ? (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]) }}
          onClick={() => fileRef.current?.click()}
          className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
            dragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
              : 'border-slate-300 hover:border-blue-400 dark:border-slate-600'
          }`}
        >
          <input ref={fileRef} type="file" accept=".pdf" className="hidden"
                 onChange={e => handleFile(e.target.files?.[0])} />
          <p className="font-semibold text-gray-700 dark:text-gray-200">
            {busy ? 'Reading the policy…' : 'Drop the policy schedule here, or click to choose'}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Text PDFs only. A scanned or photographed policy cannot be read.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className={`rounded-xl border p-3 text-sm ${
            match.action === 'update' ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30'
              : match.action === 'review' ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
                : 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30'
          }`}>
            <p className="font-bold text-gray-900 dark:text-gray-100">
              {match.action === 'update' ? 'This policy is already on file'
                : match.action === 'review' ? 'Needs your judgement'
                  : 'No matching policy — this would be a new one'}
            </p>
            <p className="mt-0.5 text-gray-700 dark:text-gray-300">
              {match.reason}
              {match.policy && ` · ${match.policy.clientName || ''} ${match.policy.policyNumber}`}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <Tile label="Read cleanly" value={counts.filled} tone="text-emerald-600 dark:text-emerald-400" />
            <Tile label="Needs checking" value={counts.check} tone="text-amber-600 dark:text-amber-400" />
            <Tile label="Not in the PDF" value={counts.blank} tone="text-red-600 dark:text-red-400" />
          </div>

          <div className="max-h-[46vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                <tr>
                  {['Field', 'From the PDF (editable)', 'On record', ''].map(h => (
                    <th key={h} className="table-header whitespace-nowrap text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {rows.map(row => {
                  const style = STATE[row.state]
                  return (
                    <tr key={row.field} className={style.row}>
                      <td className="table-cell whitespace-nowrap font-semibold text-gray-700 dark:text-gray-200">
                        {LABEL[row.field] || row.field}
                      </td>
                      <td className="table-cell">
                        <input
                          value={fields[row.field] ?? ''}
                          onChange={e => setEdits(p => ({ ...p, [row.field]: e.target.value }))}
                          placeholder={row.state === 'missing' ? 'Type it in' : ''}
                          className="h-8 w-full min-w-[160px] rounded border border-transparent bg-transparent px-1 hover:border-slate-300 focus:border-blue-500 focus:bg-white focus:outline-none dark:focus:bg-slate-900"
                        />
                      </td>
                      <td className="table-cell whitespace-nowrap text-gray-500 dark:text-gray-400">
                        {row.dbValue
                          ? (MONEY_FIELDS.has(row.field) ? fmtCurrency(row.dbValue) : row.dbValue)
                          : '—'}
                      </td>
                      <td className="table-cell">
                        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.chip}`}>
                          {style.text}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Read from <strong>{fileName}</strong>. Red rows were not in the document and yellow rows
            could not be read confidently — fill those in above. Nothing is saved until you press
            the button below and then save the policy form.
          </p>
        </div>
      )}
    </Modal>
  )
}

function Tile({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-slate-200 p-2 dark:border-slate-700">
      <p className="text-[10px] font-bold tracking-wide text-gray-500">{label}</p>
      <p className={`text-lg font-extrabold ${tone}`}>{value}</p>
    </div>
  )
}
