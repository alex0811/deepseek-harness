import type { ChatNode } from '../contract/chat-nodes.ts'
import type {
  ChatLocationNodeIndex, ChatNodeStore, ChatTurnProcessPresentation, LiveTurnAnswer,
} from '../contract/snapshot.ts'
import { TURN_PROCESS_INDEPENDENT_KINDS } from '../contract/turn-process.ts'

function nodeTurn(node: ChatNode | undefined): number | undefined {
  const location = node?.location
  return location?.kind === 'turn' || location?.kind === 'step' ? location.turn.turn : undefined
}

function sameLiveAnswer(left: LiveTurnAnswer | null, right: LiveTurnAnswer | null): boolean {
  return left === right || (left !== null && right !== null
    && left.step === right.step
    && left.anchorSeq === right.anchorSeq)
}

function samePresentation(
  left: ChatTurnProcessPresentation | undefined,
  right: ChatTurnProcessPresentation | undefined,
): boolean {
  return left === right || (left !== undefined && right !== undefined
    && left.spec === right.spec
    && left.turn === right.turn
    && left.turnClosed === right.turnClosed
    && left.hasExternalProcess === right.hasExternalProcess
    && left.compactAnswer === right.compactAnswer
    && sameLiveAnswer(left.liveAnswer, right.liveAnswer))
}

/**
 * Trailing Assistant step of an open Turn: the step holding the provisional
 * answer while the Turn runs. Used as the fold's upper bound, so process the
 * model has already finished collapses as it is produced instead of only once
 * the Turn closes; the trailing step itself stays visible.
 * @param keys - ordered Chat Node keys of the Turn.
 * @param nodes - current Chat Node store.
 * @returns the provisional answer, or null before any Assistant step exists.
 */
function trailingAnswer(keys: readonly string[], nodes: ChatNodeStore): LiveTurnAnswer | null {
  let trailing: ChatNode<'assistant-step'> | undefined
  for (const key of keys) {
    const node = nodes.get(key) as ChatNode | undefined
    if (node?.kind !== 'assistant-step') continue
    if (trailing === undefined || node.data.step > trailing.data.step) trailing = node
  }
  if (trailing === undefined) return null
  return { step: trailing.data.step, anchorSeq: trailing.anchorSeq }
}

function derivePresentation(
  turn: number,
  locations: ChatLocationNodeIndex,
  nodes: ChatNodeStore,
): ChatTurnProcessPresentation | undefined {
  const keys = locations.getTurn(turn)
  const control = keys
    .map(key => nodes.get(key) as ChatNode | undefined)
    .find((node): node is ChatNode<'turn-process'> => node?.kind === 'turn-process')
  if (control === undefined) return undefined

  const spec = control.data
  const location = control.location
  if (location.kind !== 'turn' && location.kind !== 'step') return undefined
  const turnClosed = location.turn.status === 'closed'
  const liveAnswer = turnClosed ? null : trailingAnswer(keys, nodes)
  // One effective answer boundary: the finalized answer on a closed Turn, and
  // the trailing step while it runs. A closed Turn therefore keeps the exact
  // process range it published before.
  const answerAnchorSeq = spec.answerAnchorSeq ?? liveAnswer?.anchorSeq ?? null
  const answerStep = spec.answerStep ?? liveAnswer?.step ?? null
  let openingHumanAnchor: number | undefined
  for (const key of keys) {
    const node = nodes.get(key) as ChatNode | undefined
    if ((node?.kind === 'user' || node?.kind === 'steering')
      && node.anchorSeq < spec.controlAnchorSeq) {
      openingHumanAnchor = Math.min(openingHumanAnchor ?? node.anchorSeq, node.anchorSeq)
    }
  }

  let hasExternalProcess = false
  let compactAnswer = true
  for (const key of keys) {
    const node = nodes.get(key) as ChatNode | undefined
    if (node === undefined || node.kind === 'turn-process') continue
    if ((node.kind === 'user' || node.kind === 'steering')
      && (openingHumanAnchor === undefined || node.anchorSeq > openingHumanAnchor)
      && (answerAnchorSeq === null || node.anchorSeq < answerAnchorSeq)) {
      compactAnswer = false
    }
    if (TURN_PROCESS_INDEPENDENT_KINDS.has(node.kind)
      || node.anchorSeq < spec.processStartSeq
      || (answerAnchorSeq !== null && node.anchorSeq >= answerAnchorSeq)) continue
    if (node.kind !== 'assistant-step' || answerStep === null || node.data.step !== answerStep) {
      hasExternalProcess = true
    }
  }
  return {
    turn,
    spec,
    turnClosed,
    hasExternalProcess,
    compactAnswer,
    liveAnswer,
  }
}

/** Mutable projection of cross-Node process layout facts by Turn. */
export class ChatTurnProcessProjector {
  private presentations = new Map<number, ChatTurnProcessPresentation>()

  /**
   * Read the retained process presentation for a Node's Turn.
   * @param node - Current Chat Node.
   * @returns The Turn's process presentation, when present.
   */
  get(node: ChatNode | undefined): ChatTurnProcessPresentation | undefined {
    const turn = nodeTurn(node)
    return turn === undefined ? undefined : this.presentations.get(turn)
  }

  /**
   * Replace every projected Turn.
   * @param order - visible Chat Node order.
   * @param locations - current Chat Location index.
   * @param nodes - current Chat Node store.
   * @returns Turns whose process presentation changed.
   */
  replace(
    order: readonly string[],
    locations: ChatLocationNodeIndex,
    nodes: ChatNodeStore,
  ): ReadonlySet<number> {
    const turns = new Set<number>()
    for (const key of order) {
      const turn = nodeTurn(nodes.get(key) as ChatNode | undefined)
      if (turn !== undefined) turns.add(turn)
    }
    const changed = new Set<number>()
    for (const turn of new Set([...this.presentations.keys(), ...turns])) {
      if (this.set(turn, turns.has(turn) ? derivePresentation(turn, locations, nodes) : undefined)) {
        changed.add(turn)
      }
    }
    return changed
  }

  /**
   * Recompute selected Turns after incremental Node changes.
   * @param turns - affected Turn numbers.
   * @param locations - current Chat Location index.
   * @param nodes - current Chat Node store.
   * @returns Turns whose process presentation changed.
   */
  update(
    turns: ReadonlySet<number>,
    locations: ChatLocationNodeIndex,
    nodes: ChatNodeStore,
  ): ReadonlySet<number> {
    const changed = new Set<number>()
    for (const turn of turns) {
      if (this.set(turn, derivePresentation(turn, locations, nodes))) changed.add(turn)
    }
    return changed
  }

  private set(turn: number, next: ChatTurnProcessPresentation | undefined): boolean {
    const current = this.presentations.get(turn)
    if (samePresentation(current, next)) return false
    if (next === undefined) this.presentations.delete(turn)
    else this.presentations.set(turn, next)
    return true
  }
}
