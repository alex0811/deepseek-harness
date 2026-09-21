/** Host half: the durable reminder namespace and its defaults. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATION_SETTINGS_NAMESPACE, apply } from '../src/index.ts'

/** In-memory settings provider: the durable document without a file. */
class MemorySettings extends SettingsProvider {
  readonly writable = true
  /** @returns an empty stored document. */
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  /**
   * @param _ns - namespace being written.
   * @param _section - accepted section.
   * @returns immediate settlement; nothing is persisted.
   */
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

/** A host context with the memory settings provider mounted. */
async function bench() {
  const ctx = new Context()
  await ctx.plugin(MemorySettings).await()
  await ctx.plugin({ apply }).await()
  return ctx
}

describe('ui-notification host', () => {
  it('registers the reminder namespace with its composition defaults', async () => {
    const ctx = await bench()
    expect(ctx.settings.get(NOTIFICATION_SETTINGS_NAMESPACE)).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
    await ctx.settings.update(NOTIFICATION_SETTINGS_NAMESPACE, { sound: false })
    expect(ctx.settings.get(NOTIFICATION_SETTINGS_NAMESPACE)).toMatchObject({ sound: false })
  })

  it('rejects a value the reminder schema does not admit', async () => {
    const ctx = await bench()
    await expect(ctx.settings.update(NOTIFICATION_SETTINGS_NAMESPACE, { sound: 'loud' }))
      .rejects.toThrow()
  })

  it('leaves the context usable when no settings provider is mounted', () => {
    const ctx = new Context()
    expect(() => { apply(ctx) }).not.toThrow()
  })
})
