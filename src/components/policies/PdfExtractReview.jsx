// src/components/policies/PdfExtractReview.jsx
// Read a policy schedule PDF, show what was found beside what is already on
// record, and let the user commit it.
//
// Nothing is written from here. Confirming hands the values to PolicyForm,
// which already owns validation, client linking and saving — so an extracted
// policy goes through exactly the same checks as a hand-typed one. This is the
// same review-then-commit shape as the commission importer, and for the same
// reason: machine extraction is a typing aid, not an authority.
import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../ui/Modal'
import {
  buildFieldReview, extractPolicyFields, fileFingerprint, findPdfDuplicate,
  markAllUncertain, matchExtractedClient, matchExtractedPolicy, splitExtractedFields,
} from '../../utils/policyPdfExtract'
import { fmtCurrency } from '../../utils/dateUtils'

const LABEL = {
  policyNumber: 'Policy number', clientName: 'Client name', insurer: 'Insurer',
  policyType: 'Policy type', planName: 'Plan', premium: 'Premium',
  sumInsured: 'Sum insured', startDate: 'Start date', expiryDate: 'Expiry date',
  maturityDate: 'Maturity date', nominee: 'Nominee', registrationNo: 'Registration no',
  mobile: 'Mobile', email: 'Email', dob: 'Date of birth', pan: 'PAN', address: 'Address',
}

