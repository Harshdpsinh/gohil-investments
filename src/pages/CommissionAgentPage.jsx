// src/pages/CommissionAgentPage.jsx
// ─────────────────────────────────────────────────────────────
// 🤖 Commission Agent — automated extraction + tiered commission.
//
// ISOLATED FEATURE. This page does NOT use or modify the flat-rate
// CommissionPage.jsx engine. It is its own route (/commission-agent),
// admin-only, with its own collections (commissionTiers, transactionLogs).
//
// Layout: input tabs (Paste / Excel / PDF / Image) → JSON result card
// with SUCCESS/REVIEW_REQUIRED badge → tier breakdown → WhatsApp
// preview Modal + optional Send button.
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth }             from '../hooks/useAuth'
import Modal                   from '../components/ui/Modal'
import ConfirmDialog           from '../components/ui/ConfirmDialog'
import toast                   from 'react-hot-toast'

import { subscribeTiers, saveTiers }                      from '../firebase/commissionTiers'
import { addTransactionLog }                              from '../firebase/transactionLogs'
import { parseImportFile }                                from '../utils/exportUtils'
import { fmtDate, fmtCurrency }                           from '../utils/dateUtils'

import { processTransaction }                             from '../utils/transactionProcessor'
import { ocrImage }                                       from '../utils/receiptOcr'
import { extractPdfText }                                 from '../utils/pdfExtract'
import {
  sendWhatsApp, getEvolutionConfig, saveEvolutionConfig,
  phoneToNumber,
} from '../utils/whatsappSender'

const TABS = [
  { id: 'paste',  label: '📋 Paste Text',  accept: null },
  { id: 'excel',  label: '📊 Excel/CSV',   accept: '.xlsx,.xls,.csv' },
  { id: 'pdf',    label: '📄 PDF',         accept: '.pdf' },
  { id: 'image',  label: '🖼️ Image',       accept: 'image/*' },
]

