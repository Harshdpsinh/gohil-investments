import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import DateInput from '../components/ui/DateInput'
import SearchBar from '../components/ui/SearchBar'
import { useClients } from '../hooks/useClients'
import { usePolicies } from '../hooks/usePolicies'
import { addEndorsement, getAllEndorsements, updateEndorsement } from '../firebase/firestore'
import { fmtDate } from '../utils/dateUtils'

const types = ['name correction', 'nominee change', 'address change', 'member addition/removal', 'vehicle change', 'sum insured change', 'contact update', 'other']
const statuses = ['requested', 'documents pending', 'submitted to insurer', 'approved', 'rejected', 'completed']

const blank = {
  policyId: '',
  clientId: '',
  type: 'other',
  status: 'requested',
  requestedDate: '',
  completedDate: '',
  notes: '',
}

export default function EndorsementsPage() {
  const { clients } = useClients()
  const { policies } = usePolicies()
  const [items, setItems] = useState([])
  const [form, setForm] = useState(blank)
  const [editingId, setEditingId] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('All')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      setItems(await getAllEndorsements())
    } catch (err) {
      toast.error(err.message || 'Could not load endorsements.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const selectedPolicy = policies.find(p => p.id === form.policyId)
  const selectedClient = clients.find(c => c.id === form.clientId) || clients.find(c => c.id === selectedPolicy?.clientId)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return items.filter(item => {
      const text = [item.clientName, item.policyNumber, item.type, item.status, item.notes].join(' ').toLowerCase()
      return (!q || text.includes(q)) && (status === 'All' || item.status === status)
    })
  }, [items, search, status])

  const save = async e => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const payload = {
        ...form,
        clientId: selectedClient?.id || form.clientId,
        clientName: selectedClient?.name || '',
        policyId: selectedPolicy?.id || form.policyId,
        policyNumber: selectedPolicy?.policyNumber || '',
      }
      if (editingId) {
        await updateEndorsement(editingId, payload)
        toast.success('Endorsement updated.')
      } else {
        await addEndorsement(payload)
        toast.success('Endorsement added.')
      }
      setForm(blank)
      setEditingId('')
      await load()
    } catch (err) {
      toast.error(err.message || 'Could not save endorsement.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Endorsements</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Track policy corrections, nominee changes, address changes, and insurer submissions.</p>
      </div>

      <form onSubmit={save} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select className="form-input" value={form.policyId} onChange={e => setForm({ ...form, policyId: e.target.value })}>
            <option value="">Select policy</option>
            {policies.map(p => <option key={p.id} value={p.id}>{p.policyNumber} - {p.clientName}</option>)}
          </select>
          <select className="form-input" value={form.clientId || selectedPolicy?.clientId || ''} onChange={e => setForm({ ...form, clientId: e.target.value })}>
            <option value="">Select client</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="form-input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
            {types.map(t => <option key={t}>{t}</option>)}
          </select>
          <select className="form-input" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            {statuses.map(s => <option key={s}>{s}</option>)}
          </select>
          <DateInput value={form.requestedDate} onChange={v => setForm({ ...form, requestedDate: v })} />
          <DateInput value={form.completedDate} onChange={v => setForm({ ...form, completedDate: v })} />
          <textarea className="form-input md:col-span-3 min-h-20" placeholder="Notes / insurer response / documents pending" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update Endorsement' : 'Add Endorsement'}</button>
          {editingId && <button type="button" className="btn-secondary" onClick={() => { setEditingId(''); setForm(blank) }}>Cancel</button>}
        </div>
      </form>

      <div className="flex flex-col sm:flex-row gap-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search endorsement..." />
        <select className="form-input sm:w-56" value={status} onChange={e => setStatus(e.target.value)}>
          <option>All</option>
          {statuses.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 z-10 text-xs uppercase text-gray-500">
            <tr><th className="px-4 py-3 text-left">Client</th><th className="px-4 py-3 text-left">Policy</th><th className="px-4 py-3 text-left">Type</th><th className="px-4 py-3 text-left">Requested</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Action</th></tr>
          </thead>
          <tbody>
            {loading ? <tr><td className="px-4 py-8 text-gray-400" colSpan="6">Loading endorsements...</td></tr> : filtered.map(item => (
              <tr key={item.id} className="border-t border-gray-100 dark:border-gray-700">
                <td className="px-4 py-3 font-semibold">{item.clientName || '-'}</td>
                <td className="px-4 py-3">{item.policyNumber || '-'}</td>
                <td className="px-4 py-3">{item.type}</td>
                <td className="px-4 py-3">{fmtDate(item.requestedDate)}</td>
                <td className="px-4 py-3"><span className="badge badge-blue">{item.status}</span></td>
                <td className="px-4 py-3"><button className="text-blue-600 font-semibold" onClick={() => { setEditingId(item.id); setForm({ ...blank, ...item }) }}>Edit</button></td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && <tr><td className="px-4 py-8 text-gray-400" colSpan="6">No endorsements found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
