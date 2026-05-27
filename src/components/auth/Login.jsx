// src/components/auth/Login.jsx
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth }     from '../../hooks/useAuth'
import toast           from 'react-hot-toast'

// Module-level timestamp: prevents brute-force by enforcing a 1.5 s gap between attempts.
let lastAttempt = 0

export default function Login() {
  const { signIn, user } = useAuth()
  const navigate         = useNavigate()
  const [form,    setForm]    = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [showPw,  setShowPw]  = useState(false)

  if (user) return <Navigate to="/dashboard" replace />

  const onChange = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }))

  const onSubmit = async e => {
    e.preventDefault()
    if (!form.email || !form.password) { toast.error('Please enter email and password'); return }
    // Rate-limit: ignore rapid repeated submissions (brute-force protection)
    if (Date.now() - lastAttempt < 1500) { toast.error('Please wait before trying again.'); return }
    lastAttempt = Date.now()
    setLoading(true)
    try {
      await signIn(form.email, form.password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      toast.error(err.code === 'auth/invalid-credential' ? 'Invalid email or password.' : err.message)
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-600
                    flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-24 h-24
                          bg-white rounded-2xl shadow-lg mb-4 overflow-hidden">
            <img src="/g1.jpg" alt="Gohil Insurance" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-3xl font-bold text-white">Gohil Investments</h1>
          <p className="text-blue-200 mt-1 text-sm">Wealth Management &amp; Insurance Advisory</p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8
                        border border-transparent dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-6">Admin Sign In</h2>
          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label className="form-label">Email Address</label>
              <input name="email" type="email" autoComplete="email" required
                     value={form.email} onChange={onChange}
                     placeholder="admin@gohilinvestments.com" className="form-input" />
            </div>
            <div>
              <label className="form-label">Password</label>
              <div className="relative">
                <input name="password" type={showPw ? 'text' : 'password'}
                       autoComplete="current-password" required
                       value={form.password} onChange={onChange}
                       placeholder="••••••••" className="form-input pr-11" />
                <button type="button" onClick={() => setShowPw(p => !p)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center
                                   text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                  {showPw ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading}
                    className="btn-primary w-full justify-center py-2.5 text-base">
              {loading ? <><span className="animate-spin">⏳</span> Signing in…</> : '→  Sign In'}
            </button>
          </form>
          <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-6">
            🔒 Secure access. Unauthorized access is prohibited.
          </p>
        </div>
      </div>
    </div>
  )
}
