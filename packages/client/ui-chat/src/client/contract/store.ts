/** Chat-owned per-Session view state. */

/** Tool call identity as carried by Chat nodes. */
export type ToolCallId = string

/**
 * Stored answer step meaning "expanded for the whole live Turn". A running
 * Turn's trailing step advances as the model works, so keying the expansion by
 * that step would re-collapse the reader's manual expansion at every step
 * boundary; this value keeps it open until the reader collapses it.
 */
export const LIVE_TURN_PROCESS_OPEN = -1

/** One manually expanded Turn answer generation. */
export interface TurnProcessViewEntry {
  readonly turn: number
  /** Answer step the expansion was requested for, or {@link LIVE_TURN_PROCESS_OPEN}. */
  readonly answerStep: number
}

/** Per-Session state shared only by the Chat view and details surface. */
export interface ChatStoreState {
  turnProcesses: TurnProcessViewEntry[]
}