export default function CommissionAgentPage() {
  const { isAdmin } = useAuth()

  const [tiers,        setTiers]        = useState([])
  const [tierDraft,    setTierDraft]    = useState([])
  const [tierDirty,    setTierDirty]    = useState(false)
  const [savingTiers,  setSavingTiers]  = useState(false)

  const [tab,          setTab]          = useState('paste')
  const [text,         setText]         = useState('')
  const [rows,         setRows]         = useState([])
  const [fileName,     setFileName]     = useState('')
  const [processing,   setProcessing]   = useState(false)
  const [result,       setResult]       = useState(null)

  const [waModalOpen,  setWaModalOpen]  = useState(false)
  const [tierModal,    setTierModal]    = useState(false)
  const [cfgModal,     setCfgModal]     = useState(false)
  const [sending,      setSending]      = useState(false)

  const fileRef = useRef(null)

  // ── Load tiers realtime ──
  useEffect(() => {
    const unsub = subscribeTiers((t) => {
      setTiers(t)
      setTierDraft(t)
    })
    return unsub
  }, [])

  if (!isAdmin) return (
    <div className="p-8 text-center">
      <p className="text-2xl mb-2">🔒</p>
      <p className="text-gray-600 dark:text-gray-400 font-medium">Commission Agent is restricted to administrators only.</p>
    </div>
  )

  // ── File handling ──
  const onFilePicked = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)

    try {
      if (tab === 'excel') {
        const parsed = await parseImportFile(file)
        setRows(parsed)
        toast.success(`Loaded ${parsed.length} rows from ${file.name}`)
      } else if (tab === 'pdf') {
        setProcessing(true)
        const t = await extractPdfText(file)
        setText(t)
        setProcessing(false)
        toast.success(t ? `Extracted ${t.length} chars from PDF` : 'No text found in PDF')
      } else if (tab === 'image') {
        setProcessing(true)
        const t = await ocrImage(file)
        setText(t)
        setProcessing(false)
        toast.success(t ? `OCR extracted ${t.length} chars` : 'OCR found no text')
      }
    } catch (err) {
      setProcessing(false)
      toast.error('File read failed: ' + err.message)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // ── Process ──
  const handleProcess = useCallback(async () => {
    if (!tiers.length) { toast.error('No commission tiers configured'); return }

    let rawData
    if (tab === 'excel') {
      if (!rows.length) { toast.error('Load an Excel/CSV file first'); return }
      rawData = { rows }
    } else {
      if (!text.trim()) { toast.error('Paste or extract some text first'); return }
      rawData = { text }
    }

    setProcessing(true)
    try {
      const out = processTransaction({ sourceType: tab, rawData, tiers })
      setResult(out)
      if (out.status === 'SUCCESS') toast.success('✅ Transaction processed')
      else toast(`⚠️ Review required: ${out._flags.join(', ')}`, { icon: '⚠️' })
    } catch (err) {
      toast.error('Processing failed: ' + err.message)
    } finally {
      setProcessing(false)
    }
  }, [tab, text, rows, tiers])

  // ── Save to audit log ──
  const handleLog = async () => {
    if (!result) return
    try {
      await addTransactionLog(result)
      toast.success('Logged to transaction audit trail')
    } catch (err) {
      toast.error('Log save failed: ' + err.message)
    }
  }

  // ── Send WhatsApp ──
  const handleSendWhatsApp = async () => {
    if (!result?.transaction_details?.phone_number) {
      toast.error('No valid phone number to send to'); return
    }
    setSending(true)
    try {
      const number = phoneToNumber(result.transaction_details.phone_number)
      const res = await sendWhatsApp({
        number,
        text: result.whatsapp_reply_draft,
      })
      if (res.ok) {
        toast.success(`✅ WhatsApp sent! Message ID: ${res.messageId || '—'}`)
        setWaModalOpen(false)
      } else {
        toast.error(res.error || 'Send failed')
      }
    } finally {
      setSending(false)
    }
  }

  // ── Tier editing ──
  const onTierChange = (i, field, value) => {
    setTierDraft(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: value }
      return next
    })
    setTierDirty(true)
  }
  const addTier = () => {
    const last = tierDraft[tierDraft.length - 1]
    setTierDraft(prev => [...prev, {
      id:    `tier_${prev.length + 1}`,
      label: '',
      min:   last ? Number(last.max) || 0 : 0,
      max:   null,
      rate:  0.05,
    }])
    setTierDirty(true)
  }
  const removeTier = (i) => {
    setTierDraft(prev => prev.filter((_, idx) => idx !== i))
    setTierDirty(true)
  }
  const handleSaveTiers = async () => {
    setSavingTiers(true)
    try {
      await saveTiers(tierDraft)
      setTierDirty(false)
      toast.success('Tiers saved')
      setTierModal(false)
    } catch (err) {
      toast.error('Save failed: ' + err.message)
    } finally {
      setSavingTiers(false)
    }
  }

  const evolutionReady = !!getEvolutionConfig()?.baseUrl
  const phoneValid = !!result?.transaction_details?.phone_number

  // ─────────────────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🤖 Commission Agent</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Extract → tiered commission → WhatsApp reply. Independent of the flat-rate tracker.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setTierModal(true)} className="btn-secondary text-xs">⚙️ Tiers ({tiers.length})</button>
          <button onClick={() => setCfgModal(true)} className="btn-secondary text-xs">
            {evolutionReady ? '🟢 WhatsApp' : '⚪ WhatsApp'}
          </button>
        </div>
      </div>

      {/* Tier summary strip */}
      <div className="card p-3">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Active Commission Tiers</p>
        <div className="flex gap-2 flex-wrap">
          {tiers.map((t, i) => (
            <span key={t.id || i} className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-full font-medium">
              {t.label || `${t.min}–${t.max || '∞'}`} · {(Number(t.rate) * 100).toFixed(1)}%
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── INPUT PANEL ── */}
        <div className="card space-y-4">
          <div className="flex gap-1 flex-wrap">
            {TABS.map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setResult(null) }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
                        ${tab === t.id
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'paste' && (
            <div>
              <label className="form-label">Paste WhatsApp message / invoice text</label>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={10}
                placeholder={`e.g.\nName: Ramesh Shah\nMobile: +91 98765 43210\nDate: 15/07/2026\nGrand Total: ₹1,20,000\n1. Health Plan ... ₹80,000\n2. Term Rider ... ₹40,000`}
                className="form-input font-mono text-xs"
              />
            </div>
          )}

          {(tab === 'excel' || tab === 'pdf' || tab === 'image') && (
            <div>
              <input
                ref={fileRef}
                type="file"
                accept={TABS.find(t => t.id === tab)?.accept}
                onChange={onFilePicked}
                className="hidden"
              />
              <button onClick={() => fileRef.current?.click()}
                      className="w-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center hover:border-blue-400 transition-colors">
                <span className="text-3xl block mb-2">📁</span>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {fileName ? `Loaded: ${fileName}` : `Click to upload ${tab.toUpperCase()} file`}
                </p>
                {tab === 'excel' && rows.length > 0 && (
                  <p className="text-xs text-green-600 mt-1">{rows.length} rows ready</p>
                )}
                {(tab === 'pdf' || tab === 'image') && text && (
                  <p className="text-xs text-green-600 mt-1">{text.length} chars extracted</p>
                )}
              </button>
              {(tab === 'pdf' || tab === 'image') && text && (
                <details className="mt-2">
                  <summary className="text-xs text-gray-500 cursor-pointer">View extracted text</summary>
                  <pre className="text-xs bg-gray-50 dark:bg-gray-700/50 p-2 rounded mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{text}</pre>
                </details>
              )}
            </div>
          )}

          <button onClick={handleProcess} disabled={processing}
                  className="btn-primary w-full">
            {processing ? '⏳ Processing…' : '⚡ Process Transaction'}
          </button>
        </div>

        {/* ── RESULT PANEL ── */}
        <div className="card space-y-4">
          {!result ? (
            <div className="text-center py-16 text-gray-400 dark:text-gray-500">
              <p className="text-3xl mb-2">🤖</p>
              <p className="text-sm">Process a transaction to see the validated JSON output here.</p>
            </div>
          ) : (
            <>
              {/* Status badge */}
              <div className="flex items-center justify-between">
                <span className={`text-xs font-bold px-3 py-1 rounded-full
                  ${result.status === 'SUCCESS'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'}`}>
                  {result.status === 'SUCCESS' ? '✅ SUCCESS' : '⚠️ REVIEW_REQUIRED'}
                </span>
                <span className="text-xs text-gray-400">source: {result._source}</span>
              </div>

              {/* Transaction details */}
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 space-y-1 text-sm">
                <Detail label="Customer" value={result.transaction_details.customer_name} />
                <Detail label="Phone"    value={result.transaction_details.phone_number} />
                <Detail label="Date"     value={fmtDate(result.transaction_details.date)} />
                <Detail label="Gross"    value={result.transaction_details.gross_amount !== null ? fmtCurrency(result.transaction_details.gross_amount) : null} />
                {result.transaction_details.items_parsed?.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mt-2">Items</p>
                    <ul className="text-xs list-disc list-inside text-gray-700 dark:text-gray-300">
                      {result.transaction_details.items_parsed.map((it, i) => <li key={i}>{it}</li>)}
                    </ul>
                  </div>
                )}
                {result._flags.length > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                    ⚠ Missing/unverified: {result._flags.join(', ')}
                  </p>
                )}
              </div>

              {/* Commission breakdown */}
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3">
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-2">Commission Breakdown</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                  Tier: <strong>{result.commission_breakdown.tier_applied}</strong>
                </p>
                {result.commission_breakdown._raw_steps?.map((s, i) => (
                  <div key={i} className="text-xs flex justify-between py-0.5 border-t border-blue-100 dark:border-blue-800">
                    <span className="text-gray-600 dark:text-gray-400">
                      {s.label}: ₹{s.bandAmount.toLocaleString('en-IN')} × {(s.rate * 100).toFixed(2)}%
                    </span>
                    <span className="font-semibold text-blue-700 dark:text-blue-300">
                      ₹{s.commission.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 mt-1 border-t-2 border-blue-200 dark:border-blue-700">
                  <span className="text-sm font-bold text-gray-800 dark:text-white">Total Commission</span>
                  <span className="text-sm font-bold text-blue-700 dark:text-blue-300">
                    {fmtCurrency(result.commission_breakdown.total_commission)}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setWaModalOpen(true)} className="btn-success text-xs flex-1">📱 WhatsApp Reply</button>
                <button onClick={handleLog} className="btn-secondary text-xs">📝 Log</button>
                <button
                  onClick={() => navigator.clipboard.writeText(JSON.stringify(result, null, 2)).then(() => toast.success('JSON copied'))}
                  className="btn-secondary text-xs">⧉ JSON</button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── WHATSAPP PREVIEW MODAL ── */}
      <Modal open={waModalOpen} onClose={() => setWaModalOpen(false)} title="📱 WhatsApp Reply Draft" size="md">
        {result && (
          <div className="space-y-4">
            <pre className="text-xs bg-green-50 dark:bg-green-900/20 text-gray-800 dark:text-gray-200 p-3 rounded-xl whitespace-pre-wrap font-sans">
{result.whatsapp_reply_draft}
            </pre>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleSendWhatsApp}
                disabled={!phoneValid || sending}
                className="btn-success disabled:opacity-50">
                {sending ? '⏳ Sending…' : !phoneValid ? 'No valid phone' : '🚀 Send via Evolution API'}
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(result.whatsapp_reply_draft)
                  toast.success('Draft copied — paste in WhatsApp manually')
                }}
                className="btn-secondary">
                ⧉ Copy draft manually
              </button>
              {!evolutionReady && (
                <p className="text-xs text-gray-400 text-center">
                  Evolution API not configured. Click ⚪ WhatsApp in the header to set it up for direct sending.
                </p>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ── TIER EDITOR MODAL ── */}
      <Modal open={tierModal} onClose={() => setTierModal(false)} title="⚙️ Commission Tiers" size="lg">
        <div className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Split transactions across bands. The top tier can have a blank/∞ max. Rates are fractions (0.04 = 4%).
          </p>
          {tierDraft.map((t, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input value={t.label} onChange={e => onTierChange(i, 'label', e.target.value)}
                     placeholder="Label" className="form-input text-xs col-span-4" />
              <input type="number" value={t.min} onChange={e => onTierChange(i, 'min', e.target.value)}
                     placeholder="Min" className="form-input text-xs col-span-2" />
              <input type="number" value={t.max ?? ''} onChange={e => onTierChange(i, 'max', e.target.value)}
                     placeholder="Max (∞)" className="form-input text-xs col-span-2" />
              <input type="number" step="0.001" value={t.rate} onChange={e => onTierChange(i, 'rate', e.target.value)}
                     placeholder="Rate" className="form-input text-xs col-span-3" />
              <button onClick={() => removeTier(i)} className="text-red-500 hover:text-red-700 col-span-1">✕</button>
            </div>
          ))}
          <button onClick={addTier} className="btn-secondary text-xs">+ Add tier</button>
          <div className="flex gap-2 pt-2">
            <button onClick={handleSaveTiers} disabled={!tierDirty || savingTiers} className="btn-primary flex-1">
              {savingTiers ? '⏳ Saving…' : '💾 Save Tiers'}
            </button>
            <button onClick={() => setTierModal(false)} className="btn-secondary">Close</button>
          </div>
        </div>
      </Modal>

      {/* ── EVOLUTION API CONFIG MODAL ── */}
      <EvolutionConfigModal open={cfgModal} onClose={() => setCfgModal(false)} />
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────
function Detail({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-xs text-gray-400">{label}</span>
      <span className={`text-sm font-medium ${value ? 'text-gray-800 dark:text-gray-200' : 'text-amber-500'}`}>
        {value || '— missing —'}
      </span>
    </div>
  )
}

function EvolutionConfigModal({ open, onClose }) {
  const existing = getEvolutionConfig()
  const [cfg, setCfg] = useState({
    baseUrl:      existing?.baseUrl      || 'http://localhost:8080',
    instanceName: existing?.instanceName || existing?.sessionId || 'default',
    apiKey:    existing?.apiKey    || '',
  })
  const set = (k, v) => setCfg(p => ({ ...p, [k]: v }))
  const save = () => {
    saveEvolutionConfig(cfg)
    toast.success('WhatsApp config saved (browser only)')
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="WhatsApp (Evolution API) Settings" size="md">
      <div className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Stored in this browser only — never sent to Firestore or committed to git.
          Use the API key and instance name from your Evolution API server.
        </p>
        <div>
          <label className="form-label">Base URL</label>
          <input value={cfg.baseUrl} onChange={e => set('baseUrl', e.target.value)} className="form-input" placeholder="http://localhost:8080" />
        </div>
        <div>
          <label className="form-label">Instance Name</label>
          <input value={cfg.instanceName} onChange={e => set('instanceName', e.target.value)} className="form-input" placeholder="default" />
        </div>
        <div>
          <label className="form-label">API Key</label>
          <input value={cfg.apiKey} onChange={e => set('apiKey', e.target.value)} className="form-input" placeholder="AUTHENTICATION_API_KEY" />
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={save} className="btn-primary flex-1">💾 Save</button>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
        </div>
      </div>
    </Modal>
  )
}
