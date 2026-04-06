import { useState, useEffect } from 'react'
import { subscribeClients } from '../firebase/firestore'

export function useClients() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    // FIX #2: pass error through so pages can surface it instead of showing stale data
    const unsub = subscribeClients((data, err) => {
      if (err) {
        console.error('Firestore clients subscription failed:', err)
        setError(err.message)
        setLoading(false)
        return
      }
      setClients(data)
      setLoading(false)
      setError(null)
    })
    return unsub
  }, [])

  return { clients, loading, error }
}
