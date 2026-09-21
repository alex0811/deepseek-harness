/**
 * Expansion preference for the composer's plan strip. The strip occupies the
 * Session-scoped `conversation.input.dock`, so a Session-scoped store would
 * re-collapse it on every Session switch; this one value serves every Session
 * and survives a page reload.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** localStorage identity of the plan strip's expansion preference. */
const TODO_EXPANSION_STORE_KEY = 'dsh.conversation.todo-expanded'

/**
 * Create the plan strip's browser-wide expansion preference.
 * @returns a persisted source seeded collapsed (the strip's default posture).
 */
export function createTodoExpansionStore(): SnapshotStore<boolean> {
  return createSnapshotStore(false, { persist: { name: TODO_EXPANSION_STORE_KEY } })
}
