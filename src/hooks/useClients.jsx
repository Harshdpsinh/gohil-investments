import { useState, useEffect } from 'react'
import { subscribeClients } from '../firebase/firestore'

export function useClients() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    const unsub = subscribeClients(data => {
      setClients(data)
      setLoading(false)
      setError(null)
    }, err => {
      console.error('Firestore clients subscription failed:', err)
      setError(err.message)
      setLoading(false)
    })
    const cap = setTimeout(() => setLoading(false), 15000)
    return () => {
      clearTimeout(cap)
      unsub()
    }
  }, [])

  return { clients, loading, error }
}
