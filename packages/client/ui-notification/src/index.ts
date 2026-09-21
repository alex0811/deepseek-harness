/**
 * Turn reminders, node half: registers the durable preference section the
 * browser half's Settings row writes through. The reminders themselves are
 * page-local — only the preferences reach the Host document.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { NOTIFICATION_SETTINGS_NAMESPACE, NotificationSettingsSchema } from './notification-settings.ts'

export {
  DEFAULT_NOTIFICATION_SETTINGS, FOREGROUND_FIELD, NOTIFICATION_SETTINGS_NAMESPACE, NotificationSettingsSchema,
  ON_AWAITING_INPUT_FIELD, ON_COMPLETE_FIELD, SOUND_FIELD, SYSTEM_NOTIFICATION_FIELD,
  type NotificationSettings,
} from './notification-settings.ts'

/**
 * Register the durable reminder settings section when a provider exists.
 * @param ctx - host plugin context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      NOTIFICATION_SETTINGS_NAMESPACE,
      NotificationSettingsSchema,
    )
  })
}
