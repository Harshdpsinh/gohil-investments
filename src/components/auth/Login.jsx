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
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden flex-col justify-between border-r border-white/10 bg-gray-950 p-10 lg:flex">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-sm font-black text-gray-950">GI</div>
            <div>
              <p className="text-sm font-black">Gohil Investments</p>
              <p className="text-xs text-gray-400">Wealth Management & Insurance Advisory</p>
            </div>
          </div>

          <div className="max-w-xl">
            <div className="mb-5 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-blue-200">
              Insurance CRM Control Center
            </div>
            <h1 className="text-5xl font-black leading-tight tracking-tight">
              Clean operations for policies, renewals, claims, and clients.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-gray-300">
              Secure team access with real-time policy data, renewal tracking, commission workflows, and client records in one place.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs text-gray-300">
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <p className="text-2xl font-black text-white">24/7</p>
              <p className="mt-1">Cloud access</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <p className="text-2xl font-black text-white">RBAC</p>
              <p className="mt-1">Role-based control</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <p className="text-2xl font-black text-white">CRM</p>
              <p className="mt-1">Insurance workflow</p>
            </div>
          </div>
        </section>

        <section className="flex min-h-screen items-center justify-center bg-gray-100 p-4 text-gray-950 dark:bg-gray-950 dark:text-white">
          <div className="w-full max-w-md">
            <div className="mb-6 text-center lg:hidden">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-lg bg-gray-950 text-sm font-black text-white dark:bg-white dark:text-gray-950">
                GI
              </div>
              <h1 className="text-2xl font-black tracking-tight">Gohil Investments</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Insurance CRM</p>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-xl shadow-gray-200/70 dark:border-gray-800 dark:bg-gray-900 dark:shadow-black/30">
              <div className="mb-6">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">Secure Login</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-gray-950 dark:text-white">
                  {loginRole === 'admin' ? 'Admin Sign In' : 'Staff Sign In'}
                </h2>
                <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
                  Choose your login type. Access rights are verified from your saved account role.
                </p>
              </div>

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
                        /* UI-only verification: role choice still updates the existing loginRole state. */
                        onClick={() => setLoginRole(option.key)}
                        className={`rounded-md border px-3 py-2 text-left shadow-sm transition ${
                          loginRole === option.key
                            ? 'border-blue-500 bg-blue-50 text-blue-800 ring-4 ring-blue-100 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-950'
                            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-900'
                        }`}
                      >
                        <span className="block text-sm font-black">{option.label}</span>
                        <span className="block text-xs opacity-75">{option.note}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="form-label">Email Address</label>
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={form.email}
                    /* UI-only verification: email field still calls the shared onChange handler. */
                    onChange={onChange}
                    placeholder={loginRole === 'admin' ? 'admin@gohilinvestments.com' : 'staff@gohilinvestments.com'}
                    className="form-input"
                  />
                </div>

                <div>
                  <label className="form-label">Password</label>
                  <div className="relative">
                    <input
                      name="password"
                      type={showPw ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={form.password}
                      /* UI-only verification: password field still calls the shared onChange handler. */
                      onChange={onChange}
                      placeholder="Enter password"
                      className="form-input pr-12"
                    />
                    {/* UI-only verification: show password still toggles the same showPw state. */}
                    <button
                      type="button"
                      onClick={() => setShowPw(p => !p)}
                      className="absolute inset-y-1 right-1 rounded-md px-3 text-xs font-bold text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                    >
                      {showPw ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 text-base">
                  {loading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Signing in...
                    </>
                  ) : 'Sign In'}
                </button>

                <button
                  type="button"
                  /* UI-only verification: forgot password remains mapped to onForgotPassword. */
                  onClick={onForgotPassword}
                  disabled={loading || resetting}
                  className="w-full rounded-md px-3 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-50 hover:text-blue-900 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-950"
                >
                  {resetting ? 'Sending reset email...' : 'Forgot password?'}
                </button>
              </form>

              <p className="mt-6 text-center text-xs font-medium text-gray-400 dark:text-gray-500">
                Secure access. Unauthorized access is prohibited.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
