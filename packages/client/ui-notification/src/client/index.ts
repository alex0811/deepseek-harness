/**
 * Turn reminders, browser half: watch the unified Session status and, when a
 * top-level Session stops running or starts waiting for the user, deliver the
 * chime and system notification the preferences allow. The package also
 * registers its own General-settings row, which owns the preferences and the
 * browser-notification permission the system channel needs.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
// Type-only: pulls the Session Controller service that names the reminded Session.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the unified Session status source (ctx.uiSession).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the settings-namespace scope service (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { NOTIFICATION_SETTINGS_NAMESPACE, type NotificationSettings } from '../notification-settings.ts'
import { AttentionDetector } from './attention.ts'
import { createReminderChannels, type ReminderPermission } from './channels.ts'
import { en, zh, type NotificationKey } from './locales.ts'
import { NotificationRow, type NotificationRowInjected } from './NotificationRow.tsx'
import { NotificationPreferences } from './preferences.ts'
import { ReminderPolicy, reminderSubject } from './reminder.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The reminder row's copy and the banners' text. */
    notification: NotificationKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'notification'

/** Required services: the row's seat, Session labels, copy, Session status, and the preference scope. */
export const inject = ['slots', 'sessions', 'locale', 'uiSession', 'settingsScope']

/**
 * Client plugin body: the reminder watcher and its Settings row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-notification: dictionaries')
  const channels = createReminderChannels()
  const preferences = new NotificationPreferences(
    ctx.settingsScope.bind<NotificationSettings>({ namespace: NOTIFICATION_SETTINGS_NAMESPACE }),
  )
  const policy = new ReminderPolicy(preferences.value, channels, ctx.locale.bind(NS))
  const detector = new AttentionDetector()

  const observe = (): void => {
    const summaries = ctx.sessions.list.getSnapshot().byId
    for (const event of detector.observe(ctx.uiSession.sessionStatus.getSnapshot())) {
      const subject = reminderSubject(event, summaries[event.sessionId])
      if (subject === undefined) continue
      policy.deliver(event, subject)
    }
  }
  ctx.effect(() => {
    const dispose = ctx.uiSession.sessionStatus.subscribe(observe)
    return () => { dispose() }
  }, 'ui-notification: Session status reminders')

  const permission = createSnapshotStore<ReminderPermission>(channels.permission())
  const refreshPermission = (): void => {
    const current = channels.permission()
    if (permission.getSnapshot() !== current) permission.set(current)
  }
  // The permission is granted outside this page (a browser prompt or the site
  // settings), so it is re-read whenever the user comes back to the window.
  ctx.effect(() => {
    const listener = (): void => { refreshPermission() }
    window.addEventListener('focus', listener)
    document.addEventListener('visibilitychange', listener)
    return () => {
      window.removeEventListener('focus', listener)
      document.removeEventListener('visibilitychange', listener)
    }
  }, 'ui-notification: notification permission refresh')

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'notification',
    order: 13,
    locale: NS,
    inject: (): NotificationRowInjected => ({
      hooks: { preferences: preferences.value, reminderPermission: permission },
      setPreference: (field, value) => { preferences.set(field, value) },
      requestPermission: () => { void channels.requestPermission().then(refreshPermission) },
    }),
  }, NotificationRow))
}
