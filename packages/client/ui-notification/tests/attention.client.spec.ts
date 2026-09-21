/** Transition detection over the unified Session status snapshot. */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { AttentionDetector } from '../src/client/attention.ts'

/** Branded identity for a fixture Session. */
const sid = (value: string): SessionId => value as SessionId

/** A pending interaction carrying only the identity the detector reads. */
function pendingOf(key: string): NonNullable<SessionStatus['pendingInteraction']> {
  return { key, kind: 'approval', sessionId: sid('s') } as unknown as NonNullable<SessionStatus['pendingInteraction']>
}

/** One status entry; `running` absent models a Session with no established baseline. */
function statusOf(running: boolean | undefined, pending?: string): SessionStatus {
  return {
    running,
    pendingInteraction: pending === undefined ? undefined : pendingOf(pending),
    completionUnread: false,
  }
}

/** Status snapshot from `[id, status]` pairs. */
function snapshotOf(entries: readonly (readonly [string, SessionStatus])[]): SessionStatusSnapshot {
  return new Map(entries.map(([id, status]) => [sid(id), status]))
}

describe('AttentionDetector', () => {
  it('reports nothing for the first observation of a Session, running or already idle', () => {
    const detector = new AttentionDetector()
    expect(detector.observe(snapshotOf([['a', statusOf(true)], ['b', statusOf(false)]]))).toEqual([])
    expect(detector.observe(snapshotOf([['a', statusOf(true)], ['b', statusOf(false)]]))).toEqual([])
  })

  it('reports a completed Session on the running-to-idle step and never repeats it', () => {
    const detector = new AttentionDetector()
    detector.observe(snapshotOf([['a', statusOf(true)]]))
    expect(detector.observe(snapshotOf([['a', statusOf(false)]])))
      .toEqual([{ kind: 'completed', sessionId: sid('a') }])
    expect(detector.observe(snapshotOf([['a', statusOf(false)]]))).toEqual([])
  })

  it('reports a Session that starts waiting for the user', () => {
    const detector = new AttentionDetector()
    detector.observe(snapshotOf([['a', statusOf(true)]]))
    expect(detector.observe(snapshotOf([['a', statusOf(true, 'approval-1')]])))
      .toEqual([{ kind: 'awaiting-input', sessionId: sid('a') }])
  })

  it('reports a replacement request as a new wait', () => {
    const detector = new AttentionDetector()
    detector.observe(snapshotOf([['a', statusOf(true, 'approval-1')]]))
    expect(detector.observe(snapshotOf([['a', statusOf(true, 'approval-2')]])))
      .toEqual([{ kind: 'awaiting-input', sessionId: sid('a') }])
    expect(detector.observe(snapshotOf([['a', statusOf(true, 'approval-2')]]))).toEqual([])
  })

  it('reports only the wait when one step both stops and publishes a request', () => {
    const detector = new AttentionDetector()
    detector.observe(snapshotOf([['a', statusOf(true)]]))
    expect(detector.observe(snapshotOf([['a', statusOf(false, 'question-1')]])))
      .toEqual([{ kind: 'awaiting-input', sessionId: sid('a') }])
  })

  it('waits for a running baseline before reporting, so a reconnected idle Session stays silent', () => {
    const detector = new AttentionDetector()
    expect(detector.observe(snapshotOf([['a', statusOf(undefined)]]))).toEqual([])
    expect(detector.observe(snapshotOf([['a', statusOf(false)]]))).toEqual([])
  })

  it('treats a Session that leaves the snapshot as unobserved', () => {
    const detector = new AttentionDetector()
    detector.observe(snapshotOf([['a', statusOf(true)]]))
    expect(detector.observe(snapshotOf([]))).toEqual([])
    // Reappearance is a fresh baseline: the gap hid whatever happened in it.
    expect(detector.observe(snapshotOf([['a', statusOf(false)]]))).toEqual([])
  })

  it('reports one event per Session in snapshot order', () => {
    const detector = new AttentionDetector()
    detector.observe(snapshotOf([['a', statusOf(true)], ['b', statusOf(true)], ['c', statusOf(true)]]))
    expect(detector.observe(snapshotOf([
      ['a', statusOf(false)], ['b', statusOf(true, 'question-1')], ['c', statusOf(true)],
    ]))).toEqual([
      { kind: 'completed', sessionId: sid('a') },
      { kind: 'awaiting-input', sessionId: sid('b') },
    ])
  })
})
