// @vitest-environment jsdom
/** Browser reminder channels: permission, banner, chime, and foreground state. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReminderChannels } from '../src/client/channels.ts'

/** Banner constructor double recording what the page asked it to show. */
class FakeNotification {
  static permission: NotificationPermission = 'granted'
  static readonly posted: { title: string; options: NotificationOptions | undefined }[] = []
  static requestPermission = vi.fn(async () => FakeNotification.permission)

  constructor(title: string, options?: NotificationOptions) {
    FakeNotification.posted.push({ title, options })
  }
}

/** One scheduled oscillator note. */
interface Note {
  frequency: number
  started: number
  stopped: number
}

/** AudioContext double recording scheduled notes, resume calls, and forced failures. */
class FakeAudioContext {
  static readonly notes: Note[] = []
  static resumeCalls = 0
  static failConstruction = false
  static rejectResume = false
  static state: AudioContextState = 'running'

  readonly currentTime = 10
  readonly destination = {}
  readonly state = FakeAudioContext.state

  constructor() {
    if (FakeAudioContext.failConstruction) throw new Error('no audio device')
  }

  resume(): Promise<void> {
    FakeAudioContext.resumeCalls += 1
    return FakeAudioContext.rejectResume
      ? Promise.reject(new Error('still blocked'))
      : Promise.resolve()
  }

  createOscillator() {
    const note: Note = { frequency: 0, started: 0, stopped: 0 }
    const frequency = { value: 0 }
    const oscillator = {
      type: 'sine',
      frequency,
      onended: undefined as (() => void) | undefined,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: (at: number) => { note.started = at; note.frequency = frequency.value },
      stop: (at: number) => {
        note.stopped = at
        FakeAudioContext.notes.push(note)
        // The browser fires this once the note drains, after the channel has
        // assigned the handler; a microtask is the smallest stand-in for that
        // later turn of the event loop.
        queueMicrotask(() => { oscillator.onended?.() })
      },
    }
    return oscillator
  }

  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
  }
}

/** Install the browser doubles for one spec, removing them again afterwards. */
function installBrowser(options: {
  notification?: boolean
  audio?: boolean
  permission?: NotificationPermission
} = {}): () => void {
  const globals = globalThis as Record<string, unknown>
  const installed: string[] = []
  const define = (name: string, value: unknown): void => {
    installed.push(name)
    Object.defineProperty(globals, name, { configurable: true, writable: true, value })
  }
  FakeNotification.permission = options.permission ?? 'granted'
  FakeNotification.posted.length = 0
  FakeNotification.requestPermission.mockClear()
  FakeAudioContext.notes.length = 0
  FakeAudioContext.resumeCalls = 0
  FakeAudioContext.failConstruction = false
  FakeAudioContext.rejectResume = false
  FakeAudioContext.state = 'running'
  if (options.notification === false) Reflect.deleteProperty(globals, 'Notification')
  else define('Notification', FakeNotification)
  if (options.audio === false) Reflect.deleteProperty(globals, 'AudioContext')
  else define('AudioContext', FakeAudioContext)
  return () => {
    for (const name of installed) Reflect.deleteProperty(globals, name)
  }
}

afterEach(() => { vi.restoreAllMocks() })

describe('createReminderChannels', () => {
  it('reports unsupported, posts nothing, and asks for nothing without a Notification API', async () => {
    const uninstall = installBrowser({ notification: false })
    const channels = createReminderChannels()
    expect(channels.permission()).toBe('unsupported')
    expect(channels.post('t', 'b', 'tag')).toBe(false)
    await channels.requestPermission()
    uninstall()
  })

  it('reads the live permission and asks the browser for it', async () => {
    const uninstall = installBrowser({ permission: 'default' })
    const channels = createReminderChannels()
    expect(channels.permission()).toBe('default')
    await channels.requestPermission()
    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce()
    uninstall()
  })

  it('records a refused permission request and keeps the previous answer', async () => {
    const uninstall = installBrowser()
    FakeNotification.requestPermission.mockRejectedValueOnce(new Error('dismissed'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await createReminderChannels().requestPermission()
    expect(warn).toHaveBeenCalledWith(
      '[ui-notification] browser refused the notification permission request:', expect.any(Error),
    )
    uninstall()
  })

  it('posts nothing without the permission and the banner with it', () => {
    const uninstall = installBrowser({ permission: 'denied' })
    const channels = createReminderChannels()
    expect(channels.post('Task', 'body', 'tag')).toBe(false)
    expect(FakeNotification.posted).toEqual([])
    FakeNotification.permission = 'granted'
    expect(channels.post('Task', 'body', 'tag')).toBe(true)
    expect(FakeNotification.posted).toEqual([{ title: 'Task', options: { body: 'body', tag: 'tag' } }])
    uninstall()
  })

  it('records a refused banner and reports it as not shown', () => {
    const uninstall = installBrowser()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failing = class extends FakeNotification {
      constructor(title: string, options?: NotificationOptions) {
        super(title, options)
        throw new Error('banner service down')
      }
    }
    Object.defineProperty(globalThis, 'Notification', { configurable: true, writable: true, value: failing })
    expect(createReminderChannels().post('Task', 'body', 'tag')).toBe(false)
    expect(warn).toHaveBeenCalledWith('[ui-notification] browser refused the notification:', expect.any(Error))
    uninstall()
  })

  it('stays silent without an AudioContext and stops probing after the first miss', () => {
    const uninstall = installBrowser({ audio: false })
    const channels = createReminderChannels()
    channels.chime()
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true, writable: true, value: FakeAudioContext,
    })
    channels.chime()
    expect(FakeAudioContext.notes).toEqual([])
    uninstall()
  })

  it('plays the two-note chime once per reminder', async () => {
    const uninstall = installBrowser()
    const channels = createReminderChannels()
    channels.chime()
    channels.chime()
    // Let every scheduled note drain and release its graph.
    await Promise.resolve()
    expect(FakeAudioContext.notes.map(note => note.frequency)).toEqual([880, 1318.5, 880, 1318.5])
    expect(FakeAudioContext.notes[0]!.started).toBe(10)
    expect(FakeAudioContext.notes[1]!.started).toBeCloseTo(10.16)
    expect(FakeAudioContext.resumeCalls).toBe(0)
    uninstall()
  })

  it('resumes a suspended context and records a resume the browser keeps refusing', async () => {
    const uninstall = installBrowser()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    FakeAudioContext.state = 'suspended'
    const channels = createReminderChannels()
    channels.chime()
    expect(FakeAudioContext.resumeCalls).toBe(1)
    FakeAudioContext.rejectResume = true
    channels.chime()
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith('[ui-notification] audio context stayed suspended:', expect.any(Error))
    })
    uninstall()
  })

  it('records a page that cannot construct audio and stops probing', () => {
    const uninstall = installBrowser()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    FakeAudioContext.failConstruction = true
    const channels = createReminderChannels()
    channels.chime()
    expect(warn).toHaveBeenCalledWith('[ui-notification] audio is unavailable on this page:', expect.any(Error))
    FakeAudioContext.failConstruction = false
    channels.chime()
    expect(FakeAudioContext.notes).toEqual([])
    uninstall()
  })

  it('reports the page as foreground only while it is visible and focused', () => {
    const uninstall = installBrowser()
    const channels = createReminderChannels()
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    expect(channels.foreground()).toBe(true)
    focus.mockReturnValue(false)
    expect(channels.foreground()).toBe(false)
    focus.mockReturnValue(true)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    expect(channels.foreground()).toBe(false)
    uninstall()
  })
})
