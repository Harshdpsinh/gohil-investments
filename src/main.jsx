// src/main.jsx
import React          from 'react'
import ReactDOM       from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster }    from 'react-hot-toast'
import App            from './App'
import { AuthProvider } from './hooks/useAuth'
import './index.css'

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
              background: '#1e3a8a',
              color: '#fff',
              fontSize: '14px',
              borderRadius: '10px',
            },
            success: { iconTheme: { primary: '#22c55e', secondary: '#fff' } },
            error:   { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
