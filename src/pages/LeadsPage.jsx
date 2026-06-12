import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import DateInput from '../components/ui/DateInput'
import SearchBar from '../components/ui/SearchBar'
import { addLead, updateLead, getAllLeads, addLeadFollowup, getLeadFollowups } from '../firebase/firestore'
import { fmtCurrency, fmtDate } from '../utils/dateUtils'

const blankLead = {
  name: '',
  mobile: '',
  email: '',
  source: '',
  leadType: '',
  insuranceNeed: '',
  assignedUserName: '',
  followUpDate: '',
  leadValue: '',
  status: 'new',
  lostReason: '',
  remarks: '',
}

const statuses = ['new', 'contacted', 'meeting scheduled', 'quotation sent', 'negotiation', 'converted', 'lost']

export default function LeadsPage() {
  const [leads, setLeads] = useState([])
  const [form, setForm] = useState(blankLead)
  const [editingId, setEditingId] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('All')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState(null)
  const [followups, setFollowups] = useState([])
  const [note, setNote] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      setLeads(await getAllLeads())
    } catch (err) {
      toast.error(err.message || 'Could not load leads.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return leads.filter(lead => {
      const text = [lead.name, lead.mobile, lead.email, lead.source, lead.insuranceNeed, lead.assignedUserName].join(' ').toLowerCase()
      return (!q || text.includes(q)) && (status === 'All' || lead.status === status)
    })
  }, [leads, search, status])

  const stats = useMemo(() => ({
    total: leads.length,
    open: leads.filter(l => !['converted', 'lost'].includes(l.status)).length,
    converted: leads.filter(l => l.status === 'converted').length,
    value: leads.reduce((sum, l) => sum + (Number(l.leadValue) || 0), 0),
  }), [leads])

  const save = async e => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      if (editingId) {
        await updateLead(editingId, form)
        toast.success('Lead updated.')
      } else {
        await addLead(form)
        toast.success('Lead added.')
      }
      setForm(blankLead)
      setEditingId('')
      await load()
    } catch (err) {
      toast.error(err.message || 'Could not save lead.')
    } finally {
      setSaving(false)
    }
  }

  const openTimeline = async lead => {
    setSelected(lead)
    setNote('')
    try {
      setFollowups(await getLeadFollowups(lead.id))
    } catch (err) {
      toast.error(err.message || 'Could not load follow-ups.')
    }
  }

  const addNote = async () => {
    if (!selected || !note.trim()) return
    try {
      await addLeadFollowup({ leadId: selected.id, type: 'note', note, nextFollowUpDate: selected.followUpDate })
      setNote('')
      setFollowups(await getLeadFollowups(selected.id))
      toast.success('Follow-up saved.')
    } catch (err) {
      toast.error(err.message || 'Could not save follow-up.')
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Lead Management</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Track enquiries, follow-ups, source, value, and conversion status.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="stat-card"><div><p className="text-xl font-bold">{stats.total}</p><p className="text-xs text-gray-500">Total Leads</p></div></div>
        <div className="stat-card"><div><p className="text-xl font-bold text-blue-600">{stats.open}</p><p className="text-xs text-gray-500">Open</p></div></div>
        <div className="stat-card"><div><p className="text-xl font-bold text-green-600">{stats.converted}</p><p className="text-xs text-gray-500">Converted</p></div></div>
        <div className="stat-card"><div><p className="text-xl font-bold text-purple-600">{fmtCurrency(stats.value)}</p><p className="text-xs text-gray-500">Pipeline Value</p></div></div>
      </div>

      <form onSubmit={save} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input className="form-input" placeholder="Lead name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input className="form-input" placeholder="Mobile" value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })} />
          <input className="form-input" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <input className="form-input" placeholder="Source" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} />
          <input className="form-input" placeholder="Insurance need" value={form.insuranceNeed} onChange={e => setForm({ ...form, insuranceNeed: e.target.value })} />
          <input className="form-input" placeholder="Lead type" value={form.leadType} onChange={e => setForm({ ...form, leadType: e.target.value })} />
          <input className="form-input" placeholder="Assigned to" value={form.assignedUserName} onChange={e => setForm({ ...form, assignedUserName: e.target.value })} />
          <DateInput value={form.followUpDate} onChange={v => setForm({ ...form, followUpDate: v })} />
          <input className="form-input" type="number" placeholder="Lead value" value={form.leadValue} onChange={e => setForm({ ...form, leadValue: e.target.value })} />
          <select className="form-input" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className="form-input md:col-span-2" placeholder="Remarks" value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update Lead' : 'Add Lead'}</button>
          {editingId && <button type="button" className="btn-secondary" onClick={() => { setForm(blankLead); setEditingId('') }}>Cancel</button>}
        </div>
      </form>

      <div className="flex flex-col sm:flex-row gap-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search lead, mobile, source..." />
        <select className="form-input sm:w-56" value={status} onChange={e => setStatus(e.target.value)}>
          <option>All</option>
          {statuses.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 z-10">
            <tr className="text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-3">Lead</th><th className="px-4 py-3">Need</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Follow-up</th><th className="px-4 py-3">Value</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-8 text-gray-400" colSpan="7">Loading leads...</td></tr>
            ) : filtered.map(lead => (
              <tr key={lead.id} className="border-t border-gray-100 dark:border-gray-700">
                <td className="px-4 py-3"><p className="font-semibold">{lead.name}</p><p className="text-xs text-gray-500">{lead.mobile || '-'} {lead.email ? `| ${lead.email}` : ''}</p></td>
                <td className="px-4 py-3">{lead.insuranceNeed || '-'}</td>
                <td className="px-4 py-3">{lead.source || '-'}</td>
                <td className="px-4 py-3">{fmtDate(lead.followUpDate)}</td>
                <td className="px-4 py-3">{fmtCurrency(lead.leadValue)}</td>
                <td className="px-4 py-3"><span className="badge badge-blue">{lead.status}</span></td>
                <td className="px-4 py-3 flex gap-2">
                  <button className="text-blue-600 font-semibold" onClick={() => { setEditingId(lead.id); setForm({ ...blankLead, ...lead }) }}>Edit</button>
                  <button className="text-purple-600 font-semibold" onClick={() => openTimeline(lead)}>Timeline</button>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && <tr><td className="px-4 py-8 text-gray-400" colSpan="7">No leads found.</td></tr>}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-xl w-full p-5 space-y-4">
            <div className="flex justify-between">
              <h2 className="font-bold text-lg">Lead Timeline - {selected.name}</h2>
              <button onClick={() => setSelected(null)} className="text-gray-400">Close</button>
            </div>
            <textarea className="form-input min-h-24" placeholder="Add follow-up note..." value={note} onChange={e => setNote(e.target.value)} />
            <button className="btn-primary" onClick={addNote}>Save Follow-up</button>
            <div className="space-y-2 max-h-64 overflow-auto">
              {followups.map(item => <div key={item.id} className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg text-sm"><p>{item.note}</p><p className="text-xs text-gray-500 mt-1">Next: {fmtDate(item.nextFollowUpDate)}</p></div>)}
              {followups.length === 0 && <p className="text-sm text-gray-400">No follow-ups yet.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
