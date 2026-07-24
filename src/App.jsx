// UI MODERNIZATION - logic unchanged
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
import LeadsPage             from './pages/LeadsPage'
import EndorsementsPage      from './pages/EndorsementsPage'
import MastersPage           from './pages/MastersPage'
import ReportsPage           from './pages/ReportsPage'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-[#0a0f1e]">
      <div className="w-80 rounded-2xl border border-slate-400/10 bg-slate-800/60 p-6 shadow-[0_4px_24px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
        <div className="skeleton-shimmer h-5 rounded-full" />
        <div className="skeleton-shimmer mt-4 h-20 rounded-xl" />
        <p className="mt-4 text-center text-sm font-semibold text-slate-400">Loading...</p>
      </div>
    </div>
  )
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route path="/"                    element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard"           element={<DashboardPage />} />
                <Route path="/clients"             element={<ClientsPage />} />
                <Route path="/clients/:id"         element={<ClientProfilePage />} />
                <Route path="/policies"            element={<PoliciesPage />} />
                <Route path="/renewals"            element={<RenewalsPage />} />
                <Route path="/proposals"           element={<ProposalsPage />} />
                <Route path="/commission"          element={<CommissionPage />} />
                <Route path="/claims"              element={<ClaimsPage />} />
                <Route path="/leads"               element={<LeadsPage />} />
                <Route path="/endorsements"        element={<EndorsementsPage />} />
                <Route path="/masters"             element={<MastersPage />} />
                <Route path="/reports"             element={<ReportsPage />} />
                <Route path="/admin-users"         element={<AdminUsersPage />} />
                <Route path="/backup"              element={<BackupPage />} />
                <Route path="*"                    element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        } />
      </Routes>
    </ThemeProvider>
  )
}
