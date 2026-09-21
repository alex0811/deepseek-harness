/** Reminder preference mirror over the settings-namespace scope seam. */
import { describe, expect, it } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from '../src/notification-settings.ts'
import { NotificationPreferences } from '../src/client/preferences.ts'

/** A mirror over a stubbed Host scope. */
function bench() {
  const host = stubSettingsScope<NotificationSettings>()
  const preferences = new NotificationPreferences(host.scope)
  return { host, preferences }
}

describe('NotificationPreferences', () => {
  it('starts on the defaults until the Host section arrives', () => {
    const { preferences } = bench()
    expect(preferences.value.getSnapshot()).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
  })

  it('adopts an accepted Host section', () => {
    const { host, preferences } = bench()
    host.publish({ status: 'ready', value: { ...DEFAULT_NOTIFICATION_SETTINGS, sound: false, foreground: true } })
    expect(preferences.value.getSnapshot()).toMatchObject({ sound: false, foreground: true })
  })

  it('keeps the published snapshot when an equal section is published again', () => {
    const { host, preferences } = bench()
    const section = { ...DEFAULT_NOTIFICATION_SETTINGS, onComplete: false }
    host.publish({ status: 'ready', value: section })
    const adopted = preferences.value.getSnapshot()
    host.publish({ status: 'ready', value: { ...section } })
    expect(preferences.value.getSnapshot()).toBe(adopted)
  })

  it('ignores a scope that has not accepted a section yet', () => {
    const { host, preferences } = bench()
    const before = preferences.value.getSnapshot()
    host.publish({ status: 'unavailable' })
    expect(preferences.value.getSnapshot()).toBe(before)
  })

  it('publishes one explicit choice and persists it', () => {
    const { host, preferences } = bench()
    preferences.set('onAwaitingInput', false)
    expect(preferences.value.getSnapshot().onAwaitingInput).toBe(false)
    expect(host.set).toHaveBeenCalledWith('onAwaitingInput', false)
  })
})
