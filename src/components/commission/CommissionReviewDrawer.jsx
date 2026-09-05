// Side panel to review one policy's commission and update the posted amount.
// Nothing is written until "Update this commission" is pressed.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import PortalOverlay from '../ui/PortalOverlay'
import AppIcon from '../ui/AppIcon'
import { addManualCommission, updateCommissionTransaction } from '../../firebase/commissionOps'
import { expectedCommission } from '../../utils/commissionReconcile'
import { commissionReviewPrompt, draftFromReview } from '../../utils/commissionReview'
import { fmtCurrency } from '../../utils/dateUtils'

const STATUS_LABEL = {
  received: 'Settled', short: 'Short paid', over: 'Overpaid',
  awaited: 'Not received', 'no-rate': 'No rate on file', 'not-due': 'Not due yet',
}

export default function CommissionReviewDrawer({
  open, onClose, row, policy, existing = null, user, onPosted,
}) {
  const [amount, setAmount] = useState('')
  const [tds, setTds] = useState('')
  const [gst, setGst] = useState('')
  const [payoutMonth, setPayoutMonth] = useState('')
  const [payoutDate, setPayoutDate] = useState('')
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !row) return
    const draft = draftFromReview({ row, existing })
    setAmount(draft.amount)
    setTds(draft.tds)
    setGst(draft.gst)
    setPayoutMonth(draft.payoutMonth)
    setPayoutDate(draft.payoutDate)
    setRemarks(draft.remarks)
  }, [open, row, existing])

  if (!open || !row) return null

  const prompt = commissionReviewPrompt(row.status)
  const expected = policy ? expectedCommission(policy) : row.expected
  const editing = Boolean(existing?.id)
  const received = Number(amount)
  const difference = Number.isFinite(received) ? received - expected : row.difference

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (!Number.isFinite(received)) throw new Error('Commission amount is required.')
      const payload = {
        receivedCommission: received,
        netReceived: received,
        tds: Number(tds) || 0,
        gst: Number(gst) || 0,
        expectedCommission: expected,
        difference: received - expected,
        payoutMonth: payoutMonth || payoutDate.slice(0, 7),
        payoutDate,
        remarks,
      }
      if (editing) {
        await updateCommissionTransaction(existing.id, payload)
        toast.success('Commission updated.')
      } else {
        if (!policy) throw new Error('This policy is not in the book, so it cannot be posted.')
        await addManualCommission(policy, {
          amount: received,
          tds: Number(tds) || 0,
          gst: Number(gst) || 0,
          payoutMonth: payload.payoutMonth,
          payoutDate,
          remarks,
        }, { user })
        toast.success('Commission saved.')
      }
      onPosted?.()
      onClose?.()
    } catch (err) {
      toast.error(err.message || 'Could not update commission.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PortalOverlay onClose={busy ? undefined : onClose} closeOnEscape={!busy} align="right">
      <div className="absolute inset-0 bg-slate-950/50" onClick={busy ? undefined : onClose} />
      <aside
        className="gi-modal relative z-10 flex h-full w-full max-w-md flex-col bg-white shadow-[-24px_0_80px_rgba(15,23,42,0.28)] dark:bg-slate-900"
        role="document"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-teal-700 dark:text-teal-300">Review commission</p>
            <h2 className="mt-0.5 truncate text-lg font-extrabold text-slate-950 dark:text-white">{row.clientName || '—'}</h2>
            <p className="font-mono text-xs text-slate-500">{row.policyNumber}</p>
          </div>
          <button
            type="button"
            onClick={busy ? undefined : onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800"
            aria-label="Close review"
          >
            <AppIcon name="x" size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className={`rounded-xl border p-3 ${prompt.needsUpdate
            ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
            : 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30'}`}
          >
            <p className={`text-sm font-extrabold ${prompt.needsUpdate ? 'text-amber-950 dark:text-amber-100' : 'text-emerald-900 dark:text-emerald-100'}`}>
              {prompt.title}
            </p>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{prompt.body}</p>
          </div>

          <dl className="grid grid-cols-2 gap-2 text-xs">
            <Fact label="Status" value={STATUS_LABEL[row.status] || row.status} />
            <Fact label="Company" value={row.insurer || '—'} />
            <Fact label="Expected" value={fmtCurrency(expected)} />
            <Fact label="Posted so far" value={fmtCurrency(row.received)} />
            <Fact
              label="Difference"
              value={fmtCurrency(difference)}
              tone={difference < 0 ? 'text-red-600 dark:text-red-400' : difference > 0 ? 'text-amber-600' : ''}
            />
            <Fact label="Premium" value={fmtCurrency(row.premium)} />
          </dl>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Received ₹ *</span>
              <input className="form-input mt-1" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Payout month</span>
              <input className="form-input mt-1" type="month" value={payoutMonth} onChange={e => setPayoutMonth(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Payout date</span>
              <input className="form-input mt-1" type="date" value={payoutDate} onChange={e => setPayoutDate(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-gray-600 dark:text-gray-300">TDS ₹</span>
              <input className="form-input mt-1" inputMode="decimal" value={tds} onChange={e => setTds(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-gray-600 dark:text-gray-300">GST ₹</span>
              <input className="form-input mt-1" inputMode="decimal" value={gst} onChange={e => setGst(e.target.value)} />
            </label>
            <label className="col-span-2 block">
              <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Notes</span>
              <input className="form-input mt-1" value={remarks} onChange={e => setRemarks(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-950/40">
          <button className="btn-primary w-full" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : editing ? 'Update this commission' : 'Save this commission'}
          </button>
          <button className="btn-secondary w-full" disabled={busy} onClick={onClose}>Close</button>
        </div>
      </aside>
    </PortalOverlay>
  )
}

function Fact({ label, value, tone = '' }) {
  return (
    <div className="rounded-lg border border-slate-200 px-2.5 py-2 dark:border-slate-700">
      <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`mt-0.5 font-semibold text-slate-900 dark:text-slate-100 ${tone}`}>{value}</dd>
    </div>
  )
}
