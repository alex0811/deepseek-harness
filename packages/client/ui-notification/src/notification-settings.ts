/**
 * Reminder preferences shared by the Host schema owner and the browser scope:
 * both sides validate the same section, so the browser default and the
 * composition default cannot drift.
 */
import z from '@deepseek-ai/schemastery'

/** Settings namespace owning the reminder preferences. */
export const NOTIFICATION_SETTINGS_NAMESPACE = 'ui-notification'

/** Field carrying the reminder on a finished task. */
export const ON_COMPLETE_FIELD = 'onComplete'
/** Field carrying the reminder on a Session waiting for the user. */
export const ON_AWAITING_INPUT_FIELD = 'onAwaitingInput'
/** Field carrying the reminder chime. */
export const SOUND_FIELD = 'sound'
/** Field carrying the system notification. */
export const SYSTEM_NOTIFICATION_FIELD = 'systemNotification'
/** Field carrying delivery while the window holds focus. */
export const FOREGROUND_FIELD = 'foreground'

/** Durable reminder preferences. */
export interface NotificationSettings {
  /** Remind when a top-level Session stops running. */
  onComplete: boolean
  /** Remind when a top-level Session publishes a pending interaction. */
  onAwaitingInput: boolean
  /** Play the chime alongside the reminder. */
  sound: boolean
  /** Post a system notification alongside the reminder. */
  systemNotification: boolean
  /** Deliver even while this window is visible and focused. */
  foreground: boolean
}

/**
 * Reminder defaults: both triggers and both delivery channels on, delivered
 * only while the user is looking elsewhere — a reminder for work the user is
 * watching is noise.
 */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  onComplete: true,
  onAwaitingInput: true,
  sound: true,
  systemNotification: true,
  foreground: false,
}

/** Durable reminder schema; also the wire envelope the browser scope validates against. */
export const NotificationSettingsSchema: z<NotificationSettings> = z.object({
  [ON_COMPLETE_FIELD]: z.boolean().default(DEFAULT_NOTIFICATION_SETTINGS.onComplete),
  [ON_AWAITING_INPUT_FIELD]: z.boolean().default(DEFAULT_NOTIFICATION_SETTINGS.onAwaitingInput),
  [SOUND_FIELD]: z.boolean().default(DEFAULT_NOTIFICATION_SETTINGS.sound),
  [SYSTEM_NOTIFICATION_FIELD]: z.boolean().default(DEFAULT_NOTIFICATION_SETTINGS.systemNotification),
  [FOREGROUND_FIELD]: z.boolean().default(DEFAULT_NOTIFICATION_SETTINGS.foreground),
})
