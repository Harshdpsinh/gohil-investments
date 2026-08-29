import { collection, doc, getDoc, getDocs, writeBatch, Timestamp } from 'firebase/firestore'
import { db } from './config'

export const BACKUP_COLLECTIONS = [
  'clients', 'policies', 'proposals', 'claims', 'users', 'families',
  'audit_logs', 'documents', 'message_logs', 'leads', 'lead_followups', 'endorsements',
  'commission_master', 'commission_transactions',
  'renewal_reminder_settings', 'renewal_reminder_logs', 'whatsapp_messages',
  'sub_brokers', 'sales_managers', 'reports_saved_filters',
  'client_activities', 'occasion_logs',
]

function serialiseBackupValue(value) {
  if (value === null || value === undefined) return value
  if (typeof value?.toDate === 'function' && typeof value.seconds === 'number') {
    return { __backupType: 'timestamp', iso: value.toDate().toISOString() }
  }
  if (value instanceof Date) {
    return { __backupType: 'timestamp', iso: value.toISOString() }
  }
  if (Array.isArray(value)) return value.map(serialiseBackupValue)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialiseBackupValue(v)]))
  }
  return value
}

function deserialiseBackupValue(value) {
  if (value === null || value === undefined) return value
  if (value?.__backupType === 'timestamp' && value.iso) {
    const date = new Date(value.iso)
    return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date)
  }
  if (Array.isArray(value)) return value.map(deserialiseBackupValue)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deserialiseBackupValue(v)]))
  }
  return value
}

function isPermissionError(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || error || '')
  return code === 'permission-denied' || /insufficient permissions|missing or insufficient/i.test(message)
}

async function commitBackupWritesInChunks(writes, onProgress = () => {}) {
  let done = 0
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db)
    const chunk = writes.slice(i, i + 400)
    chunk.forEach(({ ref, data }) => batch.set(ref, data, { merge: true }))
    await batch.commit()
    done += chunk.length
    onProgress(done, writes.length)
  }
}

export async function createCRMBackup(onProgress = () => {}) {
  const collections = {}
  const totals = {}
  const skipped = []
  const steps = BACKUP_COLLECTIONS.length + 1
  let step = 0

  for (const name of BACKUP_COLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, name))
      collections[name] = snap.docs.map(d => ({
        id: d.id,
        data: serialiseBackupValue(d.data()),
      }))
      totals[name] = snap.size
    } catch (error) {
      if (isPermissionError(error)) {
        collections[name] = []
        totals[name] = 0
        skipped.push({ name, reason: error?.message || 'Missing or insufficient permissions.' })
      } else {
        throw new Error(`Backup failed while reading "${name}": ${error?.message || error}`)
      }
    }
    onProgress(++step, steps, name)
  }

  const clientDocuments = []
  const clientList = collections.clients || []
  try {
    for (let i = 0; i < clientList.length; i += 25) {
      const batch = clientList.slice(i, i + 25)
      const snaps = await Promise.all(
        batch.map(client => getDocs(collection(db, 'clients', client.id, 'documents')))
      )
      snaps.forEach((snap, index) => {
        snap.docs.forEach(d => {
          clientDocuments.push({
            clientId: batch[index].id,
            id: d.id,
            data: serialiseBackupValue(d.data()),
          })
        })
      })
    }
  } catch (error) {
    if (isPermissionError(error)) {
      skipped.push({ name: 'clientDocuments', reason: error?.message || 'Missing or insufficient permissions.' })
    } else {
      throw new Error(`Backup failed while reading client documents: ${error?.message || error}`)
    }
  }
  totals.clientDocuments = clientDocuments.length
  onProgress(++step, steps, 'clientDocuments')

  return {
    app: 'gohil-investments-crm',
    version: 1,
    createdAt: new Date().toISOString(),
    totals,
    skipped,
    collections,
    subcollections: {
      clientDocuments,
    },
  }
}

export async function restoreCRMBackup(backup, onProgress = () => {}) {
  if (!backup || backup.app !== 'gohil-investments-crm' || !backup.collections) {
    throw new Error('This backup file is not a valid Gohil Investments CRM backup.')
  }

  const skipOnClient = new Set(['whatsapp_messages'])
  const createOnly = new Set(['audit_logs'])

  const writes = []
  for (const name of BACKUP_COLLECTIONS) {
    if (skipOnClient.has(name)) continue
    const records = backup.collections[name] || []
    records.forEach(record => {
      if (!record?.id || !record.data) return
      writes.push({
        ref: doc(db, name, record.id),
        data: deserialiseBackupValue(record.data),
        createOnly: createOnly.has(name),
      })
    })
  }

  ;(backup.subcollections?.clientDocuments || []).forEach(record => {
    if (!record?.clientId || !record?.id || !record.data) return
    writes.push({
      ref: doc(db, 'clients', record.clientId, 'documents', record.id),
      data: deserialiseBackupValue(record.data),
    })
  })

  if (writes.length === 0) throw new Error('Backup file does not contain any records to restore.')

  const createOnlyWrites = writes.filter(w => w.createOnly)
  const mergeWrites = writes.filter(w => !w.createOnly)
  const fresh = []
  for (let i = 0; i < createOnlyWrites.length; i += 20) {
    const chunk = createOnlyWrites.slice(i, i + 20)
    const snaps = await Promise.all(chunk.map(w => getDoc(w.ref)))
    snaps.forEach((snap, idx) => { if (!snap.exists()) fresh.push(chunk[idx]) })
  }

  await commitBackupWritesInChunks([...mergeWrites, ...fresh], onProgress)
  return mergeWrites.length + fresh.length
}
