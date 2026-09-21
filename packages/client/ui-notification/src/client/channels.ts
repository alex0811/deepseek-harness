/**
 * Browser capabilities behind the reminders: the system-notification
 * permission and banner, the chime, and whether the page currently holds the
 * user's attention. Every read is lazy, so a page that never reminds pays
 * nothing.
 */

/** System-notification permission reported where the page has no Notification API. */
export type ReminderPermission = NotificationPermission | 'unsupported'

/** The reminder capabilities one page provides. */
export interface ReminderChannels {
  /** @returns the current system-notification permission. */
  permission(): ReminderPermission
  /**
   * Ask the browser for notification permission. Must run inside a user
   * gesture; failures are recorded and swallowed because the permission simply
   * stays as it was.
   * @returns settlement after the browser answered.
   */
  requestPermission(): Promise<void>
  /**
   * Show one system notification.
   * @param title - banner title.
   * @param body - banner body.
   * @param tag - replacement key, so repeated reminders for one Session collapse.
   * @returns whether the browser accepted the banner.
   */
  post(title: string, body: string, tag: string): boolean
  /** Play the reminder chime where the page can carry audio. */
  chime(): void
  /** @returns whether the page is visible and focused. */
  foreground(): boolean
}

/** Chime notes: a rising fifth, each note a short sine with a fast decay. */
const CHIME_NOTES: readonly { readonly delay: number; readonly frequency: number }[] = [
  { delay: 0, frequency: 880 },
  { delay: 0.16, frequency: 1318.5 },
]
/** Seconds a single chime note sounds. */
const CHIME_NOTE_SECONDS = 0.2
/** Gain the chime peaks at. */
const CHIME_PEAK_GAIN = 0.2

/**
 * Read the page's Notification constructor.
 * @returns the constructor, or undefined where the page exposes none.
 */
function notificationApi(): typeof Notification | undefined {
  // Electron and every current browser define it; a page in an embedded
  // webview may not, and `typeof` is the only safe probe for a global.
  return typeof globalThis.Notification === 'function' ? globalThis.Notification : undefined
}

/**
 * Read the page's AudioContext constructor, including the prefixed Safari name.
 * @returns the constructor, or undefined where the page exposes none.
 */
function audioApi(): typeof AudioContext | undefined {
  const vendor = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  return vendor.AudioContext ?? vendor.webkitAudioContext
}

/**
 * Schedule the chime on one audio context.
 * @param context - running or resumable context to play through.
 */
function scheduleChime(context: AudioContext): void {
  const start = context.currentTime
  for (const { delay, frequency } of CHIME_NOTES) {
    const noteStart = start + delay
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, noteStart)
    gain.gain.exponentialRampToValueAtTime(CHIME_PEAK_GAIN, noteStart + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + CHIME_NOTE_SECONDS)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(noteStart)
    oscillator.stop(noteStart + CHIME_NOTE_SECONDS)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
    }
  }
}

/**
 * Create the channels over this page's browser APIs.
 * @returns the reminder channels, each degrading to a no-op where the page
 * lacks the capability.
 */
export function createReminderChannels(): ReminderChannels {
  let context: AudioContext | undefined
  let audioUnavailable = false
  return {
    permission: () => notificationApi()?.permission ?? 'unsupported',
    requestPermission: async () => {
      const api = notificationApi()
      if (api === undefined) return
      try {
        await api.requestPermission()
      } catch (error) {
        console.warn('[ui-notification] browser refused the notification permission request:', error)
      }
    },
    post: (title, body, tag) => {
      const api = notificationApi()
      if (api === undefined || api.permission !== 'granted') return false
      try {
        new api(title, { body, tag })
        return true
      } catch (error) {
        // A page may hold the permission and still refuse the banner (an
        // embedded webview, or a platform service that is down).
        console.warn('[ui-notification] browser refused the notification:', error)
        return false
      }
    },
    chime: () => {
      if (audioUnavailable) return
      const api = audioApi()
      if (api === undefined) {
        audioUnavailable = true
        return
      }
      try {
        context ??= new api()
      } catch (error) {
        audioUnavailable = true
        console.warn('[ui-notification] audio is unavailable on this page:', error)
        return
      }
      if (context.state === 'suspended') {
        void context.resume().catch((error: unknown) => {
          console.warn('[ui-notification] audio context stayed suspended:', error)
        })
      }
      scheduleChime(context)
    },
    foreground: () => document.visibilityState === 'visible' && document.hasFocus(),
  }
}
