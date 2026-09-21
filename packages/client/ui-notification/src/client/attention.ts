/**
 * Reminder-worthy Session transitions derived from the unified UI status
 * snapshot. The detector keeps only the previous observation per Session, so
 * it reports each transition exactly once however the subscription frames
 * arrive.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'

/** What a Session did that the user may want to hear about. */
export type AttentionKind = 'completed' | 'awaiting-input'

/** One observed transition for one Session. */
export interface AttentionEvent {
  /** Transition kind; `awaiting-input` outranks `completed` in one step. */
  readonly kind: AttentionKind
  /** Session the transition belongs to. */
  readonly sessionId: SessionId
}

/** Last observed status of one Session. */
interface Observation {
  /** Whether the Session was running when last observed. */
  running: boolean
  /** Identity of the pending interaction when last observed. */
  pending: string | undefined
}

/**
 * Fold published status snapshots into transitions. A Session's first
 * observation is a baseline: a Session already idle when the page loads, or
 * one that a reconnect re-publishes, never reminds.
 */
export class AttentionDetector {
  private readonly observed = new Map<SessionId, Observation>()

  /**
   * Fold one published status snapshot.
   * @param snapshot - current unified Session status.
   * @returns the transitions since the previous call, in snapshot order. A
   * Session that both stopped running and published a pending interaction in
   * the same step reports only `awaiting-input`, which already asks the user
   * to act; a request replacing another reports again, because its new key is
   * a new thing to answer. Sessions absent from the snapshot drop their
   * observation.
   */
  observe(snapshot: SessionStatusSnapshot): readonly AttentionEvent[] {
    const events: AttentionEvent[] = []
    for (const [sessionId, status] of snapshot) {
      const running = status.running === true
      const pending = status.pendingInteraction?.key
      const previous = this.observed.get(sessionId)
      this.observed.set(sessionId, { running, pending })
      if (previous === undefined) continue
      if (pending !== undefined && pending !== previous.pending) {
        events.push({ kind: 'awaiting-input', sessionId })
      } else if (!running && previous.running) {
        events.push({ kind: 'completed', sessionId })
      }
    }
    for (const sessionId of this.observed.keys()) {
      if (!snapshot.has(sessionId)) this.observed.delete(sessionId)
    }
    return events
  }
}
