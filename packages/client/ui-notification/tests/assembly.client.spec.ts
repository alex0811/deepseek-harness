// @vitest-environment jsdom
/**
 * Turn reminders inside the assembled web client: the General-settings row,
 * both reminder triggers over the real Session status source, the subagent
 * filter, the foreground preference, and the browser-permission control.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-settings/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ok, type RemoteMock } from '@deepseek-ai/dsh-remote-mock'
import { createClientTest, type TestClient, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
// Type-only: the LocaleNamespaceMap merge the row's locale seat reads.
import type {} from '../src/client/index.ts'
import {
  DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATION_SETTINGS_NAMESPACE, NotificationSettingsSchema,
  type NotificationSettings,
} from '../src/notification-settings.ts'
import { NotificationRow, type NotificationRowInjected } from '../src/client/NotificationRow.tsx'
import { en } from '../src/client/locales.ts'

const it = createClientTest({ roster: webApp })
const EVENTS = '$events'
/** The whole roster's first boot pays the cold module transform of every plugin package. */
const COLD_BOOT_TIMEOUT_MS = 60_000
/** Dictionary namespace this plugin owns; its General row declares it. */
const NS = 'notification'

/** Branded identity for a fixture Session. */
const sid = (value: string): SessionId => value as SessionId

/** Banner constructor double recording what the client asked the page to show. */
class FakeNotification {
  static permission: NotificationPermission = 'granted'
  static requestPermission = vi.fn(async () => FakeNotification.permission)
  static readonly posted: { title: string; options: NotificationOptions | undefined }[] = []

  constructor(title: string, options?: NotificationOptions) {
    FakeNotification.posted.push({ title, options })
  }
}

/** AudioContext double: one entry per scheduled note. */
class FakeAudioContext {
  static readonly notes: number[] = []

  readonly currentTime = 0
  readonly destination = {}
  readonly state = 'running' as AudioContextState

  /** @returns a resolved resume; the double never suspends. */
  resume(): Promise<void> { return Promise.resolve() }

  /** @returns an oscillator recording the frequency it was started at. */
  createOscillator() {
    const frequency = { value: 0 }
    return {
      type: 'sine',
      frequency,
      onended: undefined as (() => void) | undefined,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: () => { FakeAudioContext.notes.push(frequency.value) },
    }
  }

  /** @returns a gain node with the envelope methods the chime drives. */
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
  }
}

/** The Host view of the reminder namespace, as the settings mirror reads it. */
function settingsView(value: Partial<NotificationSettings>, revision = 0): SettingsNamespaceView {
  return {
    ns: NOTIFICATION_SETTINGS_NAMESPACE,
    // The Remote wire serializes nested Schema values before the client rehydrates them.
    schema: JSON.parse(JSON.stringify(NotificationSettingsSchema.toJSON())) as SettingsNamespaceView['schema'],
    value: { ...DEFAULT_NOTIFICATION_SETTINGS, ...value },
    applies: 'live',
    secrets: [],
    revision,
  }
}

/** Boot the assembled client with the reminder namespace exposed and delivered while unfocused. */
async function bench(
  mock: RemoteMock,
  start: () => Promise<TestClient>,
  overrides: Partial<NotificationSettings> = {},
): Promise<TestClient> {
  mock.remote.settings.describe.mockResolvedValue(ok({
    writable: true, hasDocument: false, namespaces: [settingsView(overrides)],
  }))
  const client = await start()
  await client.ctx.settingsScope.describe().ensure()
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  return client
}

/** Deliver one Remote event the way the Host forwards it: an emit frame on the `$events` stream. */
async function emit(mock: RemoteMock, event: string, ...args: unknown[]): Promise<void> {
  mock.streams.push(EVENTS, { type: 'emit', event, args })
  await mock.streams.drained(EVENTS)
}

/** Add one idle Session to the client list at the given origin. */
async function addSession(
  mock: RemoteMock,
  id: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await emit(mock, 'api-session/added', {
    sessionId: sid(id), updatedAt: 1, running: false, blank: false, ...extra,
  })
}

/** Take one Session through a running turn and back to idle, waiting for each status to land. */
async function runTurn(client: TestClient, mock: RemoteMock, id: string): Promise<void> {
  await emit(mock, 'api-session/status', sid(id), true)
  await vi.waitFor(() => {
    expect(client.ctx.uiSession.sessionStatus.getSnapshot().get(sid(id))?.running).toBe(true)
  })
  await emit(mock, 'api-session/status', sid(id), false)
}

/** This plugin's row registration in the assembled Settings section. */
function rowFace(client: TestClient): NotificationRowInjected {
  const entry = client.ctx.slots.entries('settings.general.item')
    .find(candidate => candidate.locale === NS && candidate.component === NotificationRow)
  if (entry === undefined) throw new Error('ui-notification: the reminder row is not registered')
  return (entry.inject as unknown as () => NotificationRowInjected)()
}

