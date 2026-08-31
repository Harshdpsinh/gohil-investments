import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import Modal from '../ui/Modal'
import { addManualCommission, updateCommissionTransaction } from '../../firebase/commissionOps'
import { expectedCommission } from '../../utils/commissionReconcile'
import { fmtCurrency } from '../../utils/dateUtils'

export default function ManualCommissionModal({
  open, onClose, policies = [], user, onPosted, existing = null,
}) {
  const [policyId, setPolicyId] = useState(existing?.policyId || '')
  const [amount, setAmount] = useState(existing ? String(existing.netReceived ?? existing.receivedCommission ?? '') : '')
  const [tds, setTds] = useState(existing ? String(existing.tds || '') : '')
  const [gst, setGst] = useState(existing ? String(existing.gst || '') : '')
  const [payoutMonth, setPayoutMonth] = useState(existing?.payoutMonth || '')
  const [payoutDate, setPayoutDate] = useState(existing?.payoutDate || '')
  const [remarks, setRemarks] = useState(existing?.remarks || '')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')

  const policy = useMemo(
    () => policies.find(p => p.id === (existing?.policyId || policyId)) || null,
    [policies, policyId, existing]
  )
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return policies.slice(0, 8)
    return policies.filter(p =>
      (p.policyNumber || '').toLowerCase().includes(q)
      || (p.clientName || '').toLowerCase().includes(q)
      || (p.insurer || '').toLowerCase().includes(q)
    ).slice(0, 12)
  }, [policies, query])

  const expected = policy ? expectedCommission(policy) : 0
  const editing = Boolean(existing?.id)

  const save = async () => {
    setBusy(true)
    try {
      if (editing) {
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
      } else {
        if (!policy) throw new Error('Pick a policy first.')
        await addManualCommission(policy, {
          amount: Number(amount),
          tds: Number(tds) || 0,
          gst: Number(gst) || 0,
          payoutMonth: payoutMonth || payoutDate.slice(0, 7),
          payoutDate,
          remarks,
        }, { user })
        toast.success('Commission saved.')
      }
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
      title={editing ? 'Edit commission' : 'Add commission by hand'}
      subtitle={editing
        ? 'Change the posted amount after a statement was uploaded.'
        : 'Use this when there is no statement file. Future policies stay unpaid until you do this or import a file.'}
      footerContent={
        <>
          <button className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Save commission'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {!editing && (
          <label className="block">
            <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Policy</span>
            <input
              className="form-input mt-1"
              placeholder="Search policy no, client, insurer…"
              value={policy ? `${policy.policyNumber} · ${policy.clientName}` : query}
              onChange={e => { setPolicyId(''); setQuery(e.target.value) }}
            />
            {!policy && (
              <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-200 text-xs dark:border-slate-700">
                {matches.map(p => (
                  <li key={p.id}>
                    <button type="button" className="block w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => { setPolicyId(p.id); setQuery('') }}>
                      <span className="font-mono font-semibold">{p.policyNumber}</span>
                      <span className="text-gray-500"> · {p.clientName} · {p.insurer}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </label>
        )}
        {policy && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800">
            Expected from the rate on file: <strong>{fmtCurrency(expected)}</strong>
            {' · '}{policy.insurer} · {policy.policyType}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Received ₹ *</span>
            <input className="form-input mt-1" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
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
