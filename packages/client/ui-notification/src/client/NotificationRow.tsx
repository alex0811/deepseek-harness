/**
 * Reminder preference row registered into the General section item slot: the
 * two reminder triggers, the two delivery channels, and the focus override,
 * plus the browser-notification permission the system channel needs. The row
 * belongs to this package because the reminder feature owns its settings
 * surface.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NotificationSettings } from '../notification-settings.ts'
import type { ReminderPermission } from './channels.ts'
import type { NotificationKey } from './locales.ts'
import type { NotificationPreferenceField } from './preferences.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './NotificationRow.module.css'

/** Registration-side reminder face. */
export interface NotificationRowInjected {
  hooks: {
    /** Live reminder preferences bound as usePreferences. */
    preferences: SnapshotStore<NotificationSettings>
    /** System-notification permission bound as useReminderPermission. */
    reminderPermission: SnapshotStore<ReminderPermission>
  }
  /** Persist one reminder preference. */
  setPreference: (field: NotificationPreferenceField, value: boolean) => void
  /** Ask the browser for notification permission. */
  requestPermission: () => void
}

/** Full Settings-row props. */
export type NotificationRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'notification'>
  & InjectFace<NotificationRowInjected>

/** Switches in render order, each one preference field with its visible label. */
const SWITCHES: readonly { readonly field: NotificationPreferenceField; readonly label: NotificationKey }[] = [
  { field: 'onComplete', label: 'reminder.onComplete' },
  { field: 'onAwaitingInput', label: 'reminder.onAwaitingInput' },
  { field: 'sound', label: 'reminder.sound' },
  { field: 'systemNotification', label: 'reminder.systemNotification' },
  { field: 'foreground', label: 'reminder.foreground' },
]

/**
 * Render the reminder preference row.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function NotificationRow({
  t, usePreferences, useReminderPermission, setPreference, requestPermission,
}: NotificationRowProps) {
  const preferences = usePreferences(value => value)
  const permission = useReminderPermission(value => value)
  // A page with no Notification API has nothing for the system channel to
  // post through, so its switch is not offered rather than silently inert.
  const switches = permission === 'unsupported'
    ? SWITCHES.filter(entry => entry.field !== 'systemNotification')
    : SWITCHES
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('reminder.title')}</div>
        <div className={css.desc}>{t('reminder.description')}</div>
      </div>
      <div className={css.controls}>
        {switches.map(({ field, label }) => (
          <div key={field} className={css.item}>
            <span className={css.label}>{t(label)}</span>
            <Switch
              checked={preferences[field]}
              onChange={(next) => { setPreference(field, next) }}
              label={t(label)}
            />
          </div>
        ))}
        {permission === 'default' && (
          <Button variant="outline" size="sm" onClick={requestPermission}>
            {t('reminder.grant')}
          </Button>
        )}
        {permission === 'denied' && <div className={css.hint}>{t('reminder.denied')}</div>}
      </div>
    </div>
  )
}
