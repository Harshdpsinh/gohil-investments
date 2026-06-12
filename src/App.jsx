// src/App.jsx
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
import TasksPage             from './pages/TasksPage'
import CalendarPage          from './pages/CalendarPage'
import BackupPage            from './pages/BackupPage'
import LeadsPage             from './pages/LeadsPage'
import EndorsementsPage      from './pages/EndorsementsPage'
import MastersPage           from './pages/MastersPage'
import ReportsPage           from './pages/ReportsPage'
import CommissionReconciliationPage from './pages/CommissionReconciliationPage'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 dark:text-gray-400 text-sm">Loading…</p>
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
                <Route path="/calendar"            element={<CalendarPage />} />
                <Route path="/proposals"           element={<ProposalsPage />} />
                <Route path="/claims"              element={<ClaimsPage />} />
                <Route path="/leads"               element={<LeadsPage />} />
                <Route path="/endorsements"        element={<EndorsementsPage />} />
                <Route path="/tasks"               element={<TasksPage />} />
                <Route path="/commission"          element={<CommissionPage />} />
                <Route path="/commission-reconciliation" element={<CommissionReconciliationPage />} />
                <Route path="/masters"             element={<MastersPage />} />
                <Route path="/reports"             element={<ReportsPage />} />
                <Route path="/admin-users"         element={<AdminUsersPage />} />
                <Route path="/backup"              element={<BackupPage />} />
                <Route path="*"                   element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        } />
      </Routes>
    </ThemeProvider>
  )
}
