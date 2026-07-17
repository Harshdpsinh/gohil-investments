import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

const COMMISSION_REMINDER_ID = 41001

export async function scheduleMonthlyCommissionReminder() {
  if (!Capacitor.isNativePlatform()) return false

  const currentPermission = await LocalNotifications.checkPermissions()
  const permission = currentPermission.display === 'prompt'
    ? await LocalNotifications.requestPermissions()
    : currentPermission
  if (permission.display !== 'granted') return false

  const pending = await LocalNotifications.getPending()
  if (pending.notifications.some(item => item.id === COMMISSION_REMINDER_ID)) return true

  await LocalNotifications.schedule({
    notifications: [{
      id: COMMISSION_REMINDER_ID,
      title: 'Upload commission statement',
      body: 'Upload this month’s commission PDF or Excel file and reconcile client payouts.',
      schedule: {
        on: { day: 1, hour: 10, minute: 0 },
        repeats: true,
        allowWhileIdle: true,
      },
      extra: { route: '/commission-reconciliation' },
    }],
  })
  return true
}

export function listenForCommissionReminder(openReconciliation) {
  if (!Capacitor.isNativePlatform()) return () => {}
  let listenerHandle
  LocalNotifications.addListener('localNotificationActionPerformed', event => {
    if (event.notification?.extra?.route === '/commission-reconciliation') openReconciliation()
  }).then(handle => { listenerHandle = handle })
  return () => listenerHandle?.remove()
}
