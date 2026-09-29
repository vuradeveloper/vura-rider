// ─────────────────────────────────────────────────────────────────────────────
// Phone notifications for ride milestones.
//
// IMPLEMENTED BELOW with FCM push. The "stub" note just below is kept only as the
// history of why a local-notification implementation was abandoned.
// ─────────────────────────────────────────────────────────────────────────────
// Phone notifications (FCM push): asks for permission, creates the Android
// channels and registers this phone with the server (POST
// /api/notifications/device) so ride events arrive even while the app is
// backgrounded or CLOSED — where no socket and no JavaScript exist.
// Requires android/app/google-services.json (in place) + @capacitor/push-notifications.
import { Capacitor } from '@capacitor/core'
import { apiFetch } from './backend'

/** Android channel ids MUST match the ids the server targets (services/notify.ts). */
const CHANNELS = [
  { id: 'vura_ride_offers', name: 'Ride offers', description: 'Incoming ride requests', importance: 5 },
  { id: 'ride_updates', name: 'Ride updates', description: 'Driver and trip status changes', importance: 4 },
  { id: 'vura_trip_progress', name: 'Trip progress', description: 'Ongoing trip progress', importance: 2 },
]

let started = false

export function pushAvailable(): boolean {
  return Capacitor.isNativePlatform()
}

/**
 * Asks for the notification permission, creates the channels and registers this
 * phone with the server so ride events arrive while the app is backgrounded or
 * closed. Idempotent — safe on every launch.
 */
export async function initPushNotifications(): Promise<boolean> {
  if (!pushAvailable() || started) return started
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')

    // Channels FIRST: on Android 8+ a notification whose channel id does not exist
    // is dropped silently, so a wrong/missing channel looks exactly like "push is
    // broken". This is the #1 cause of notifications never appearing.
    for (const c of CHANNELS) {
      await PushNotifications.createChannel({
        id: c.id,
        name: c.name,
        description: c.description,
        importance: c.importance,
        visibility: 1,
        sound: 'default',
        vibration: true,
      }).catch(() => undefined)
    }

    const perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') {
      console.warn('[push] notification permission not granted — in-app alerts only')
      return false
    }

    await PushNotifications.addListener('registration', async (token) => {
      try {
        await apiFetch('/api/notifications/device', {
          method: 'POST',
          body: JSON.stringify({ token: token.value, platform: 'android' }),
        })
        console.log('[push] device registered')
      } catch (err) {
        // Not fatal: the plugin re-fires registration on the next launch/resume.
        console.warn('[push] token upload failed', err)
      }
    })
    await PushNotifications.addListener('registrationError', (err) => {
      console.warn('[push] registration failed', err)
    })

    // App in the FOREGROUND: the OS draws nothing for us, the UI shows its banner.
    await PushNotifications.addListener('pushNotificationReceived', (n: any) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('vura:push', { detail: n?.data || {} }))
      }
    })

    // Tapping the tray notification (cold start or resume) re-runs the shell's
    // restore, so the app navigates from the SERVER's state, not a stale payload.
    await PushNotifications.addListener('pushNotificationActionPerformed', () => {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('vura:reconnect'))
    })

    await PushNotifications.register()
    started = true
    return true
  } catch (err) {
    console.warn('[push] init failed', err)
    return false
  }
}

// The old stub note (kept for history):
//
// STATUS: stubbed on purpose. The intended implementation uses
// @capacitor/local-notifications (a SYSTEM notification needs no FCM), but that
// plugin's Android module requires a JDK 21 toolchain and this build machine only
// has JDK 17 — including it broke the whole APK build:
//
//   Could not create task ':capacitor-local-notifications:compileDebugJavaWithJavac'
//     > Cannot find a Java installation matching: {languageVersion=21}
//
// Everything else about the ride is untouched: the screens still show "Driver
// accepted" / "Driver has arrived" live, and they now also POLL the server so a
// missed event can never leave the rider stuck on "waiting for a driver".
//
// To switch the phone notification on: either install a JDK 21 toolchain and
// re-add the plugin, or use FCM push (needs android/app/google-services.json)
// which also covers a CLOSED app — then replace the body of notifyRide() below.
// ─────────────────────────────────────────────────────────────────────────────

export async function notifyRide(title: string, body: string): Promise<void> {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('vura:push', { detail: { title, body, source: 'app' } }))
}

