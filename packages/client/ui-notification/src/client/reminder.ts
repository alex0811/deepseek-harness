/**
 * Reminder delivery: decide whether one observed transition reaches the user,
 * then drive the chime and the system notification.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { NotificationSettings } from '../notification-settings.ts'
import type { AttentionEvent } from './attention.ts'
import type { ReminderChannels } from './channels.ts'
import type { NotificationKey } from './locales.ts'

/** One transition's user-facing label and reminder copy. */
export interface ReminderSubject {
  /** Session label the banner is titled with. */
  readonly title: string
  /** Copy key carrying what the Session is waiting for, or that it finished. */
  readonly message: NotificationKey
}

/** One Session as the reminder filter reads it. */
export interface ReminderCandidate {
  /** Coarse durable origin; a subagent Session runs under a task the user already tracks. */
  readonly origin?: 'subagent'
  /** User-facing Session label. */
  readonly displayTitle: string
}

/**
 * Resolve the banner subject for one observed transition.
 * @param event - observed Session transition.
 * @param candidate - the Session's catalog row, absent when the catalog no longer carries it.
 * @returns the subject to deliver, or undefined for a Session that must not remind.
 */
export function reminderSubject(
  event: AttentionEvent,
  candidate: ReminderCandidate | undefined,
): ReminderSubject | undefined {
  if (candidate === undefined || candidate.origin === 'subagent') return undefined
  return {
    title: candidate.displayTitle,
    message: event.kind === 'completed'
      ? 'reminder.message.completed'
      : 'reminder.message.awaitingInput',
  }
}

/**
 * Apply the preferences to one transition.
 *
 * Delivery is suppressed while the window is visible and focused unless the
 * user asked otherwise: a reminder for work the user is watching interrupts
 * without adding information.
 */
export class ReminderPolicy {
  /**
   * @param preferences - live reminder preferences.
   * @param channels - page capabilities to deliver through.
   * @param t - copy resolver for this plugin's dictionary.
   */
  constructor(
    private readonly preferences: SnapshotStore<NotificationSettings>,
    private readonly channels: ReminderChannels,
    private readonly t: (key: NotificationKey) => string,
  ) {}

  /**
   * Deliver one reminder where the preferences allow it.
   * @param event - observed Session transition.
   * @param subject - Session label and reminder copy for the event.
   */
  deliver(event: AttentionEvent, subject: ReminderSubject): void {
    const settings = this.preferences.getSnapshot()
    if (!(event.kind === 'completed' ? settings.onComplete : settings.onAwaitingInput)) return
    if (!settings.foreground && this.channels.foreground()) return
    if (settings.sound) this.channels.chime()
    if (settings.systemNotification) {
      this.channels.post(subject.title, this.t(subject.message), `dsh-session-${event.sessionId}`)
    }
  }
}
