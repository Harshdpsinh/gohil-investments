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
    })
    return unsub
  }, [])

  return { clients, loading, error }
}
