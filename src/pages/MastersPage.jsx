import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  addCommissionMaster,
  addSalesManager,
  addSubBroker,
  getAllCommissionMaster,
  getAllSalesManagers,
  getAllSubBrokers,
} from '../firebase/firestore'

const blankBroker = { name: '', mobile: '', email: '', commissionSharePct: '', notes: '' }
const blankManager = { name: '', mobile: '', email: '', targetPremium: '', targetPolicies: '', incentivePct: '', notes: '' }
const blankCommission = { insurer: '', product: '', insuranceType: '', policyYear: '1', businessType: 'fresh', premiumMin: '', premiumMax: '', commissionPct: '', rewardPct: '' }

function Card({ title, children }) {
  return <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">{title && <h2 className="font-bold text-gray-900 dark:text-white">{title}</h2>}{children}</section>
}

export default function MastersPage() {
  const [brokers, setBrokers] = useState([])
  const [managers, setManagers] = useState([])
  const [commission, setCommission] = useState([])
  const [brokerForm, setBrokerForm] = useState(blankBroker)
  const [managerForm, setManagerForm] = useState(blankManager)
  const [commissionForm, setCommissionForm] = useState(blankCommission)
  const [saving, setSaving] = useState('')

  const load = async () => {
    try {
      const [b, m, c] = await Promise.all([getAllSubBrokers(), getAllSalesManagers(), getAllCommissionMaster()])
      setBrokers(b)
      setManagers(m)
      setCommission(c)
    } catch (err) {
      toast.error(err.message || 'Could not load masters.')
    }
  }

  useEffect(() => { load() }, [])

  const commissionSummary = useMemo(() => {
    const active = commission.filter(c => c.active !== false)
    const avg = active.length ? active.reduce((s, c) => s + (Number(c.commissionPct) || 0), 0) / active.length : 0
    return { active: active.length, avg: avg.toFixed(2) }
  }, [commission])

  const saveBroker = async e => {
    e.preventDefault()
    setSaving('broker')
    try {
      await addSubBroker(brokerForm)
      setBrokerForm(blankBroker)
      await load()
      toast.success('Sub broker saved.')
    } catch (err) {
      toast.error(err.message || 'Could not save sub broker.')
    } finally {
      setSaving('')
    }
  }

  const saveManager = async e => {
    e.preventDefault()
    setSaving('manager')
    try {
      await addSalesManager(managerForm)
      setManagerForm(blankManager)
      await load()
      toast.success('Sales manager saved.')
    } catch (err) {
      toast.error(err.message || 'Could not save sales manager.')
    } finally {
      setSaving('')
    }
  }

  const saveCommission = async e => {
    e.preventDefault()
    setSaving('commission')
    try {
      await addCommissionMaster(commissionForm)
      setCommissionForm(blankCommission)
      await load()
      toast.success('Commission master saved.')
    } catch (err) {
      toast.error(err.message || 'Could not save commission master.')
    } finally {
      setSaving('')
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Master Setup</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Sub-brokers, sales managers, and commission rules used by reports and future automation.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="stat-card"><div><p className="text-xl font-bold">{brokers.length}</p><p className="text-xs text-gray-500">Sub Brokers</p></div></div>
        <div className="stat-card"><div><p className="text-xl font-bold">{managers.length}</p><p className="text-xs text-gray-500">Sales Managers</p></div></div>
        <div className="stat-card"><div><p className="text-xl font-bold">{commissionSummary.active}</p><p className="text-xs text-gray-500">Commission Rules</p></div></div>
        <div className="stat-card"><div><p className="text-xl font-bold">{commissionSummary.avg}%</p><p className="text-xs text-gray-500">Avg Commission</p></div></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="BA / Sub Broker">
          <form onSubmit={saveBroker} className="space-y-2">
            <input className="form-input" placeholder="Name *" value={brokerForm.name} onChange={e => setBrokerForm({ ...brokerForm, name: e.target.value })} />
            <input className="form-input" placeholder="Mobile" value={brokerForm.mobile} onChange={e => setBrokerForm({ ...brokerForm, mobile: e.target.value })} />
            <input className="form-input" placeholder="Email" value={brokerForm.email} onChange={e => setBrokerForm({ ...brokerForm, email: e.target.value })} />
            <input className="form-input" type="number" placeholder="Commission share %" value={brokerForm.commissionSharePct} onChange={e => setBrokerForm({ ...brokerForm, commissionSharePct: e.target.value })} />
            <textarea className="form-input" placeholder="Notes" value={brokerForm.notes} onChange={e => setBrokerForm({ ...brokerForm, notes: e.target.value })} />
            <button className="btn-primary w-full" disabled={saving === 'broker'}>{saving === 'broker' ? 'Saving...' : 'Save Sub Broker'}</button>
          </form>
          <div className="space-y-2 max-h-72 overflow-auto">
            {brokers.map(b => <div key={b.id} className="p-2 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm"><p className="font-semibold">{b.name}</p><p className="text-xs text-gray-500">{b.mobile || '-'} | Share {b.commissionSharePct || 0}%</p></div>)}
          </div>
        </Card>

        <Card title="SM / Sales Manager">
          <form onSubmit={saveManager} className="space-y-2">
            <input className="form-input" placeholder="Name *" value={managerForm.name} onChange={e => setManagerForm({ ...managerForm, name: e.target.value })} />
            <input className="form-input" placeholder="Mobile" value={managerForm.mobile} onChange={e => setManagerForm({ ...managerForm, mobile: e.target.value })} />
            <input className="form-input" placeholder="Email" value={managerForm.email} onChange={e => setManagerForm({ ...managerForm, email: e.target.value })} />
            <input className="form-input" type="number" placeholder="Target premium" value={managerForm.targetPremium} onChange={e => setManagerForm({ ...managerForm, targetPremium: e.target.value })} />
            <input className="form-input" type="number" placeholder="Target policies" value={managerForm.targetPolicies} onChange={e => setManagerForm({ ...managerForm, targetPolicies: e.target.value })} />
            <input className="form-input" type="number" placeholder="Incentive %" value={managerForm.incentivePct} onChange={e => setManagerForm({ ...managerForm, incentivePct: e.target.value })} />
            <button className="btn-primary w-full" disabled={saving === 'manager'}>{saving === 'manager' ? 'Saving...' : 'Save Sales Manager'}</button>
          </form>
          <div className="space-y-2 max-h-72 overflow-auto">
            {managers.map(m => <div key={m.id} className="p-2 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm"><p className="font-semibold">{m.name}</p><p className="text-xs text-gray-500">Target: {m.targetPolicies || 0} policies</p></div>)}
          </div>
        </Card>

        <Card title="Commission Master">
          <form onSubmit={saveCommission} className="space-y-2">
            <input className="form-input" placeholder="Insurer" value={commissionForm.insurer} onChange={e => setCommissionForm({ ...commissionForm, insurer: e.target.value })} />
            <input className="form-input" placeholder="Product / Plan" value={commissionForm.product} onChange={e => setCommissionForm({ ...commissionForm, product: e.target.value })} />
            <input className="form-input" placeholder="Insurance type" value={commissionForm.insuranceType} onChange={e => setCommissionForm({ ...commissionForm, insuranceType: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className="form-input" type="number" placeholder="Policy year" value={commissionForm.policyYear} onChange={e => setCommissionForm({ ...commissionForm, policyYear: e.target.value })} />
              <select className="form-input" value={commissionForm.businessType} onChange={e => setCommissionForm({ ...commissionForm, businessType: e.target.value })}><option>fresh</option><option>renewal</option></select>
              <input className="form-input" type="number" placeholder="Min premium" value={commissionForm.premiumMin} onChange={e => setCommissionForm({ ...commissionForm, premiumMin: e.target.value })} />
              <input className="form-input" type="number" placeholder="Max premium" value={commissionForm.premiumMax} onChange={e => setCommissionForm({ ...commissionForm, premiumMax: e.target.value })} />
              <input className="form-input" type="number" placeholder="Comm %" value={commissionForm.commissionPct} onChange={e => setCommissionForm({ ...commissionForm, commissionPct: e.target.value })} />
              <input className="form-input" type="number" placeholder="Reward %" value={commissionForm.rewardPct} onChange={e => setCommissionForm({ ...commissionForm, rewardPct: e.target.value })} />
            </div>
            <button className="btn-primary w-full" disabled={saving === 'commission'}>{saving === 'commission' ? 'Saving...' : 'Save Rule'}</button>
          </form>
          <div className="space-y-2 max-h-72 overflow-auto">
            {commission.map(c => <div key={c.id} className="p-2 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm"><p className="font-semibold">{c.insurer || 'Any insurer'} - {c.product || 'Any product'}</p><p className="text-xs text-gray-500">{c.insuranceType || 'All'} | {c.businessType} | {c.commissionPct || 0}%</p></div>)}
          </div>
        </Card>
      </div>
    </div>
  )
}