const CLIENT_PLAN = {
  link:    { tone: 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30', title: 'Existing client — will be linked' },
  confirm: { tone: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30',        title: 'Is this the same person?' },
  choose:  { tone: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30',        title: 'Several clients could be this person' },
  create:  { tone: 'border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30',            title: 'New client — will be created' },
}

const STATE = {
  missing:   { row: 'bg-red-50 dark:bg-red-950/30',      chip: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',       text: 'Not in PDF — type it in' },
  uncertain: { row: 'bg-amber-50 dark:bg-amber-950/30',  chip: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100', text: 'Unclear — please check' },
  conflict:  { row: 'bg-orange-50 dark:bg-orange-950/20', chip: 'bg-orange-100 text-orange-900 dark:bg-orange-900/50 dark:text-orange-100', text: 'Differs from record' },
  fill:      { row: '',                                   chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200', text: 'Will be filled in' },
  agree:     { row: '',                                   chip: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',  text: 'Already matches' },
}

const MONEY_FIELDS = new Set(['premium', 'sumInsured'])
const NL = '\n'

export default function PdfExtractReview({ open, onClose, policies = [], clients = [], onUse }) {
  const fileRef = useRef(null)
  const previewRef = useRef('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [extracted, setExtracted] = useState(null)
  const [edits, setEdits] = useState({})
  const [clientChoice, setClientChoice] = useState(undefined)
  const [hash, setHash] = useState('')
  const [scanned, setScanned] = useState(null)
  const [ocrStatus, setOcrStatus] = useState('')
  const [seenLines, setSeenLines] = useState([])

  const duplicate = useMemo(() => findPdfDuplicate(hash, policies), [hash, policies])
  const seenText = useMemo(() => seenLines.slice(0, 120).join(NL), [seenLines])
  const fields = useMemo(() => (extracted ? { ...extracted.fields, ...edits } : {}), [extracted, edits])
  const match = useMemo(() => (extracted ? matchExtractedPolicy(fields, policies) : null), [extracted, fields, policies])
  const rows = useMemo(() => {
    if (!extracted) return []
    return buildFieldReview({ fields, status: extracted.status }, match?.policy || null)
  }, [extracted, fields, match])
  const clientMatch = useMemo(() => (extracted ? matchExtractedClient(fields, clients) : null), [extracted, fields, clients])
  const chosenClient = clientChoice === undefined ? clientMatch?.client || null : clientChoice
  const clientAction = clientChoice === undefined ? clientMatch?.action : (clientChoice ? 'link' : 'create')

  const dropPreview = () => {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current)
      previewRef.current = ''
    }
    setPreviewUrl('')
  }

  const attachPreview = nextFile => {
    dropPreview()
    if (!nextFile) return
    const url = URL.createObjectURL(nextFile)
    previewRef.current = url
    setPreviewUrl(url)
  }

  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
  }, [])

  const reset = () => {
    setExtracted(null); setEdits({}); setFileName(''); setFile(null)
    setClientChoice(undefined); setHash(''); setScanned(null); setOcrStatus(''); setSeenLines([])
    dropPreview()
    if (fileRef.current) fileRef.current.value = ''
  }

  const closeAll = () => { reset(); onClose() }

  const handleFile = async nextFile => {
    if (!nextFile) return
    if (!/\.pdf$/i.test(nextFile.name)) { toast.error('Please choose a PDF policy schedule.'); return }
    setBusy(true)
    try {
      const bytes = await nextFile.arrayBuffer()
      setHash(await fileFingerprint(bytes.slice(0)))
      const { extractLines } = await import('../../utils/pdfStatement')
      const pages = await extractLines(bytes.slice(0))
      setSeenLines(pages.flat().map(line => line.cells.map(c => c.text).join(' ')).filter(Boolean))
      const result = extractPolicyFields(pages)
      attachPreview(nextFile)
      if (!result.found.length) {
        setScanned(bytes)
        setFileName(nextFile.name)
        setFile(nextFile)
        setBusy(false)
        return
      }
      setScanned(null)
      setExtracted(result)
      setEdits({})
      setClientChoice(undefined)
      setFileName(nextFile.name)
      setFile(nextFile)
    } catch (err) {
      toast.error(err.message || 'Could not read that PDF.')
      reset()
    } finally {
      setBusy(false)
    }
  }

  const runOcr = async () => {
    if (!scanned) return
    setBusy(true)
    setOcrStatus('Downloading the reader (first time only)…')
    try {
      const { ocrPdfToLines } = await import('../../utils/pdfOcr')
      const pages = await ocrPdfToLines(scanned, {
        onProgress: ({ stage, page, pages: total }) =>
          setOcrStatus(stage === 'starting' ? 'Starting the reader…' : `Reading page ${page} of ${total}…`),
      })
      setSeenLines(pages.flat().map(line => line.cells.map(c => c.text).join(' ')).filter(Boolean))
      const result = extractPolicyFields(pages)
      if (!result.found.length) {
        toast.error('OCR could not find any policy details. This scan may be too faint — type it in by hand.')
        return
      }
      setExtracted(markAllUncertain(result))
      setScanned(null)
      toast.success('Read from the scan — please check every value.')
    } catch (err) {
      toast.error(err.message || 'Could not read the scan.')
    } finally {
      setBusy(false)
      setOcrStatus('')
    }
  }

  const use = () => {
    const { client: clientFields, policy: policyFields } = splitExtractedFields(fields)
    onUse({
      mode: match.action === 'update' ? 'edit' : 'add',
      policy: match.policy || null,
      fields: policyFields,
      hash,
      client: chosenClient,
      clientFields,
      createClient: clientAction === 'create',
      file,
      fileName,
    })
    closeAll()
  }

  const counts = extracted && {
    filled: rows.filter(r => r.state === 'fill' || r.state === 'agree').length,
    check: rows.filter(r => r.state === 'uncertain' || r.state === 'conflict').length,
    blank: rows.filter(r => r.state === 'missing').length,
  }

  const previewPane = previewUrl ? (
    <div className="pdf-extract-preview">
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">PDF preview</p>
      <iframe title="Policy PDF preview" src={previewUrl} className="pdf-extract-frame" />
    </div>
  ) : null

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
            <button
              className="btn-primary"
              disabled={busy || clientAction === 'choose'}
              onClick={use}
            >
              {clientAction === 'choose'
                ? 'Pick the client first'
                : match?.action === 'update'
                  ? 'Fill in this policy'
                  : clientAction === 'create'
                    ? 'Create client + policy'
                    : 'Create policy for this client'}
            </button>
          )}
        </>
      }
    >
      {duplicate && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950/30">
          <p className="font-bold text-red-900 dark:text-red-200">You have already filed this exact PDF</p>
          <p className="mt-0.5 text-red-800 dark:text-red-300">
            It is attached to policy <strong>{duplicate.policyNumber}</strong>
            {duplicate.clientName ? ` for ${duplicate.clientName}` : ''}. Carry on only if you
            genuinely mean to enter it a second time.
          </p>
        </div>
      )}

      {scanned ? (
        <div className="pdf-extract-split">
          {previewPane}
          <div className="rounded-2xl border-2 border-dashed border-amber-300 p-8 text-center dark:border-amber-700">
            <p className="font-semibold text-gray-800 dark:text-gray-100">
              {fileName} has no text in it — it is a scan or a photo
            </p>
            <p className="mx-auto mt-2 max-w-lg text-xs text-gray-600 dark:text-gray-300">
              It can still be read by OCR, which runs on this device. Nothing is uploaded anywhere
              and there is no charge, however many you read. The first run downloads about 10 MB,
              and each page takes a few seconds.
            </p>
            <p className="mx-auto mt-2 max-w-lg text-xs font-semibold text-amber-700 dark:text-amber-300">
              A scan is read far less reliably than a normal PDF — every value will be marked for
              checking, and you should check it.
            </p>
            <button className="btn-primary mt-4" disabled={busy} onClick={runOcr}>
              {busy ? (ocrStatus || 'Reading…') : 'Read it anyway with OCR'}
            </button>
            <button className="btn-secondary mt-2 block w-full sm:mt-4 sm:inline-block sm:w-auto" disabled={busy} onClick={reset}>
              Choose another file
            </button>
          </div>
        </div>
      ) : !extracted ? (
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
            A scan or photo can be read too — you will be offered OCR for it.
          </p>
        </div>
      ) : (
        <div className="pdf-extract-split">
          {previewPane}
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

          <div className={`rounded-xl border p-3 text-sm ${CLIENT_PLAN[clientAction]?.tone || ''}`}>
            <p className="font-bold text-gray-900 dark:text-gray-100">{CLIENT_PLAN[clientAction]?.title}</p>
            <p className="mt-0.5 text-gray-700 dark:text-gray-300">
              {clientChoice === undefined ? clientMatch.reason : 'You chose this yourself.'}
            </p>
            {chosenClient && (
              <p className="mt-2 font-semibold text-gray-900 dark:text-gray-100">
                {chosenClient.name}
                {chosenClient.mobile && <span className="font-normal text-gray-500"> · {chosenClient.mobile}</span>}
              </p>
            )}
            {clientAction === 'create' && (
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                A client will be created from the name, mobile, email, date of birth, PAN and
                address read below. Anything blank can be filled in later.
              </p>
            )}
            {(clientMatch.candidates?.length > 0 || clientAction === 'confirm') && (
              <div className="mt-3 flex flex-wrap gap-2">
                {(clientMatch.candidates || [clientMatch.client]).filter(Boolean).map(candidate => (
                  <button
                    key={candidate.id}
                    onClick={() => setClientChoice(candidate)}
                    className={`rounded-lg border px-2 py-1 text-xs font-semibold ${
                      chosenClient?.id === candidate.id
                        ? 'border-blue-500 bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    Yes — {candidate.name}{candidate.mobile ? ` · ${candidate.mobile}` : ''}
                  </button>
                ))}
                <button
                  onClick={() => setClientChoice(null)}
                  className={`rounded-lg border px-2 py-1 text-xs font-semibold ${
                    clientChoice === null
                      ? 'border-blue-500 bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}
                >
                  No — create a new client
                </button>
              </div>
            )}
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

          {seenLines.length > 0 && (
            <details className="rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-700">
              <summary className="cursor-pointer font-bold text-gray-700 dark:text-gray-200">
                What the reader actually saw in this PDF ({seenLines.length} lines)
              </summary>
              <p className="mt-2 text-gray-600 dark:text-gray-300">
                A field comes back empty when this carrier does not print the label we search for.
                Look below for the value you expected: if it is here but the row above is blank,
                the label is worded differently and we can teach the reader that wording. If it is
                not here at all, the PDF is a scan or the text is drawn as an image.
              </p>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-[10px] leading-relaxed dark:bg-slate-900">
{seenText}
              </pre>
            </details>
          )}

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Read from <strong>{fileName}</strong>. Red rows were not in the document and yellow rows
            could not be read confidently — fill those in above. Nothing is saved until you press
            the button below and then save the policy form.
          </p>
          </div>
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
