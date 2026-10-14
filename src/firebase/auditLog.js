import { auth } from './config'
import { createAuditLog } from './firestore'

/** Best-effort. A failed log must not block the action the admin just took. */
export async function logAdminAction({ action, entityType, entityId = '', summary = '' } = {}) {
  try {
    const user = auth.currentUser
    await createAuditLog({
      action,
      entityType,
      entityId: String(entityId || ''),
      summary,
      userId: user?.uid || '',
      userEmail: user?.email || '',
    })
  } catch (err) {
    console.warn('Audit log was not saved:', err?.message || err)
  }
}
