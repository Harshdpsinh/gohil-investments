// src/hooks/useAuth.jsx
import { createContext, useContext, useEffect, useState } from 'react'
import {
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  getAuth,
} from 'firebase/auth'
import { initializeApp, getApp, getApps } from 'firebase/app'
import { auth, firebaseConfig } from '../firebase/config'
import { getUserRole, setUserRole } from '../firebase/firestore'
import { isWriteRole, normaliseRole, ownerAdminEmails } from '../utils/roles'

const AuthContext = createContext(null)
const OWNER_ADMIN_EMAILS = ownerAdminEmails(import.meta.env.VITE_ADMIN_EMAILS)

async function fetchUserProfile(uid) {
  // Mobile networks regularly miss a 5s window. Treat a timeout as "try
  // again", never as "this login has no staff row".
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const profile = await getUserRole(uid)
      if (profile) return profile
    } catch (err) {
      console.error('Role fetch error:', err)
    }
    await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)))
  }
  return null
}

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(undefined)
  const [role,    setRole]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async u => {
      setUser(u)
      if (u) {
        const profile = await fetchUserProfile(u.uid)
        if (profile) {
          setRole(normaliseRole(profile.role, u.email, import.meta.env.VITE_ADMIN_EMAILS) || null)
        } else if (OWNER_ADMIN_EMAILS.includes(String(u.email || '').trim().toLowerCase())) {
          const defaultRole = 'admin'
          try {
            await setUserRole(u.uid, { email: u.email, role: defaultRole, name: u.email?.split('@')[0] || 'Admin' })
          } catch (err) {
            console.error('Failed to create owner profile:', err)
          }
          setRole(defaultRole)
        } else {
          // Signed in but not provisioned. Do NOT write a staff profile —
          // Firestore rules reject it, and a client-side 'staff' role would
          // show the CRM shell against empty data.
          setRole(null)
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

  async function resetPassword(email) {
    const cleanEmail = String(email || '').trim().toLowerCase()
    if (!cleanEmail) throw new Error('Enter your email address first.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('Enter a valid email address.')
    }
    return sendPasswordResetEmail(auth, cleanEmail, {
      url: `${window.location.origin}/login`,
      handleCodeInApp: false,
    })
  }

  async function createStaffAccount(email, password, name, requestedRole = 'staff') {
    if (role !== 'admin') {
      throw new Error('Only admins can create staff accounts.')
    }
    const cleanEmail = String(email || '').trim().toLowerCase()
    const cleanName = String(name || '').trim()
    if (!cleanName) throw new Error('Name is required.')
    if (!cleanEmail) throw new Error('Email is required.')
    if (String(password || '').length < 8) throw new Error('Password must be at least 8 characters.')

    const safeRole = normaliseRole(requestedRole, '', import.meta.env.VITE_ADMIN_EMAILS) || 'staff'
    const idToken = await auth.currentUser?.getIdToken()
    if (idToken) {
      const response = await fetch('/api/provision-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ email: cleanEmail, password, name: cleanName, role: safeRole }),
      })
      const body = await response.json().catch(() => null)
      if (response.ok && body?.ok) return body
      if (response.status !== 404) {
        const error = new Error(body?.error || 'Could not create or attach that login.')
        error.code = body?.code
        throw error
      }
    }

    const secondaryApp = getApps().some(app => app.name === 'staffAccountCreation')
      ? getApp('staffAccountCreation')
      : initializeApp(firebaseConfig, 'staffAccountCreation')
    const secondaryAuth = getAuth(secondaryApp)
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, password)
      await secondaryAuth.signOut()
      await setUserRole(cred.user.uid, { email: cleanEmail, role: safeRole, name: cleanName })
      return { uid: cred.user.uid, attached: false }
    } catch (err) {
      await secondaryAuth.signOut().catch(() => {})
      if (err.code === 'auth/email-already-in-use') {
        throw new Error('This email already has a login. After deploy, Create Account will attach it. Until then sign in as admin on a computer and wait for the update, or use a new email.')
      }
      throw err
    }
  }

  const isAdmin = role === 'admin'
  const isReader = role === 'reader'
  const canWrite = isWriteRole(role)

  return (
    <AuthContext.Provider value={{ user, role, isAdmin, isReader, canWrite, loading, signIn, signOut, resetPassword, createStaffAccount }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
