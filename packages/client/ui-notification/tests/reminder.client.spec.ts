/** Reminder policy: which observed transitions reach the page's channels. */
import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from '../src/notification-settings.ts'
import type { ReminderChannels } from '../src/client/channels.ts'
import { ReminderPolicy, reminderSubject } from '../src/client/reminder.ts'
import { en } from '../src/client/locales.ts'

/** Branded identity for a fixture Session. */
const sid = (value: string): SessionId => value as SessionId

/** Recorded channel calls; the page is unfocused unless a spec says otherwise. */
function channels(focused = false) {
  const chime = vi.fn()
  const post = vi.fn(() => true)
  const face: ReminderChannels = {
    permission: () => 'granted',
    requestPermission: async () => {},
    post,
    chime,
    foreground: () => focused,
  }
  return { face, chime, post }
}

/** A policy over the given preferences and channels. */
function bench(overrides: Partial<NotificationSettings> = {}, focused = false) {
  const preferences = createSnapshotStore<NotificationSettings>({
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...overrides,
  })
  const record = channels(focused)
  const policy = new ReminderPolicy(preferences, record.face, key => en[key])
  return { preferences, policy, ...record }
}

describe('ReminderPolicy', () => {
  it('chimes and posts the finished-task copy for a completed Session', () => {
    const bench1 = bench()
    bench1.policy.deliver({ kind: 'completed', sessionId: sid('a') }, {
      title: 'Fix the parser', message: 'reminder.message.completed',
    })
    expect(bench1.chime).toHaveBeenCalledOnce()
    expect(bench1.post).toHaveBeenCalledWith('Fix the parser', 'Task finished', 'dsh-session-a')
  })

  it('posts the waiting copy for a pending request', () => {
    const bench1 = bench()
    bench1.policy.deliver({ kind: 'awaiting-input', sessionId: sid('a') }, {
      title: 'Fix the parser', message: 'reminder.message.awaitingInput',
    })
    expect(bench1.post).toHaveBeenCalledWith('Fix the parser', 'Waiting for your input or approval', 'dsh-session-a')
  })

  it('stays silent while the window is focused, and delivers when that override is on', () => {
    const focused = bench({}, true)
    focused.policy.deliver({ kind: 'completed', sessionId: sid('a') }, {
      title: 't', message: 'reminder.message.completed',
    })
    expect(focused.chime).not.toHaveBeenCalled()
    expect(focused.post).not.toHaveBeenCalled()

    const overridden = bench({ foreground: true }, true)
    overridden.policy.deliver({ kind: 'completed', sessionId: sid('a') }, {
      title: 't', message: 'reminder.message.completed',
    })
    expect(overridden.chime).toHaveBeenCalledOnce()
    expect(overridden.post).toHaveBeenCalledOnce()
  })

  it('honours each trigger switch independently', () => {
    const onlyWaiting = bench({ onComplete: false })
    onlyWaiting.policy.deliver({ kind: 'completed', sessionId: sid('a') }, {
      title: 't', message: 'reminder.message.completed',
    })
    expect(onlyWaiting.chime).not.toHaveBeenCalled()
    onlyWaiting.policy.deliver({ kind: 'awaiting-input', sessionId: sid('a') }, {
      title: 't', message: 'reminder.message.awaitingInput',
    })
    expect(onlyWaiting.chime).toHaveBeenCalledOnce()

    const onlyFinished = bench({ onAwaitingInput: false })
    onlyFinished.policy.deliver({ kind: 'awaiting-input', sessionId: sid('a') }, {
      title: 't', message: 'reminder.message.awaitingInput',
    })
    expect(onlyFinished.chime).not.toHaveBeenCalled()
  })

  it('honours each delivery channel independently', () => {
    const silent = bench({ sound: false })
    silent.policy.deliver({ kind: 'completed', sessionId: sid('a') }, {
      title: 't', message: 'reminder.message.completed',
    })
    expect(silent.chime).not.toHaveBeenCalled()
    expect(silent.post).toHaveBeenCalledOnce()

    const quiet = bench({ systemNotification: false })
    quiet.policy.deliver({ kind: 'completed', sessionId: sid('a') }, {
      title: 't', message: 'reminder.message.completed',
    })
    expect(quiet.chime).toHaveBeenCalledOnce()
    expect(quiet.post).not.toHaveBeenCalled()
  })

  it('reads the live preferences on every delivery', () => {
    const bench1 = bench()
    bench1.preferences.set({ ...DEFAULT_NOTIFICATION_SETTINGS, sound: false, onComplete: false })
    bench1.policy.deliver({ kind: 'completed', sessionId: sid('a') }, {
      title: 't', message: 'reminder.message.completed',
    })
    expect(bench1.chime).not.toHaveBeenCalled()
  })
})

describe('reminderSubject', () => {
  it('names the Session and its transition outcome', () => {
    const candidate = { displayTitle: 'Fix the parser' }
    expect(reminderSubject({ kind: 'completed', sessionId: sid('a') }, candidate))
      .toEqual({ title: 'Fix the parser', message: 'reminder.message.completed' })
    expect(reminderSubject({ kind: 'awaiting-input', sessionId: sid('a') }, candidate))
      .toEqual({ title: 'Fix the parser', message: 'reminder.message.awaitingInput' })
  })

  it('skips a subagent Session and one the catalog no longer carries', () => {
    expect(reminderSubject(
      { kind: 'completed', sessionId: sid('a') },
      { displayTitle: 'child', origin: 'subagent' },
    )).toBeUndefined()
    expect(reminderSubject({ kind: 'completed', sessionId: sid('a') }, undefined)).toBeUndefined()
  })
})
