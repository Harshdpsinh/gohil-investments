// src/hooks/useAuth.jsx
import { createContext, useContext, useEffect, useState } from 'react'
import {
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
} from 'firebase/auth'
import { auth } from '../firebase/config'
import { getUserRole, setUserRole } from '../firebase/firestore'

const AuthContext = createContext(null)

// Wraps a promise with a timeout — if Firestore is blocked by
// Brave Shields or a firewall, we fall back instead of hanging forever.
function withTimeout(promise, ms = 5000) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(null), ms))
  ])
}

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(undefined)
  const [role,    setRole]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async u => {
      setUser(u)
      if (u) {
        try {
          const profile = await withTimeout(getUserRole(u.uid), 5000)
          if (profile) {
            setRole(profile.role || 'staff')   // FIX #1: default to staff, never admin
          } else {
            console.warn('First login or role fetch failed – creating default staff role')
            try {
              await withTimeout(
                setUserRole(u.uid, { email: u.email, role: 'staff', name: u.email?.split('@')[0] || 'Staff' }),
                3000
              )
            } catch (err) {
              console.error('Failed to create default role:', err)
            }
            setRole('staff')   // FIX #1: never silently escalate to admin
          }
        } catch (err) {
          console.error('Role fetch error:', err)
          setRole('staff')   // FIX #1: fail safe to staff
        }
      } else {
        setRole(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  async function signIn(email, password) {
    return signInWithEmailAndPassword(auth, email, password)
  }

  async function signOut() {
    setRole(null)
    return fbSignOut(auth)
  }

  async function createStaffAccount(email, password, name, role = 'staff') {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    // FIX #6: retry Firestore write so Auth user is never left without a role doc
    let retries = 3
    while (retries--) {
      try {
        await setUserRole(cred.user.uid, { email, role, name })
        return cred
      } catch (e) {
        if (retries === 0) throw e
        await new Promise(r => setTimeout(r, 800))
      }
    }
  }

  const isAdmin = role === 'admin'

  return (
    <AuthContext.Provider value={{ user, role, isAdmin, loading, signIn, signOut, createStaffAccount }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