beforeEach(() => {
  FakeNotification.permission = 'granted'
  FakeNotification.requestPermission.mockClear()
  FakeNotification.posted.length = 0
  FakeAudioContext.notes.length = 0
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true, writable: true, value: FakeNotification,
  })
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true, writable: true, value: FakeAudioContext,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'Notification')
  Reflect.deleteProperty(globalThis, 'AudioContext')
})

describe('ui-notification in the assembled client', () => {
  it('registers its reminder row with the live preferences and permission', async ({ mock, start }) => {
    const client = await bench(mock, start, { sound: false })
    const face = rowFace(client)
    expect(face.hooks.preferences.getSnapshot()).toMatchObject({ sound: false, foreground: false })
    expect(face.hooks.reminderPermission.getSnapshot()).toBe('granted')
  }, COLD_BOOT_TIMEOUT_MS)

  it('chimes and notifies for a finished task, and stays quiet for a subagent', async ({ mock, start }) => {
    const client = await bench(mock, start)
    await addSession(mock, 'task-1')
    await addSession(mock, 'child-1', { parentSessionId: sid('task-1'), origin: 'subagent' })
    await runTurn(client, mock, 'task-1')
    await runTurn(client, mock, 'child-1')
    await vi.waitFor(() => { expect(FakeNotification.posted).toHaveLength(1) })
    expect(FakeNotification.posted[0]).toEqual({
      title: 'task-1',
      options: { body: en['reminder.message.completed'], tag: 'dsh-session-task-1' },
    })
    expect(FakeAudioContext.notes).toEqual([880, 1318.5])
  }, COLD_BOOT_TIMEOUT_MS)

  it('notifies when a Session waits for the user', async ({ mock, start }) => {
    const client = await bench(mock, start)
    await addSession(mock, 'task-1')
    const publish = client.ctx.uiSession.registerPendingInteraction(() => 1)
    publish({ key: 'approval-1', kind: 'approval', sessionId: sid('task-1') }, async () => {})
    await vi.waitFor(() => { expect(FakeNotification.posted).toHaveLength(1) })
    expect(FakeNotification.posted[0]?.options?.body).toBe(en['reminder.message.awaitingInput'])
  }, COLD_BOOT_TIMEOUT_MS)

  it('delivers while the window is focused once the preference says so', async ({ mock, start }) => {
    const client = await bench(mock, start, { foreground: true })
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    await addSession(mock, 'task-1')
    await runTurn(client, mock, 'task-1')
    await vi.waitFor(() => { expect(FakeNotification.posted).toHaveLength(1) })
  }, COLD_BOOT_TIMEOUT_MS)

  it('stays quiet on a trigger the preferences turned off', async ({ mock, start }) => {
    const client = await bench(mock, start, { onComplete: false })
    await addSession(mock, 'task-1')
    await runTurn(client, mock, 'task-1')
    await vi.waitFor(() => {
      expect(client.ctx.uiSession.sessionStatus.getSnapshot().get(sid('task-1'))?.running).toBe(false)
    })
    expect(FakeNotification.posted).toEqual([])
    expect(FakeAudioContext.notes).toEqual([])
  }, COLD_BOOT_TIMEOUT_MS)

  it('asks for the browser permission and republishes the answer', async ({ mock, start }) => {
    FakeNotification.permission = 'default'
    const client = await bench(mock, start)
    const face = rowFace(client)
    expect(face.hooks.reminderPermission.getSnapshot()).toBe('default')
    FakeNotification.permission = 'granted'
    face.requestPermission()
    await vi.waitFor(() => { expect(FakeNotification.requestPermission).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(face.hooks.reminderPermission.getSnapshot()).toBe('granted') })
    // Coming back to the window re-reads a permission granted outside the page.
    FakeNotification.permission = 'denied'
    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => { expect(face.hooks.reminderPermission.getSnapshot()).toBe('denied') })
    // An unchanged answer republishes nothing.
    window.dispatchEvent(new Event('focus'))
    expect(face.hooks.reminderPermission.getSnapshot()).toBe('denied')
  }, COLD_BOOT_TIMEOUT_MS)

  it('writes a preference through the row and adopts the accepted section', async ({ mock, start }) => {
    const client = await bench(mock, start)
    mock.remote.settings.mutate.mockResolvedValue(ok(settingsView({ sound: false }, 1)))
    const face = rowFace(client)
    face.setPreference('sound', false)
    await vi.waitFor(() => {
      expect(mock.remote.settings.mutate).toHaveBeenCalledWith(
        NOTIFICATION_SETTINGS_NAMESPACE,
        [{ op: 'set', path: ['sound'], value: false }],
        expect.anything(),
      )
    })
    await vi.waitFor(() => { expect(face.hooks.preferences.getSnapshot().sound).toBe(false) })
  }, COLD_BOOT_TIMEOUT_MS)

  it('ignores a transition for a Session the list does not carry', async ({ mock, start }) => {
    await bench(mock, start)
    await emit(mock, 'api-session/status', sid('ghost'), true)
    await emit(mock, 'api-session/status', sid('ghost'), false)
    expect(FakeNotification.posted).toEqual([])
    expect(FakeAudioContext.notes).toEqual([])
  }, COLD_BOOT_TIMEOUT_MS)
})
