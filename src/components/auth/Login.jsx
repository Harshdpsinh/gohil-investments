// src/components/auth/Login.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth }     from '../../hooks/useAuth'
import toast           from 'react-hot-toast'

export default function Login() {
  const { signIn, user } = useAuth()
  const navigate         = useNavigate()
  const [form,    setForm]    = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [showPw,  setShowPw]  = useState(false)

  // Already signed in → go to dashboard
  if (user) { navigate('/dashboard', { replace: true }); return null }

  const onChange = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }))

  const onSubmit = async e => {
    e.preventDefault()
    if (!form.email || !form.password) {
      toast.error('Please enter email and password')
      return
    }
    setLoading(true)
    try {
      await signIn(form.email, form.password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      const msg = err.code === 'auth/invalid-credential'
        ? 'Invalid email or password.'
        : err.message
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-blue-600
                    flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16
                          bg-white rounded-2xl shadow-lg mb-4">
            <span className="text-3xl">🏦</span>
          </div>
          <h1 className="text-3xl font-bold text-white">Gohil Investments</h1>
          <p className="text-blue-200 mt-1 text-sm">
            Wealth Management &amp; Insurance Advisory
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">Admin Sign In</h2>

          <form onSubmit={onSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label className="form-label">Email Address</label>
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                value={form.email}
                onChange={onChange}
                placeholder="admin@gohilinvestments.com"
                className="form-input"
              />
            </div>

            {/* Password */}
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
                  placeholder="••••••••"
                  className="form-input pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(p => !p)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center
                             text-gray-400 hover:text-gray-600"
                >
                  {showPw ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center py-2.5 text-base"
            >
              {loading
                ? <><span className="animate-spin">⏳</span> Signing in…</>
                : '→  Sign In'}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-6">
            🔒 Secure access. Unauthorized access is prohibited.
          </p>
        </div>
      </div>
    </div>
  )
}
