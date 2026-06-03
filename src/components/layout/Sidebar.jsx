// src/components/layout/Sidebar.jsx
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth }  from '../../hooks/useAuth'
import { useTheme } from '../../context/ThemeContext'
import toast        from 'react-hot-toast'

export default function Sidebar({ mobile, onClose }) {
  const { signOut, user, isAdmin } = useAuth()
  const { dark, toggle }           = useTheme()
  const navigate = useNavigate()

  const NAV = [
    { to:'/dashboard',  icon:'📊', label:'Dashboard'  },
    { to:'/clients',    icon:'👥', label:'Clients'     },
    { to:'/policies',   icon:'📋', label:'Policies'    },
    { to:'/renewals',   icon:'🔔', label:'Renewals'    },
    { to:'/calendar',   icon:'📅', label:'Calendar'    },
    { to:'/claims',     icon:'🔍', label:'Claims'      },
    { to:'/proposals',  icon:'📝', label:'Proposals'   },
    { to:'/tasks',      icon:'✅', label:'Tasks'       },
    ...(isAdmin ? [
      { to:'/commission',  icon:'💰', label:'Commission'  },
      { to:'/admin-users', icon:'🔑', label:'Manage Staff' },
      { to:'/backup',      icon:'BK', label:'Backup'       },
    ] : []),
  ]

  const handleSignOut = async () => {
    await signOut()
    toast.success('Signed out')
    navigate('/login')
  }

  return (
    <aside className="flex flex-col h-full bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 w-64">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🏦</span>
          <div>
            <p className="font-bold text-gray-900 dark:text-white text-sm leading-tight">Gohil Investments</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Portfolio Manager v5</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-3 mb-2">Menu</p>
        {NAV.map(({ to, icon, label }) => (
          <NavLink key={to} to={to}
                   onClick={mobile ? onClose : undefined}
                   className={({ isActive }) => isActive ? 'nav-item-active' : 'nav-item'}>
            <span className="text-lg leading-none">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Dark mode toggle */}
      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700">
        <button onClick={toggle}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg
                           bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600
                           transition-colors text-sm text-gray-700 dark:text-gray-200">
          <span className="flex items-center gap-2">
            <span>{dark ? '☀️' : '🌙'}</span>
            <span>{dark ? 'Light Mode' : 'Dark Mode'}</span>
          </span>
          <div className={`w-10 h-5 rounded-full transition-colors ${dark?'bg-blue-600':'bg-gray-300'} relative`}>
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${dark?'translate-x-5':'translate-x-0.5'}`} />
          </div>
        </button>
      </div>

      {/* User */}
      <div className="px-4 py-4 border-t border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-700 dark:text-blue-300 text-sm font-bold">
            {user?.email?.[0]?.toUpperCase() || 'A'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{user?.email}</p>
            <span className={`inline-block text-xs px-1.5 py-0.5 rounded font-semibold mt-0.5
              ${isAdmin?'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300':'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'}`}>
              {isAdmin ? '🔑 Admin' : '👤 Staff'}
            </span>
          </div>
        </div>
        <button onClick={handleSignOut}
                className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors flex items-center gap-2">
          <span>🚪</span> Sign Out
        </button>
      </div>
    </aside>
  )
}

