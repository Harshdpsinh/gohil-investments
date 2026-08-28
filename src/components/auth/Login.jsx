// src/components/auth/Login.jsx
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth }     from '../../hooks/useAuth'
import toast           from 'react-hot-toast'

let lastAttempt = 0

export default function Login() {
  const { signIn, resetPassword, user } = useAuth()
  const navigate         = useNavigate()
  const [form,    setForm]    = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [showPw,  setShowPw]  = useState(false)

  if (user) return <Navigate to="/dashboard" replace />

  const onChange = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }))

  const onSubmit = async e => {
    e.preventDefault()
    if (!form.email || !form.password) { toast.error('Please enter email and password'); return }
    if (Date.now() - lastAttempt < 1500) { toast.error('Please wait before trying again.'); return }
    lastAttempt = Date.now()
    setLoading(true)
    try {
      await signIn(form.email, form.password)
      toast.success('Signed in')
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
    <div className="login-portal min-h-screen text-slate-950">
      <header className="flex items-center justify-between gap-3 border-b border-[#eadfce] bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="brand-mark h-11 w-11">
            <img src="/g1.jpg" alt="Gohil Investments" className="h-full w-full object-cover" />
          </div>
          <div>
            <p className="text-sm font-bold text-[#2a2156]">Gohil Investments</p>
            <p className="text-[11px] text-[#5c5670]">Wealth Management & Insurance Advisory</p>
          </div>
        </div>
        <p className="hidden text-xs font-semibold text-[#5c5670] sm:block">Bhavnagar</p>
      </header>

      <section className="portal-hero mx-auto max-w-3xl px-4">
        <h1 className="portal-title">Welcome to Gohil Investments</h1>
        <p className="portal-subtitle">Sign in to manage policies, renewals and commission</p>
      </section>

      <section className="flex items-start justify-center px-4 pb-16">
        <div className="w-full max-w-md">
          <div className="portal-cta mb-4">
            <p>Check all your services in one place</p>
            <span className="text-xs font-semibold text-[#5c5670]">Staff login</span>
          </div>
          <div className="rounded-[22px] border border-[#eadfce] bg-white p-6 shadow-sm">
            <div className="mb-6">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#5b3cc4]">Sign in</p>
              <h2 className="portal-section-title mt-2">Welcome back</h2>
              <p className="mt-2 text-sm leading-6 text-[#5c5670]">
                Use the email an admin created for you.
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-5">
              <div>
                <label className="form-label">Email Address</label>
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={form.email}
                  onChange={onChange}
                  placeholder="you@gohilinvestments.com"
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
                    onChange={onChange}
                    placeholder="Enter password"
                    className="form-input pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute inset-y-0 right-2 my-auto text-xs font-semibold text-slate-500"
                  >
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? 'Signing in…' : 'Login'}
              </button>
            </form>

            <button
              type="button"
              onClick={onForgotPassword}
              disabled={resetting}
              className="mt-4 w-full text-center text-sm font-semibold text-[#3d2a8c]"
            >
              {resetting ? 'Sending reset email…' : 'Forgot password'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
