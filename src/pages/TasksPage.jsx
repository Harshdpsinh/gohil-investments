// src/pages/TasksPage.jsx
import { useState, useMemo, useEffect } from 'react'
import { useClients }  from '../hooks/useClients'
import { usePolicies } from '../hooks/usePolicies'
import {
  subscribeTasks, addTask, updateTask, deleteTask,
  TASK_PRIORITIES, TASK_TYPES
} from '../firebase/firestore'
import Modal        from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { fmtDate, parseAnyDate } from '../utils/dateUtils'
import toast from 'react-hot-toast'
import { differenceInDays } from 'date-fns'

const PRIORITY_COLORS = {
  High:   'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
  Medium: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-200 border-yellow-200 dark:border-yellow-800',
  Low:    'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800',
}
const PRIORITY_ICONS = { High:'🔴', Medium:'🟡', Low:'🟢' }
const TYPE_ICONS = {
  'Call':'📞','Email':'✉️','Meeting':'🤝','Follow-up':'🔔',
  'Document Collection':'📄','Other':'📌'
}

function taskUrgency(dueDate) {
  if (!dueDate) return 'gray'
  const d_parsed = parseAnyDate(dueDate)
  if (!d_parsed) return 'gray'
  const d = differenceInDays(d_parsed, new Date())
  if (d < 0)  return 'overdue'
  if (d === 0) return 'today'
  if (d <= 3)  return 'soon'
  return 'upcoming'
}

const URGENCY_STYLES = {
  overdue:  'border-l-4 border-red-500 bg-red-50 dark:bg-red-900/20',
  today:    'border-l-4 border-orange-500 bg-orange-50 dark:bg-orange-900/20',
  soon:     'border-l-4 border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20',
  upcoming: 'border-l-4 border-blue-300 dark:border-blue-700',
  gray:     'border-l-4 border-gray-200 dark:border-gray-700',
}

const EMPTY_TASK = {
  title:'', type:'Call', priority:'Medium',
  clientId:'', clientName:'', policyId:'', policyNumber:'',
  dueDate:'', notes:'', done: false
}

