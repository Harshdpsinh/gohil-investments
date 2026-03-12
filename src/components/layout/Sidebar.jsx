// src/components/layout/Sidebar.jsx
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import toast       from 'react-hot-toast'

export default function Sidebar({ mobile, onClose }) {
  const { signOut, user, role, isAdmin } = useAuth()
  const navigate = useNavigate()

  const NAV = [
    { to: '/dashboard',  icon: '📊', label: 'Dashboard'   },
    { to: '/clients',    icon: '👥', label: 'Clients'     },
    { to: '/policies',   icon: '📋', label: 'Policies'    },
    { to: '/renewals',   icon: '🔔', label: 'Renewals'    },
    { to: '/proposals',  icon: '📝', label: 'Proposals'   },
    ...(isAdmin ? [
      { to: '/commission', icon: '💰', label: 'Commission'  },
      { to: '/admin-users',icon: '👥', label: 'Manage Staff' },
    ] : []),
  ]

  const handleSignOut = async () => {
    await signOut()
    toast.success('Signed out')
    navigate('/login')
  }

  return (
    <aside className="flex flex-col h-full bg-white border-r border-gray-200 w-64">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🏦</span>
          <div>
            <p className="font-bold text-gray-900 text-sm leading-tight">Gohil Investments</p>
            <p className="text-xs text-gray-400">Portfolio Manager</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2">Menu</p>
        {NAV.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={mobile ? onClose : undefined}
            className={({ isActive }) => isActive ? 'nav-item-active' : 'nav-item'}
          >
            <span className="text-lg leading-none">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User / Sign out */}
      <div className="px-4 py-4 border-t border-gray-100">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-sm font-bold">
            {user?.email?.[0]?.toUpperCase() || 'A'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-800 truncate">{user?.email}</p>
            <span className={`inline-block text-xs px-1.5 py-0.5 rounded font-semibold mt-0.5 ${
              isAdmin ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
            }`}>
              {isAdmin ? '🔑 Admin' : '👤 Staff'}
            </span>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-2"
        >
          <span>🚪</span> Sign Out
        </button>
      </div>
    </aside>
  )
}
