import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import DateInput from '../components/ui/DateInput'
import SearchBar from '../components/ui/SearchBar'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import AppIcon from '../components/ui/AppIcon'
import { useClients } from '../hooks/useClients'
import {
  addClient, addLead, updateLead, deleteLead, getAllLeads,
  addLeadFollowup, getLeadFollowups,
} from '../firebase/firestore'
import { fmtCurrency, fmtDate } from '../utils/dateUtils'

const blankLead = {
  name: '', mobile: '', email: '', source: '', leadType: '', insuranceNeed: '',
  assignedUserName: '', followUpDate: '', leadValue: '', status: 'new',
  lostReason: '', remarks: '',
}

const statuses = ['new', 'contacted', 'meeting scheduled', 'quotation sent', 'negotiation', 'converted', 'lost']
const statusStyle = {
  new: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200',
  contacted: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-200',
  'meeting scheduled': 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200',
  'quotation sent': 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200',
  negotiation: 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-200',
  converted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200',
  lost: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200',
}

function normaliseContact(value) {
  return String(value || '').replace(/\D/g, '').slice(-10)
}

export default function LeadsPage() {
  const navigate = useNavigate()
  const { clients } = useClients()
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
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [showDailyReminder, setShowDailyReminder] = useState(false)

  const load = async () => {
    setLoading(true)
    try { setLeads(await getAllLeads()) }
    catch (err) { toast.error(err.message || 'Could not load leads.') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const activeLeads = useMemo(
    () => leads.filter(lead => !['converted', 'lost'].includes(lead.status)),
    [leads]
  )

  useEffect(() => {
    if (loading || activeLeads.length === 0) return
    const today = new Date().toLocaleDateString('en-CA')
    if (localStorage.getItem('lead-reminder-dismissed-date') !== today) setShowDailyReminder(true)
  }, [loading, activeLeads.length])

  const dismissReminder = () => {
    localStorage.setItem('lead-reminder-dismissed-date', new Date().toLocaleDateString('en-CA'))
    setShowDailyReminder(false)
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return leads.filter(lead => {
      const text = [lead.name, lead.mobile, lead.email, lead.source, lead.insuranceNeed, lead.assignedUserName].join(' ').toLowerCase()
      return (!q || text.includes(q)) && (status === 'All' || lead.status === status)
    })
  }, [leads, search, status])

  const stats = useMemo(() => ({
    total: leads.length,
    open: activeLeads.length,
    converted: leads.filter(l => l.status === 'converted').length,
    value: activeLeads.reduce((sum, l) => sum + (Number(l.leadValue) || 0), 0),
  }), [leads, activeLeads])

  const save = async event => {
    event.preventDefault()
    if (saving || !form.name.trim()) return toast.error('Lead name is required.')
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
    } catch (err) { toast.error(err.message || 'Could not save lead.') }
    finally { setSaving(false) }
  }

  const directlyMakePolicy = async lead => {
    try {
      const mobile = normaliseContact(lead.mobile)
      let client = clients.find(item => (
        (mobile && normaliseContact(item.mobile) === mobile)
        || (lead.email && String(item.email || '').toLowerCase() === lead.email.toLowerCase())
        || String(item.name || '').trim().toLowerCase() === String(lead.name || '').trim().toLowerCase()
      ))
      if (!client) {
        const ref = await addClient({
          name: lead.name,
          mobile: lead.mobile || '',
          email: lead.email || '',
          kycStatus: 'Pending',
          notes: `Created from lead${lead.source ? ` (${lead.source})` : ''}.`,
        })
        client = { id: ref.id, name: lead.name, mobile: lead.mobile || '', email: lead.email || '' }
      }
      navigate('/policies', { state: { leadToPolicy: { ...lead, clientId: client.id, clientName: client.name } } })
    } catch (err) { toast.error(err.message || 'Could not prepare a policy for this lead.') }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteLead(deleteTarget.id)
      toast.success('Lead deleted.')
      setDeleteTarget(null)
      await load()
    } catch (err) { toast.error(err.message || 'Could not delete lead.') }
  }

  const openTimeline = async lead => {
    setSelected(lead)
    setNote('')
    try { setFollowups(await getLeadFollowups(lead.id)) }
    catch (err) { toast.error(err.message || 'Could not load follow-ups.') }
  }

  const addNote = async () => {
    if (!selected || !note.trim()) return
    try {
      await addLeadFollowup({ leadId: selected.id, type: 'note', note, nextFollowUpDate: selected.followUpDate })
      setNote('')
      setFollowups(await getLeadFollowups(selected.id))
      toast.success('Follow-up saved.')
    } catch (err) { toast.error(err.message || 'Could not save follow-up.') }
  }

  return (
    <div className="min-h-screen space-y-6 bg-gray-50 p-4 dark:bg-gray-900 sm:p-6 lg:p-8">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-950 dark:text-white"><AppIcon name="leads" size={24} /> Leads Dashboard</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">Move every enquiry from first contact to an issued policy.</p>
        </div>
        <button className="btn-primary" onClick={() => document.getElementById('lead-form')?.scrollIntoView({ behavior: 'smooth' })}><AppIcon name="plus" size={16} /> New Lead</button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Total Leads', stats.total, 'text-gray-950 dark:text-white'],
          ['Open Pipeline', stats.open, 'text-blue-700 dark:text-blue-300'],
          ['Converted', stats.converted, 'text-emerald-700 dark:text-emerald-300'],
          ['Pipeline Value', fmtCurrency(stats.value), 'text-violet-700 dark:text-violet-300'],
        ].map(([label, value, cls]) => <div className="stat-card" key={label}><div><p className={`text-xl font-bold ${cls}`}>{value}</p><p className="text-xs font-semibold text-gray-600 dark:text-gray-300">{label}</p></div></div>)}
      </div>

      <form id="lead-form" onSubmit={save} className="card space-y-4">
        <div className="flex items-center justify-between"><div><h2 className="font-bold text-gray-950 dark:text-white">{editingId ? 'Edit lead' : 'Capture a new lead'}</h2><p className="text-xs text-gray-600 dark:text-gray-300">Contact and follow-up information</p></div>{editingId && <button type="button" className="btn-secondary" onClick={() => { setForm(blankLead); setEditingId('') }}>Cancel edit</button>}</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <input className="form-input" placeholder="Lead name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          <input className="form-input" placeholder="Mobile" value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })} />
          <input className="form-input" type="email" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <input className="form-input" placeholder="Source" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} />
          <input className="form-input" placeholder="Insurance need" value={form.insuranceNeed} onChange={e => setForm({ ...form, insuranceNeed: e.target.value })} />
          <input className="form-input" placeholder="Lead type" value={form.leadType} onChange={e => setForm({ ...form, leadType: e.target.value })} />
          <input className="form-input" placeholder="Assigned to" value={form.assignedUserName} onChange={e => setForm({ ...form, assignedUserName: e.target.value })} />
          <DateInput value={form.followUpDate} onChange={value => setForm({ ...form, followUpDate: value })} />
          <input className="form-input" type="number" min="0" placeholder="Lead value" value={form.leadValue} onChange={e => setForm({ ...form, leadValue: e.target.value })} />
          <select className="form-select" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>{statuses.map(item => <option key={item} value={item}>{item}</option>)}</select>
          <input className="form-input md:col-span-2" placeholder="Remarks" value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} />
        </div>
        <button className="btn-primary" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Update Lead' : 'Add Lead'}</button>
      </form>

      <div className="flex flex-col gap-3 sm:flex-row">
        <SearchBar value={search} onChange={setSearch} placeholder="Search lead, mobile, source…" />
        <select className="form-select sm:w-56" value={status} onChange={e => setStatus(e.target.value)}><option>All</option>{statuses.map(item => <option key={item}>{item}</option>)}</select>
      </div>

      {loading ? <div className="card py-10 text-center text-gray-500">Loading leads…</div> : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {filtered.map(lead => (
            <article key={lead.id} className="card flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><h3 className="truncate text-base font-bold text-gray-950 dark:text-white">{lead.name}</h3><p className="text-sm text-gray-600 dark:text-gray-300">{lead.mobile || 'No mobile'}{lead.email ? ` · ${lead.email}` : ''}</p></div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${statusStyle[lead.status] || statusStyle.new}`}>{lead.status}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-800/80">
                <div><p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Insurance need</p><p className="font-semibold text-gray-900 dark:text-gray-100">{lead.insuranceNeed || 'Not specified'}</p></div>
                <div><p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Follow-up</p><p className="font-semibold text-gray-900 dark:text-gray-100">{fmtDate(lead.followUpDate)}</p></div>
                <div><p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Source</p><p className="font-semibold text-gray-900 dark:text-gray-100">{lead.source || 'Direct'}</p></div>
                <div><p className="text-xs font-semibold text-gray-500 dark:text-gray-400">Potential value</p><p className="font-semibold text-gray-900 dark:text-gray-100">{fmtCurrency(lead.leadValue)}</p></div>
              </div>
              <div className="flex flex-wrap gap-2">
                {!['converted', 'lost'].includes(lead.status) && <button className="btn-primary text-xs" onClick={() => directlyMakePolicy(lead)}><AppIcon name="policies" size={15} /> Directly Make Policy</button>}
                <button className="btn-secondary text-xs" onClick={() => { setEditingId(lead.id); setForm({ ...blankLead, ...lead }); document.getElementById('lead-form')?.scrollIntoView({ behavior: 'smooth' }) }}><AppIcon name="pencil" size={14} /> Edit</button>
                <button className="btn-secondary text-xs" onClick={() => openTimeline(lead)}><AppIcon name="history" size={14} /> Timeline</button>
                <button className="rounded-lg border border-red-300 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30" onClick={() => setDeleteTarget(lead)}><AppIcon name="trash" size={14} /> Delete Lead</button>
              </div>
            </article>
          ))}
          {filtered.length === 0 && <div className="card py-10 text-center text-gray-500 xl:col-span-2">No leads found.</div>}
        </div>
      )}

      {showDailyReminder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-800">
            <div className="flex items-start gap-3"><span className="rounded-xl bg-amber-100 p-3 text-amber-700 dark:bg-amber-950 dark:text-amber-300"><AppIcon name="warning" size={22} /></span><div><h2 className="text-lg font-bold text-gray-950 dark:text-white">Daily lead follow-up</h2><p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{activeLeads.length} lead{activeLeads.length === 1 ? '' : 's'} still need to be converted into policies.</p></div></div>
            <div className="my-4 max-h-52 space-y-2 overflow-auto">{activeLeads.slice(0, 10).map(lead => <div key={lead.id} className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900"><p className="font-semibold text-gray-900 dark:text-white">{lead.name}</p><p className="text-xs text-gray-500 dark:text-gray-400">{lead.insuranceNeed || 'Insurance enquiry'} · Follow-up {fmtDate(lead.followUpDate)}</p></div>)}</div>
            <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={dismissReminder}>Remind me tomorrow</button><button className="btn-primary" onClick={dismissReminder}>View leads</button></div>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-xl space-y-4 rounded-xl bg-white p-5 shadow-xl dark:bg-gray-800"><div className="flex justify-between"><h2 className="text-lg font-bold text-gray-950 dark:text-white">Lead Timeline — {selected.name}</h2><button onClick={() => setSelected(null)} className="text-gray-500 dark:text-gray-300">Close</button></div><textarea className="form-input min-h-24" placeholder="Add follow-up note…" value={note} onChange={e => setNote(e.target.value)} /><button className="btn-primary" onClick={addNote}>Save Follow-up</button><div className="max-h-64 space-y-2 overflow-auto">{followups.map(item => <div key={item.id} className="rounded-lg bg-gray-50 p-3 text-sm text-gray-900 dark:bg-gray-900 dark:text-gray-100"><p>{item.note}</p><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Next: {fmtDate(item.nextFollowUpDate)}</p></div>)}{followups.length === 0 && <p className="text-sm text-gray-500">No follow-ups yet.</p>}</div></div></div>
      )}

      <ConfirmDialog open={!!deleteTarget} title="Delete lead?" message={deleteTarget ? `${deleteTarget.name} will be removed from the active leads list.` : ''} danger onConfirm={confirmDelete} onClose={() => setDeleteTarget(null)} />
    </div>
  )
}