// ── Task Form ─────────────────────────────────────────────────
function TaskForm({ initial, clients, policies, onSave, onCancel }) {
  const [form, setForm]   = useState({ ...EMPTY_TASK, ...(initial || {}) })
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setForm(p=>({...p,[k]:v}))

  const clientPolicies = useMemo(() =>
    policies.filter(p=>p.clientId===form.clientId),
    [policies,form.clientId]
  )

  const onClientChange = e => {
    const id = e.target.value
    const cl = clients.find(c=>c.id===id)
    set('clientId',   id)
    set('clientName', cl?.name||'')
    set('policyId','')
    set('policyNumber','')
  }
  const onPolicyChange = e => {
    const id = e.target.value
    const pol = policies.find(p=>p.id===id)
    set('policyId',     id)
    set('policyNumber', pol?.policyNumber||'')
  }

  const onSubmit = async () => {
    if (!form.title.trim()) { toast.error('Task title is required'); return }
    if (!form.dueDate)       { toast.error('Due date is required');   return }
    setSaving(true)
    try { await onSave(form) }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="form-label">Task / Title *</label>
        <input value={form.title} onChange={e=>set('title',e.target.value)} className="form-input" placeholder="e.g. Call Ramesh about renewal" autoFocus />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className="form-label">Task Type</label>
          <select value={form.type||''} onChange={e=>set('type',e.target.value)} className="form-select">
            {TASK_TYPES.map(t=><option key={t}>{t}</option>)}
          </select></div>
        <div><label className="form-label">Priority</label>
          <select value={form.priority||'Medium'} onChange={e=>set('priority',e.target.value)} className="form-select">
            {TASK_PRIORITIES.map(p=><option key={p}>{p}</option>)}
          </select></div>
        <div><label className="form-label">Due Date *</label>
          <input type="date" value={form.dueDate||''} onChange={e=>set('dueDate',e.target.value)} className="form-input" /></div>
        <div><label className="form-label">Client (optional)</label>
          <select value={form.clientId||''} onChange={onClientChange} className="form-select">
            <option value="">— No client —</option>
            {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        {form.clientId && (
          <div><label className="form-label">Linked Policy</label>
            <select value={form.policyId||''} onChange={onPolicyChange} className="form-select">
              <option value="">— No policy —</option>
              {clientPolicies.map(p=><option key={p.id} value={p.id}>{p.policyNumber} · {p.policyType}</option>)}
            </select></div>
        )}
      </div>
      <div><label className="form-label">Notes</label>
        <textarea rows={2} value={form.notes||''} onChange={e=>set('notes',e.target.value)} className="form-input" /></div>
      <div className="flex gap-3 pt-2">
        <button onClick={onSubmit} disabled={saving} className="btn-primary">{saving?'⏳ Saving…':'💾 Save Task'}</button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  )
}

// ── Task Card ─────────────────────────────────────────────────
function TaskCard({ task, onToggle, onEdit, onDelete, onWhatsApp }) {
  // urgency is precomputed in the filtered useMemo — no double parse here
  const urgency  = task._urgency || taskUrgency(task.dueDate)
  const daysLeft = task.dueDate
    ? (() => { const dp = parseAnyDate(task.dueDate); return dp ? differenceInDays(dp, new Date()) : null })()
    : null

  return (
    <div className={`rounded-xl p-4 border border-gray-100 dark:border-gray-700 shadow-sm dark:bg-gray-800 transition-opacity ${URGENCY_STYLES[urgency]} ${task.done ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <input type="checkbox" checked={!!task.done} onChange={()=>onToggle(task)}
                 className="w-5 h-5 mt-0.5 cursor-pointer flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className={`font-semibold text-gray-900 dark:text-white text-sm ${task.done?'line-through text-gray-400':''}`}>
              {TYPE_ICONS[task.type]||'📌'} {task.title}
            </p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${PRIORITY_COLORS[task.priority||'Medium']}`}>
                {PRIORITY_ICONS[task.priority||'Medium']} {task.priority||'Medium'}
              </span>
              <span className="text-xs text-gray-500">{task.type}</span>
              {task.clientName && <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">👤 {task.clientName}</span>}
              {task.policyNumber && <span className="text-xs text-gray-400 dark:text-gray-500">📋 {task.policyNumber}</span>}
            </div>
            {task.notes && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">{task.notes}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="text-right">
            <p className="text-xs font-semibold text-gray-600">{fmtDate(task.dueDate)}</p>
            <p className={`text-xs font-semibold ${
              urgency==='overdue' ? 'text-red-600' :
              urgency==='today'   ? 'text-orange-600' :
              urgency==='soon'    ? 'text-yellow-700' : 'text-gray-400'
            }`}>
              {daysLeft===null ? '—' :
               daysLeft<0     ? `${Math.abs(daysLeft)}d overdue` :
               daysLeft===0   ? 'Due today' :
               `${daysLeft}d left`}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <button onClick={()=>onEdit(task)}    className="px-2 py-1 text-xs bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-100">Edit</button>
            {task.clientId && onWhatsApp && <button onClick={()=>onWhatsApp(task)} className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600">📱</button>}
            <button onClick={()=>onDelete(task)}  className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded hover:bg-red-100">Del</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function TasksPage() {
  const { clients }  = useClients()
  const { policies } = usePolicies()
  const [tasks,    setTasks]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [filter,   setFilter]   = useState('Pending')  // 'All' | 'Pending' | 'Done' | 'Overdue' | 'Today'
  const [priorityF,setPriorityF]= useState('All')
  const [modal,    setModal]    = useState(null)
  const [selected, setSelected] = useState(null)
  const [delOpen,  setDelOpen]  = useState(false)

  useEffect(() => {
    const unsub = subscribeTasks(data => { setTasks(data); setLoading(false) })
    return unsub
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return tasks
      .map(t => ({ ...t, _urgency: taskUrgency(t.dueDate) }))  // precompute once per task
      .filter(t => {
        const mQ = !q || t.title?.toLowerCase().includes(q) || t.clientName?.toLowerCase().includes(q)
        const mF =
          filter==='All'     ? true :
          filter==='Pending' ? !t.done :
          filter==='Done'    ? !!t.done :
          filter==='Overdue' ? (!t.done && t._urgency==='overdue') :
          filter==='Today'   ? (!t.done && t._urgency==='today') : true
        const mP = priorityF==='All' || t.priority===priorityF
        return mQ && mF && mP
      })
  }, [tasks, search, filter, priorityF])

  const stats = useMemo(() => ({
    pending:  tasks.filter(t=>!t.done).length,
    today:    tasks.filter(t=>!t.done && taskUrgency(t.dueDate)==='today').length,
    overdue:  tasks.filter(t=>!t.done && taskUrgency(t.dueDate)==='overdue').length,
    done:     tasks.filter(t=>!!t.done).length,
  }), [tasks])

  const onToggle = async (task) => {
    try { await updateTask(task.id, { done: !task.done }); toast.success(task.done ? 'Task re-opened' : '✅ Task completed!') }
    catch(err) { toast.error('Failed to update task: ' + err.message) }
  }
  const onAdd    = async form => {
    try { await addTask(form);                 toast.success('Task added!');   setModal(null) }
    catch(err) { toast.error('Failed to add task: ' + err.message) }
  }
  const onEdit   = async form => {
    try { await updateTask(selected.id, form); toast.success('Task updated!'); setModal(null) }
    catch(err) { toast.error('Failed to update task: ' + err.message) }
  }
  const onDelete = async () => {
    try { await deleteTask(selected.id); toast.success('Task deleted'); setDelOpen(false) }
    catch(err) { toast.error('Failed to delete: ' + err.message) }
  }

  const openWhatsApp = (task) => {
    let client = clients.find(c => c.id === task.clientId)
    if (!client?.mobile && task.clientName) {
      client = clients.find(c => c.name.toLowerCase().trim() === (task.clientName||'').toLowerCase().trim())
    }
    const mobile = (client?.mobile||'').replace(/\D/g,'')
    if (!mobile) { toast.error('No mobile for ' + (task.clientName||'client') + ' — add it in Clients page'); return }
    const typeIcon = task.type === 'Call' ? '📞' : task.type === 'Meeting' ? '🤝' : '📋'
    const msg = encodeURIComponent(
      `Dear ${task.clientName},\n\n${typeIcon} This is a reminder regarding: *${task.title}*\n\nPlease feel free to contact us at your earliest convenience.\n\n*Gohil Investments*
Wealth Management & Insurance Advisory
📞 *Harshdipsinh Gohil* — 7698997894
📞 Pradipsinh Gohil — 9426204547
📍 Bhavnagar, Gujarat`
    )
    window.open(`https://wa.me/91${mobile}?text=${msg}`, '_blank')
  }

  if (loading) return (
    <div className="p-8 text-gray-400 dark:text-gray-500 flex items-center gap-2">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      Loading tasks…
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 bg-gray-50 dark:bg-gray-900 min-h-screen">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Tasks & Follow-ups</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{stats.pending} pending · {stats.overdue} overdue</p>
        </div>
        <button onClick={()=>{setSelected(null);setModal('add')}} className="btn-primary">+ New Task</button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:'Pending',  value:stats.pending, color:'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',   onClick:()=>setFilter('Pending') },
          { label:'Due Today',value:stats.today,   color:'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',onClick:()=>setFilter('Today')  },
          { label:'Overdue',  value:stats.overdue, color:'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300',     onClick:()=>setFilter('Overdue') },
          { label:'Completed',value:stats.done,    color:'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300', onClick:()=>setFilter('Done')    },
        ].map(s=>(
          <div key={s.label} onClick={s.onClick}
               className={`rounded-xl p-3 cursor-pointer ${s.color} hover:opacity-80 transition-opacity`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs font-medium mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
        <input type="search" placeholder="Search tasks, clients…"
               value={search} onChange={e=>setSearch(e.target.value)} className="form-input w-64" />
        <div className="flex gap-1 flex-wrap">
          {['All','Pending','Today','Overdue','Done'].map(f=>(
            <button key={f} onClick={()=>setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                filter===f?'bg-blue-600 text-white':'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}>{f}</button>
          ))}
        </div>
        <div className="flex gap-1 ml-auto">
          {['All',...TASK_PRIORITIES].map(p=>(
            <button key={p} onClick={()=>setPriorityF(p)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                priorityF===p?'bg-purple-600 text-white':'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}>{PRIORITY_ICONS[p]||''} {p}</button>
          ))}
        </div>
      </div>

      {/* Task cards */}
      <div className="space-y-2">
        {filtered.length === 0
          ? <div className="text-center py-12 text-gray-400 dark:text-gray-500">
              <p className="text-3xl mb-2">✅</p>
              <p>No tasks here. {filter==='Pending'&&'All caught up!'}</p>
            </div>
          : filtered.map(t=>(
            <TaskCard key={t.id} task={t}
              onToggle={onToggle}
              onEdit={t=>{ setSelected(t); setModal('edit') }}
              onDelete={t=>{ setSelected(t); setDelOpen(true) }}
              onWhatsApp={openWhatsApp}
            />
          ))
        }
      </div>

      <Modal open={modal==='add'} onClose={()=>setModal(null)} title="New Task" size="lg">
        <TaskForm clients={clients} policies={policies} onSave={onAdd} onCancel={()=>setModal(null)} />
      </Modal>
      <Modal open={modal==='edit'} onClose={()=>setModal(null)} title="Edit Task" size="lg">
        {selected&&<TaskForm initial={selected} clients={clients} policies={policies} onSave={onEdit} onCancel={()=>setModal(null)} />}
      </Modal>
      <ConfirmDialog open={delOpen} onClose={()=>setDelOpen(false)} onConfirm={onDelete}
                     title="Delete Task?" message={`Delete task "${selected?.title}"?`} danger />
    </div>
  )
}
