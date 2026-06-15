// src/main.jsx
import React          from 'react'
import ReactDOM       from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster }    from 'react-hot-toast'
import App            from './App'
import { AuthProvider } from './hooks/useAuth'
import './index.css'
import './styles/animations.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3500,
            style: {
              background: 'rgba(30,41,59,0.94)',
              color: '#f1f5f9',
              fontSize: '14px',
              borderRadius: '10px',
              border: '1px solid rgba(148,163,184,0.12)',
              boxShadow: '0 14px 44px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.06)',
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
