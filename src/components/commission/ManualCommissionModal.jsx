import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../ui/Modal'
import CommissionEntrySheet from './CommissionEntrySheet'
import { updateCommissionTransaction } from '../../firebase/commissionOps'
import { expectedCommission } from '../../utils/commissionReconcile'
import { validateCommissionAmount } from '../../utils/commissionTracker'
import { draftFromAmount, draftFromPct, pctFromAmount } from '../../utils/commissionEntry'
import { fmtCurrency } from '../../utils/dateUtils'

export default function ManualCommissionModal({
  open, onClose, policies = [], transactions = [], user, onPosted, existing = null,
}) {
  const editing = Boolean(existing?.id)
  const [amount, setAmount] = useState(existing ? String(existing.netReceived ?? existing.receivedCommission ?? '') : '')
  const [pct, setPct] = useState(() => {
    const premium = Number(policies.find(p => p.id === existing?.policyId)?.premium) || Number(existing?.premium) || 0
    const received = existing?.netReceived ?? existing?.receivedCommission
    return premium && received != null && received !== '' ? String(pctFromAmount(premium, received)) : ''
  })
  const [tds, setTds] = useState(existing ? String(existing.tds || '') : '')
  const [gst, setGst] = useState(existing ? String(existing.gst || '') : '')
  const [payoutMonth, setPayoutMonth] = useState(existing?.payoutMonth || '')
  const [payoutDate, setPayoutDate] = useState(existing?.payoutDate || '')
  const [remarks, setRemarks] = useState(existing?.remarks || '')
  const [busy, setBusy] = useState(false)

  const policy = useMemo(
    () => policies.find(p => p.id === existing?.policyId) || null,
    [policies, existing]
  )

  const expected = policy ? expectedCommission(policy) : 0
  const premium = Number(policy?.premium) || 0

  const onEditPct = value => {
    setPct(value)
    const next = draftFromPct(premium, value)
    if (next.amount) setAmount(next.amount)
  }

  const onEditAmount = value => {
    setAmount(value)
    const next = draftFromAmount(premium, value)
    if (!next.error) setPct(next.pct)
  }

  if (!editing) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        size="xl"
        title="Add commission by hand"
        subtitle="Only policies with a premium in this month, from the start date and end date on the policy. Change % or ₹ and the other follows."
      >
        <CommissionEntrySheet
          plain
          policies={policies}
          transactions={transactions}
          user={user}
          onPosted={onPosted}
        />
      </Modal>
    )
  }

  const save = async () => {
    const amountError = validateCommissionAmount(amount)
    if (amountError) {
      toast.error(amountError)
      return
    }
    setBusy(true)
    try {
      const received = Number(amount)
      if (!Number.isFinite(received)) throw new Error('Commission amount is required.')
      await updateCommissionTransaction(existing.id, {
        receivedCommission: received,
        netReceived: received,
        tds: Number(tds) || 0,
        gst: Number(gst) || 0,
        expectedCommission: expected,
        difference: received - expected,
        payoutMonth: payoutMonth || payoutDate.slice(0, 7),
        payoutDate,
        remarks,
      })
      toast.success('Commission updated.')
      onPosted?.()
      onClose()
    } catch (err) {
      toast.error(err.message || 'Could not save commission.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Edit commission"
      subtitle="Change the posted amount. The percentage follows the rupees, and the rupees follow the percentage."
      footerContent={
        <>
          <button className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {policy && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800">
            <span className="font-mono font-semibold">{policy.policyNumber}</span>
            {' · '}{policy.clientName}
            {' · '}Expected from the rate on file: <strong>{fmtCurrency(expected)}</strong>
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Commission %</span>
            <input className="form-input mt-1" inputMode="decimal" value={pct} onChange={e => onEditPct(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Received ₹ *</span>
            <input className="form-input mt-1" inputMode="decimal" value={amount} onChange={e => onEditAmount(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Payout month *</span>
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
    </Modal>
  )
}
