import { useState, useEffect } from 'react'
import { subscribePolicies } from '../firebase/firestore'

export function usePolicies() {
  const [policies, setPolicies] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    const unsub = subscribePolicies(data => {
      setPolicies(data)
      setLoading(false)
      setError(null)
    }, err => {
      console.error('Firestore policies subscription failed:', err)
      setError(err.message)
      setLoading(false)
    })
    return unsub
  }, [])

  return { policies, loading, error }
}
