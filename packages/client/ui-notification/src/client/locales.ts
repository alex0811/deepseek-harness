/** `notification` namespace dictionaries: the reminder row's copy and the banners' text. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'reminder.title': '任务提醒',
  'reminder.description': '任务跑完或需要你操作时提醒你，窗口在前台时默认不打扰',
  'reminder.onComplete': '任务完成时',
  'reminder.onAwaitingInput': '等待我操作时',
  'reminder.sound': '提示音',
  'reminder.systemNotification': '系统通知',
  'reminder.foreground': '窗口在前台时也提醒',
  'reminder.grant': '允许浏览器通知',
  'reminder.denied': '浏览器已拒绝通知，请在浏览器设置中允许后重试',
  'reminder.message.completed': '任务已完成',
  'reminder.message.awaitingInput': '等待你的输入或确认',
} satisfies Record<string, string>

/** The notification namespace key union. */
export type NotificationKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'reminder.title': 'Task reminders',
  'reminder.description': 'Remind you when a task finishes or needs you; quiet while this window is focused',
  'reminder.onComplete': 'When a task finishes',
  'reminder.onAwaitingInput': 'When it waits for me',
  'reminder.sound': 'Sound',
  'reminder.systemNotification': 'System notification',
  'reminder.foreground': 'Also remind while focused',
  'reminder.grant': 'Allow browser notifications',
  'reminder.denied': 'Notifications are blocked; allow them in your browser settings, then try again',
  'reminder.message.completed': 'Task finished',
  'reminder.message.awaitingInput': 'Waiting for your input or approval',
} satisfies Record<NotificationKey, string>
