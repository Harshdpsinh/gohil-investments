import { useState, useEffect } from 'react'
import { subscribePolicies } from '../firebase/firestore'

export function usePolicies() {
  const [policies, setPolicies] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    // FIX #2: pass error through so pages can surface it instead of showing stale data
    const unsub = subscribePolicies((data, err) => {
      if (err) {
        console.error('Firestore policies subscription failed:', err)
        setError(err.message)
        setLoading(false)
        return
      }
      setPolicies(data)
      setLoading(false)
      setError(null)
    })
    return unsub
  }, [])

  return { policies, loading, error }
}
