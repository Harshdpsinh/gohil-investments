// src/main.jsx
import React          from 'react'
import ReactDOM       from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster }    from 'react-hot-toast'
import { Capacitor }  from '@capacitor/core'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-700.css'
import App            from './App'
import { AuthProvider } from './hooks/useAuth'
import './styles/tokens.css'
import './index.css'
import './styles/animations.css'
import './styles/portal.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster
          position={Capacitor.isNativePlatform() ? 'top-center' : 'bottom-right'}
          containerStyle={
            Capacitor.isNativePlatform()
              ? { top: 'calc(env(safe-area-inset-top) + 3.75rem)' }
              : undefined
          }
          toastOptions={{
            duration: 3500,
            style: {
              background: 'rgba(42,33,86,0.94)',
              color: '#f6f0e8',
              fontSize: '14px',
              fontWeight: 600,
              borderRadius: '16px',
              border: '1px solid rgba(196,181,253,0.28)',
              boxShadow: '0 18px 48px rgba(42,33,86,0.28)',
            },
            success: { iconTheme: { primary: '#10b981', secondary: '#fff' } },
            error:   { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
