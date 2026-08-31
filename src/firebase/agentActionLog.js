import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './config'
import { AGENT_ACTION_LOG, attemptPayload } from '../utils/forbiddenActions'

export async function recordAgentAttempt(input = {}) {
  const payload = attemptPayload(input)
  return addDoc(collection(db, AGENT_ACTION_LOG), {
    ...payload,
    at: serverTimestamp(),
  })
}

export function subscribeAgentAttempts(callback, onError) {
  return onSnapshot(
    query(collection(db, AGENT_ACTION_LOG), orderBy('at', 'desc'), limit(30)),
    snap => callback(snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))),
    onError || (err => console.error('subscribeAgentAttempts:', err.code, err.message)),
  )
}
