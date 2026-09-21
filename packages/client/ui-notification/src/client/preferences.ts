/**
 * Live reminder preferences: a browser mirror of the Host user-settings
 * section. The Settings row and the reminder policy read one snapshot, so a
 * toggle applies to the next reminder without a reload.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings,
} from '../notification-settings.ts'

/** One durable reminder preference field. */
export type NotificationPreferenceField = keyof NotificationSettings

/** Every preference field, in schema order; the adoption guard compares them all. */
const FIELDS: readonly NotificationPreferenceField[] = [
  'onComplete', 'onAwaitingInput', 'sound', 'systemNotification', 'foreground',
]

/** Browser mirror of the durable reminder preferences. */
export class NotificationPreferences {
  /** Reactive preferences; defaults apply until the Host section arrives. */
  readonly value: SnapshotStore<NotificationSettings> = createSnapshotStore({ ...DEFAULT_NOTIFICATION_SETTINGS })

  /**
   * @param host - durable reminder settings scope.
   */
  constructor(private readonly host: SettingsScope<NotificationSettings>) {
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Publish one explicit user choice and persist it.
   * @param field - preference field the toggle owns.
   * @param value - requested boolean.
   */
  set(field: NotificationPreferenceField, value: boolean): void {
    this.value.update((draft) => { draft[field] = value })
    void this.host.set(field, value)
  }

  /**
   * Adopt the latest accepted Host section without writing it back. The
   * section is compared field by field: the scope notifies on every settings
   * read, and republishing an equal section would re-render the row.
   */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined) return
    const current = this.value.getSnapshot()
    if (FIELDS.every(field => current[field] === section[field])) return
    this.value.set({ ...section })
  }
}
