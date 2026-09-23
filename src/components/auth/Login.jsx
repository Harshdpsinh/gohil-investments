// src/components/auth/Login.jsx
import { useState } from 'react'
import { Navigate, useNavigate, Link } from 'react-router-dom'
import { useAuth }     from '../../hooks/useAuth'
import BootScreen      from '../ui/BootScreen'
import toast           from 'react-hot-toast'
import { BUSINESS, phoneTel } from '../../utils/legal'

let lastAttempt = 0

export default function Login() {
  const { signIn, resetPassword, user, loading: authLoading } = useAuth()
  const navigate         = useNavigate()
  const [form,    setForm]    = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [showPw,  setShowPw]  = useState(false)
  const [adult,   setAdult]   = useState(false)
  const [notice,  setNotice]  = useState({ tone: '', text: '' })

  const say = (tone, text) => {
    setNotice({ tone, text })
    if (tone === 'error') toast.error(text)
    else toast.success(text)
  }

  if (authLoading || user === undefined) return <BootScreen />
  if (user) return <Navigate to="/dashboard" replace />

  const onChange = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }))

  const onSubmit = async e => {
    e.preventDefault()
    if (!form.email || !form.password) { say('error', 'Please enter email and password'); return }
    if (!adult) { say('error', 'Confirm you are 18 or older.'); return }
    if (Date.now() - lastAttempt < 1500) { say('error', 'Please wait before trying again.'); return }
    lastAttempt = Date.now()
    setLoading(true)
    try {
      await signIn(form.email, form.password)
      say('ok', 'Signed in')
      navigate('/dashboard', { replace: true })
    } catch (err) {
      say('error', err.code === 'auth/invalid-credential' ? 'Invalid email or password.' : err.message)
    } finally { setLoading(false) }
  }

  const onForgotPassword = async () => {
    const email = form.email.trim()
    if (!email) {
      say('error', 'Enter your email address first, then click Forgot password.')
      return
    }
    setResetting(true)
    try {
      await resetPassword(email)
      say('ok', 'Password reset email sent. Please check your inbox.')
    } catch (err) {
      const msg =
        err.code === 'auth/invalid-email' ? 'Enter a valid email address.' :
        err.code === 'auth/too-many-requests' ? 'Too many reset attempts. Please wait and try again.' :
        'Could not send reset email. Please check the email address and try again.'
      say('error', msg)
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <div className="grid min-h-screen lg:grid-cols-[0.9fr_1.1fr]">
        <section className="hidden flex-col justify-between bg-slate-950 p-10 text-white lg:flex">
          <Link to="/dashboard" className="flex items-center gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-teal-300">
            <div className="brand-mark h-12 w-12">
              <img src="/g1.jpg" alt="" className="h-full w-full object-cover" />
            </div>
            <div>
              <p className="text-sm font-bold">Gohil Investments</p>
              <p className="text-xs text-slate-400">Wealth Management & Insurance Advisory</p>
            </div>
          </Link>
          <div className="max-w-lg">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-300">Operations studio</p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight">Policies, renewals, and clients — one desk.</h1>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              Bhavnagar brokerage workspace. Access comes from your staff profile, not this screen.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            {BUSINESS.phones.map(label => (
              <a key={label} href={phoneTel(label)} className="mr-3 hover:underline">{label}</a>
            ))}
          </p>
        </section>

        <section className="flex min-h-screen items-center justify-center p-4">
          <div className="w-full max-w-md">
            <Link to="/dashboard" className="mb-6 block text-center lg:hidden">
              <div className="brand-mark mx-auto mb-3 h-14 w-14">
                <img src="/g1.jpg" alt="" className="h-full w-full object-cover" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Gohil Investments</h1>
              <p className="text-sm text-slate-500">Insurance CRM</p>
            </Link>

            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-6">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Sign in</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">Welcome back</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Use the email an admin created for you.
                </p>
              </div>

              <form onSubmit={onSubmit} className="space-y-5" noValidate>
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

                <label className="flex items-start gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={adult}
                    onChange={e => setAdult(e.target.checked)}
                  />
                  <span>I am 18 or older. This workspace is for staff only — not for children.</span>
                </label>

                <button type="submit" disabled={loading || !adult} className="btn-primary w-full">
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
                {notice.text ? (
                  <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`text-sm font-semibold ${notice.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
                    {notice.text}
                  </p>
                ) : null}
              </form>

              <button
                type="button"
                onClick={onForgotPassword}
                disabled={resetting}
                className="mt-4 w-full text-center text-sm font-semibold text-teal-700"
              >
                {resetting ? 'Sending reset email…' : 'Forgot password'}
              </button>
              <p className="mt-6 text-center text-xs text-slate-400">
                <Link to="/privacy" className="hover:underline">Privacy</Link>
                {' · '}
                <Link to="/terms" className="hover:underline">Terms</Link>
                {' · '}
                <Link to="/dmca" className="hover:underline">DMCA</Link>
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
