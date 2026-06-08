// src/components/auth/Login.jsx
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth }     from '../../hooks/useAuth'
import toast           from 'react-hot-toast'

// Module-level timestamp: prevents brute-force by enforcing a 1.5 s gap between attempts.
let lastAttempt = 0

export default function Login() {
  const { signIn, resetPassword, user } = useAuth()
  const navigate         = useNavigate()
  const [form,    setForm]    = useState({ email: '', password: '' })
  const [loginRole, setLoginRole] = useState('admin')
  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)
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
      toast.success(`${loginRole === 'admin' ? 'Admin' : 'Staff'} sign in successful`)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      toast.error(err.code === 'auth/invalid-credential' ? 'Invalid email or password.' : err.message)
    } finally { setLoading(false) }
  }

  const onForgotPassword = async () => {
    const email = form.email.trim()
    if (!email) {
      toast.error('Enter your email address first, then click Forgot password.')
      return
    }
    setResetting(true)
    try {
      await resetPassword(email)
      toast.success('Password reset email sent. Please check your inbox.')
    } catch (err) {
      const msg =
        err.code === 'auth/invalid-email' ? 'Enter a valid email address.' :
        err.code === 'auth/too-many-requests' ? 'Too many reset attempts. Please wait and try again.' :
        'Could not send reset email. Please check the email address and try again.'
      toast.error(msg)
    } finally {
      setResetting(false)
    }
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
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
            {loginRole === 'admin' ? 'Admin Sign In' : 'Staff Sign In'}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-5">
            Choose your login type. Access rights are verified from your saved account role.
          </p>
          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label className="form-label">Login As</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'admin', label: 'Admin', note: 'Full access' },
                  { key: 'staff', label: 'Staff', note: 'Daily work' },
                ].map(option => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setLoginRole(option.key)}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                      loginRole === option.key
                        ? 'border-blue-600 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-200'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                    }`}
                  >
                    <span className="block text-sm font-bold">{option.label}</span>
                    <span className="block text-xs opacity-75">{option.note}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="form-label">Email Address</label>
              <input name="email" type="email" autoComplete="email" required
                     value={form.email} onChange={onChange}
                     placeholder={loginRole === 'admin' ? 'admin@gohilinvestments.com' : 'staff@gohilinvestments.com'} className="form-input" />
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
            <button
              type="button"
              onClick={onForgotPassword}
              disabled={loading || resetting}
              className="w-full text-sm font-semibold text-blue-700 hover:text-blue-900 disabled:opacity-50"
            >
              {resetting ? 'Sending reset email...' : 'Forgot password?'}
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
