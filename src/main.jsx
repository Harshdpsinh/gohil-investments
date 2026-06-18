// src/main.jsx
import React          from 'react'
import ReactDOM       from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster }    from 'react-hot-toast'
import { Capacitor }  from '@capacitor/core'
import App            from './App'
import { AuthProvider } from './hooks/useAuth'
import './styles/tokens.css'
import './index.css'
import './styles/animations.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster
          position={Capacitor.isNativePlatform() ? 'top-center' : 'bottom-right'}
          toastOptions={{
            duration: 3500,
            style: {
              background: 'rgba(15,23,42,0.94)',
              color: '#f1f5f9',
              fontSize: '14px',
              fontWeight: 600,
              borderRadius: '14px',
              border: '1px solid rgba(148,163,184,0.18)',
              boxShadow: '0 18px 48px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.08)',
              backdropFilter: 'blur(16px)',
            },
            success: { iconTheme: { primary: '#10b981', secondary: '#fff' } },
            error:   { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
