// @vitest-environment jsdom
/** Reminder Settings row: switch state, writes, and the permission prompt. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
// Type-only: the LocaleNamespaceMap merge the row's locale seat reads.
import type {} from '../src/client/index.ts'
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from '../src/notification-settings.ts'
import { en, zh } from '../src/client/locales.ts'
import type { ReminderPermission } from '../src/client/channels.ts'
import type { NotificationPreferenceField } from '../src/client/preferences.ts'
import { NotificationRow, type NotificationRowProps } from '../src/client/NotificationRow.tsx'

afterEach(cleanup)

// Seats this row does not read, supplied as the framework would bind them.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']
const usePanelInfo = bindSnapshotSelector(createSnapshotStore({ activePanelId: null }))
const useSessions = bindSnapshotSelector(createSnapshotStore<SessionListState>({
  ids: [], byId: {}, phase: 'ready', subagentsByParent: {}, jobsBySession: {},
}))
const useWorkspaces = bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
  items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
}))
const useSessionStatus = bindSnapshotSelector(createSnapshotStore<SessionStatusSnapshot>(new Map()))

/** Mount the row over live preference and permission stores. */
function mount(
  permission: ReminderPermission = 'granted',
  dictionary: typeof en | typeof zh = en,
  overrides: Partial<NotificationSettings> = {},
) {
  const preferences = createSnapshotStore<NotificationSettings>({ ...DEFAULT_NOTIFICATION_SETTINGS, ...overrides })
  const permissionStore = createSnapshotStore<ReminderPermission>(permission)
  const setPreference = vi.fn((field: NotificationPreferenceField, value: boolean) => {
    preferences.update((draft) => { draft[field] = value })
  })
  const requestPermission = vi.fn(() => { permissionStore.set('granted') })
  const props: NotificationRowProps = {
    usePanelInfo,
    useSessions,
    useSessionStatus,
    useWorkspaces,
    useSessionRetainInfo: () => undefined,
    useResource,
    usePreferences: bindSnapshotSelector(preferences),
    useReminderPermission: bindSnapshotSelector(permissionStore),
    setPreference,
    requestPermission,
    t: makeTranslate(dictionary),
  }
  render(<NotificationRow {...props} />)
  return { setPreference, requestPermission, preferences, permissionStore }
}

/** The switch carrying one visible label. */
function switchFor(label: string): HTMLElement {
  return screen.getByRole('switch', { name: label })
}

describe('NotificationRow', () => {
  it('renders every preference switch with its persisted state', () => {
    mount('granted', en, { sound: false, foreground: true })
    expect(screen.getByText('Task reminders')).toBeDefined()
    expect(switchFor('When a task finishes').getAttribute('aria-checked')).toBe('true')
    expect(switchFor('When it waits for me').getAttribute('aria-checked')).toBe('true')
    expect(switchFor('Sound').getAttribute('aria-checked')).toBe('false')
    expect(switchFor('System notification').getAttribute('aria-checked')).toBe('true')
    expect(switchFor('Also remind while focused').getAttribute('aria-checked')).toBe('true')
  })

  it('writes the flipped value for each switch', () => {
    const { setPreference } = mount()
    fireEvent.click(switchFor('Sound'))
    expect(setPreference).toHaveBeenCalledWith('sound', false)
    fireEvent.click(switchFor('When it waits for me'))
    expect(setPreference).toHaveBeenCalledWith('onAwaitingInput', false)
    expect(switchFor('Sound').getAttribute('aria-checked')).toBe('false')
  })

  it('offers the permission prompt only while the browser has not answered', () => {
    const { requestPermission } = mount('default')
    fireEvent.click(screen.getByRole('button', { name: 'Allow browser notifications' }))
    expect(requestPermission).toHaveBeenCalledOnce()
    // The granted answer retires the prompt.
    expect(screen.queryByRole('button', { name: 'Allow browser notifications' })).toBeNull()
  })

  it('explains a refused permission and keeps the switches usable', () => {
    mount('denied')
    expect(screen.getByText(/allow them in your browser settings/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Allow browser notifications' })).toBeNull()
    expect(switchFor('System notification')).toBeDefined()
  })

  it('shows no permission chrome on a page without the Notification API', () => {
    mount('unsupported')
    expect(screen.queryByRole('button', { name: 'Allow browser notifications' })).toBeNull()
    expect(screen.queryByText(/browser settings/)).toBeNull()
    // The system channel has nothing to post through here, so its switch is gone.
    expect(screen.queryByRole('switch', { name: 'System notification' })).toBeNull()
    expect(switchFor('Sound')).toBeDefined()
  })

  it('renders the shipped Chinese copy', () => {
    mount('granted', zh)
    expect(screen.getByText('任务提醒')).toBeDefined()
    expect(switchFor('提示音')).toBeDefined()
  })
})
