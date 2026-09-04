// UI MODERNIZATION - logic unchanged
import { Component } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth }           from './hooks/useAuth'
import { ThemeProvider }     from './context/ThemeContext'
import Layout                from './components/layout/Layout'
import Login                 from './components/auth/Login'
import DashboardPage         from './pages/DashboardPage'
import ClientsPage           from './pages/ClientsPage'
import ClientProfilePage     from './pages/ClientProfilePage'
import PoliciesPage          from './pages/PoliciesPage'
import RenewalsPage          from './pages/RenewalsPage'
import ProposalsPage         from './pages/ProposalsPage'
import CommissionPage        from './pages/CommissionPage'
import AdminUsersPage        from './pages/AdminUsersPage'
import ClaimsPage            from './pages/ClaimsPage'
import BackupPage            from './pages/BackupPage'
import ReportsPage           from './pages/ReportsPage'
import BusinessDonePage      from './pages/BusinessDonePage'
import WhatsAppInboxPage     from './pages/WhatsAppInboxPage'
import InstallmentsPage      from './pages/InstallmentsPage'
import RenewalPipelinePage   from './pages/RenewalPipelinePage'
import CrossSellPage         from './pages/CrossSellPage'
import WishesPage            from './pages/WishesPage'
import PremiumCalendarPage   from './pages/PremiumCalendarPage'
import BootScreen            from './components/ui/BootScreen'

class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err) { console.error('Screen failed:', err) }
  render() {
    if (this.state.failed) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center p-6">
          <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center">
            <p className="text-lg font-bold text-slate-900">This screen could not open</p>
            <p className="mt-2 text-sm text-slate-500">Your data is unchanged. Retry, or go Home.</p>
            <div className="mt-4 flex justify-center gap-2">
              <button type="button" className="btn-secondary" onClick={() => this.setState({ failed: false })}>Retry</button>
              <button type="button" className="btn-primary" onClick={() => window.location.assign('/dashboard')}>Home</button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function ProtectedRoute({ children }) {
  const { user, role, roleResolved, loading, signOut } = useAuth()
  if (loading || user === undefined || (user && !role && !roleResolved)) return <BootScreen />
  if (!user) return <Navigate to="/login" replace />
  if (!role) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">Account not provisioned</h1>
        <p className="mt-2 text-sm text-slate-500">
          Signed in as <span className="font-semibold text-slate-700">{user.email || 'unknown email'}</span>.
          This login is not on the staff list. On a computer, sign in as admin, open Manage Staff,
          enter this same email, and tap Create Account — that now attaches an existing login.
        </p>
        <button
          type="button"
          className="btn-secondary mt-6"
          onClick={() => signOut()}
        >
          Sign out
        </button>
      </div>
    </div>
  )
  return children
}

export default function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={
          <ProtectedRoute>
            <Layout>
              <RouteErrorBoundary>
              <Routes>
                <Route path="/"                    element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard"           element={<DashboardPage />} />
                <Route path="/clients"             element={<ClientsPage />} />
                <Route path="/clients/:id"         element={<ClientProfilePage />} />
                <Route path="/policies"            element={<PoliciesPage />} />
                <Route path="/renewals"            element={<RenewalsPage />} />
                <Route path="/pipeline"            element={<RenewalPipelinePage />} />
                <Route path="/installments"        element={<InstallmentsPage />} />
                <Route path="/cross-sell"          element={<CrossSellPage />} />
                <Route path="/proposals"           element={<ProposalsPage />} />
                <Route path="/business"            element={<BusinessDonePage />} />
                <Route path="/inbox"               element={<WhatsAppInboxPage />} />
                <Route path="/commission"          element={<CommissionPage />} />
                <Route path="/claims"              element={<ClaimsPage />} />
                <Route path="/reports"             element={<ReportsPage />} />
                <Route path="/wishes"              element={<WishesPage />} />
                <Route path="/calendar"            element={<PremiumCalendarPage />} />
                <Route path="/admin-users"         element={<AdminUsersPage />} />
                <Route path="/backup"              element={<BackupPage />} />
                <Route path="*"                    element={<Navigate to="/dashboard" replace />} />
              </Routes>
              </RouteErrorBoundary>
            </Layout>
          </ProtectedRoute>
        } />
      </Routes>
    </ThemeProvider>
  )
}
