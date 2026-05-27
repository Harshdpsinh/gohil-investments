// src/pages/AdminUsersPage.jsx
// ✅ FIXED: A1 (role passed to createStaffAccount), A2 (role change confirmation)
import { useState, useEffect } from 'react'
import { useAuth }    from '../hooks/useAuth'
import { getAllUsers, setUserRole } from '../firebase/firestore'
import toast from 'react-hot-toast'

export default function AdminUsersPage() {
  // ✅ FIX A1: createStaffAccount must accept (email, password, name, role)
  //            Make sure your useAuth hook passes 'role' to Firebase user creation
  const { createStaffAccount, isAdmin } = useAuth()
  const [users,    setUsers]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form,     setForm]     = useState({ name: '', email: '', password: '', role: 'staff' })
  const [saving,   setSaving]   = useState(false)
  // ✅ FIX A2: role change confirmation state
  const [pendingRoleChange, setPendingRoleChange] = useState(null) // { uid, name, newRole }
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const load = async () => {
    if (!isAdmin) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const list = await getAllUsers()
      setUsers(list)
    } catch (err) {
      toast.error(err.message || 'Could not load user accounts.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [isAdmin])

  const onCreateUser = async e => {
    e.preventDefault()
    const cleanName = form.name.trim()
    const cleanEmail = form.email.trim().toLowerCase()
    if (!cleanName)  { toast.error('Name is required'); return }
    if (!cleanEmail) { toast.error('Email is required'); return }
    if (form.password.length < 8) { toast.error('Password must be at least 8 characters'); return }
    setSaving(true)
    try {
      // ✅ FIX A1: pass form.role as 4th argument
      await createStaffAccount(cleanEmail, form.password, cleanName, form.role)
      toast.success(`Account created for ${cleanName} (${form.role})`)
      setForm({ name: '', email: '', password: '', role: 'staff' })
      setShowForm(false)
      await load()
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') toast.error('Email already in use')
      else if (err.code === 'auth/weak-password')   toast.error('Password too weak (min 8 chars)')
      else toast.error(err.message)
    } finally { setSaving(false) }
  }

  // ✅ FIX A2: two-step role change with confirmation
  const onChangeRole = async () => {
    if (!pendingRoleChange) return
    const { uid, newRole } = pendingRoleChange
    try {
      await setUserRole(uid, { role: newRole })
      toast.success('Role updated')
      await load()
    } catch (err) {
      toast.error('Failed to update role: ' + err.message)
    } finally {
      setPendingRoleChange(null)
    }
  }

  if (!isAdmin) return (
    <div className="p-8 text-center text-gray-400">
      <p className="text-4xl mb-3">🔒</p>
      <p className="font-semibold">Admin access only</p>
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 bg-gray-50 dark:bg-gray-900 min-h-screen">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">👥 User Management</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Create and manage staff login accounts</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(p => !p)}>
          {showForm ? '✕ Cancel' : '+ Add Staff Account'}
        </button>
      </div>

      {/* Create user form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-blue-200 p-6 shadow-sm">
          <p className="text-sm font-semibold text-blue-700 mb-4">New Staff Account</p>
          <form onSubmit={onCreateUser} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Full Name *</label>
                <input value={form.name} onChange={e => set('name', e.target.value)}
                       className="form-input" placeholder="e.g. Priya Sharma" />
              </div>
              <div>
                <label className="form-label">Email *</label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                       className="form-input" placeholder="staff@gmail.com" />
              </div>
              <div>
                <label className="form-label">Password * (min 8 chars)</label>
                <input type="password" value={form.password} onChange={e => set('password', e.target.value)}
                       className="form-input" placeholder="Strong password" />
              </div>
              <div>
                <label className="form-label">Role</label>
                <select value={form.role} onChange={e => set('role', e.target.value)} className="form-select">
                  <option value="staff">Staff (full access, no delete)</option>
                  <option value="admin">Admin (full access + delete)</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn-primary">
                {saving ? '⏳ Creating…' : '✅ Create Account'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </form>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="font-semibold text-green-700 mb-1">✅ Staff can:</p>
              <p className="text-green-700">View dashboard, Add clients, Add policies, Add proposals, Send WhatsApp, View renewals, Upload documents, Export data</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="font-semibold text-blue-700 mb-1">🔑 Admin can do all above plus:</p>
              <p className="text-blue-700">Delete clients, Delete policies, View commission calculator, Manage user accounts, Import bulk data</p>
            </div>
          </div>
        </div>
      )}

      {/* ✅ FIX A2: Role change confirmation dialog */}
      {pendingRoleChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPendingRoleChange(null)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">⚠️ Confirm Role Change</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Change <strong>{pendingRoleChange.name}</strong>'s role to{' '}
              <strong className={pendingRoleChange.newRole === 'admin' ? 'text-blue-600' : 'text-green-600'}>
                {pendingRoleChange.newRole === 'admin' ? '🔑 Admin' : '👤 Staff'}
              </strong>?
            </p>
            {pendingRoleChange.newRole === 'admin' && (
              <p className="text-xs text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 rounded-lg p-2">
                Admin users can delete records and manage accounts.
              </p>
            )}
            <div className="flex gap-3">
              <button onClick={onChangeRole} className="btn-primary flex-1">Yes, Change Role</button>
              <button onClick={() => setPendingRoleChange(null)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Users list */}
      {loading
        ? <div className="text-gray-400 text-sm">Loading users…</div>
        : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="min-w-full">
              <thead>
                <tr>
                  {['Name', 'Email', 'Role', 'Change Role'].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {users.length === 0
                  ? <tr><td colSpan={4} className="text-center text-gray-400 py-8">No users found</td></tr>
                  : users.map(u => (
                    <tr key={u.id} className="table-row">
                      <td className="table-cell font-medium">{u.name || '—'}</td>
                      <td className="table-cell text-gray-600">{u.email}</td>
                      <td className="table-cell">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          u.role === 'admin'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-green-100 text-green-700'
                        }`}>
                          {u.role === 'admin' ? '🔑 Admin' : '👤 Staff'}
                        </span>
                      </td>
                      <td className="table-cell">
                        {/* ✅ FIX A2: trigger confirmation modal instead of direct change */}
                        <select
                          value={u.role || 'staff'}
                          onChange={e => setPendingRoleChange({ uid: u.id, name: u.name || u.email, newRole: e.target.value })}
                          className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                        >
                          <option value="staff">Set as Staff</option>
                          <option value="admin">Set as Admin</option>
                        </select>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        )
      }

      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-800">
        <p className="font-semibold mb-1">⚠️ Important</p>
        <p>• Accounts are created in Firebase Authentication. To <strong>delete</strong> an account, go to Firebase Console → Authentication → Users.</p>
        <p>• New self-created role records default to <strong>Staff</strong>; create or promote Admin users from this page.</p>
        <p>• You can promote any staff member to Admin using the dropdown above.</p>
      </div>
    </div>
  )
}
