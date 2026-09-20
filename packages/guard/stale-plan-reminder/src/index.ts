/**
 * Advisory stale-plan guard: it enriches post-execute decisions with a
 * model-visible reminder when an agent keeps working without updating its
 * to-do list. The list is a whole-value projection of the latest `todo/write`
 * snapshot, so a plan written once and never revised leaves the dock showing
 * work that already finished; this guard closes that gap by telling the model
 * how many tool calls have run since the last write and which items are still
 * open. It never blocks, rewrites, or delays a call. Configuration and
 * delivery semantics live in the package README.
 * @module @deepseek-ai/dsh-stale-plan-reminder
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo'
import type { PostToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
// Type-only: resolves the required ctx.sessionProjections service declaration.
import type {} from '@deepseek-ai/dsh-session-projection'

export const name = 'stale-plan-reminder'
export const inject = ['sessionProjections']

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply`. Misconfiguration fails loud at plugin load —
 * an empty `thresholds` list, a non-integer, a value below 1, a duplicate, or
 * a non-positive `previewItems` throws, never a silent fallback.
 *
 * Both fields are required because both are deployment choices with no
 * universally correct value: the cadence trades reminder tokens against how
 * long a stale plan stays on screen, and the preview bounds the reminder's
 * data-dependent text.
 */
export interface Config {
  /**
   * Completed tool calls since the plan last changed that trigger a reminder;
   * ascending, unique, integers >= 1. Reminders fire at exactly these counts,
   * so a run longer than the largest threshold draws no further nudge until
   * the model writes the list again.
   */
  thresholds: number[]
  /** Unfinished items quoted in one reminder; further items collapse into a trailing count. */
  previewItems: number
}

export const Config: z<Config> = z.object({
  thresholds: z.array(z.number()).required(),
  previewItems: z.number().required(),
})

/**
 * The `{kind:'plugin'}` source stamped on every reminder this guard injects —
 * the label keeps the message from rendering as a user prompt in derived
 * history.
 */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'stale-plan-reminder' }

/** Longest item line quoted in a reminder; longer content is head-truncated with `…`. */
const ITEM_PREVIEW_CHARS = 80

/** One session's counter: the plan value it counts from and the tool calls completed since. */
interface Progress {
  /** Exact plan reference this counter started from; a new reference means the model wrote a new list. */
  plan: TodoItem[] | null | undefined
  /** Completed tool calls since that reference was published. */
  sincePlan: number
}

/**
 * Validate `thresholds` per the fail-loud contract and return them sorted
 * ascending, so the emitted counts read in the order they fire.
 * @param values - configured thresholds.
 * @returns the validated thresholds in ascending order.
 */
function validateThresholds(values: number[]): number[] {
  if (values.length === 0) {
    throw new Error('stale-plan-reminder: `thresholds` must not be empty')
  }
  for (const value of values) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`stale-plan-reminder: invalid threshold ${String(value)} — every threshold must be an integer >= 1`)
    }
  }
  if (new Set(values).size !== values.length) {
    throw new Error('stale-plan-reminder: `thresholds` must not contain duplicates')
  }
  return [...values].sort((left, right) => left - right)
}

/**
 * Validate `previewItems` per the fail-loud contract.
 * @param value - configured unfinished-item preview count.
 * @returns the validated count.
 */
function validatePreviewItems(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`stale-plan-reminder: invalid previewItems ${String(value)} — must be an integer >= 1`)
  }
  return value
}

/** Head-truncate one item line so a long task name cannot carry unbounded text into the next request. */
function previewItem(content: string): string {
  return content.length <= ITEM_PREVIEW_CHARS ? content : `${content.slice(0, ITEM_PREVIEW_CHARS - 1)}…`
}

/**
 * Compose the reminder: the staleness fact, the open items the model can act
 * on, and the exact update the guard is asking for.
 * @param sincePlan - completed tool calls since the last plan write.
 * @param unfinished - open items in list order.
 * @param previewItems - how many of them to quote.
 * @returns the model-facing reminder text.
 */
function reminderText(sincePlan: number, unfinished: readonly TodoItem[], previewItems: number): string {
  const shown = unfinished.slice(0, previewItems)
  const lines = [
    `Your to-do list has not been updated for ${String(sincePlan)} tool calls and still shows `
    + `${String(unfinished.length)} unfinished item(s):`,
    ...shown.map(item => `- ${item.status === 'in_progress' ? '(in progress) ' : ''}${previewItem(item.content)}`),
    ...unfinished.length > shown.length ? [`- …and ${String(unfinished.length - shown.length)} more`] : [],
    'If any of them is finished, send the COMPLETE updated list with todo_write now: mark finished '
    + 'items completed as they finish (do not batch completions), and keep the items you are '
    + 'actively working on marked in_progress.',
  ]
  return lines.join('\n')
}

/**
 * Prepend the guard's reminder while preserving every downstream context's
 * source and metadata.
 * @param ours - this guard's reminder.
 * @param theirs - contexts already attached by later listeners.
 * @returns the combined context list.
 */
function prependContext(ours: UserMessage, theirs: UserMessage[] | undefined): UserMessage[] {
  return [ours, ...theirs ?? []]
}

/**
 * Install the guard's listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}; every field is re-checked fail-loud here.
 */
export function apply(ctx: Context, config: Config): void {
  const thresholds = validateThresholds(config.thresholds)
  const previewItems = validatePreviewItems(config.previewItems)
  const progress = new WeakMap<Session, Progress>()

  /**
   * Advance one agent's counter and return the reminder to deliver, if this
   * execution lands on a configured threshold. The plan is read from the
   * projection registry — the same value the dock renders — so the guard never
   * keeps a second copy of the list.
   */
  function observe(exec: ToolExecution): UserMessage | undefined {
    // A direct `ctx.tools.execute()` caller has no model to remind and no plan owner.
    const agent = exec.agent
    if (agent === undefined) return undefined
    const session = agent.session
    // `undefined` means the to-do unit is unregistered (capability absent, e.g.
    // a preset without tool-todo): there is no list to keep current.
    const plan = ctx.sessionProjections.stateOf(session, 'todos')
    const previous = progress.get(session)
    // A new plan reference is a `todo/write` (or a `turn/start` retirement to
    // null): the model just published a list, so counting restarts here.
    const sincePlan = previous !== undefined && previous.plan === plan ? previous.sincePlan + 1 : 0
    progress.set(session, { plan, sincePlan })
    if (!thresholds.includes(sincePlan)) return undefined
    const unfinished = (plan ?? []).filter(item => item.status !== 'completed')
    if (unfinished.length === 0) return undefined
    return createUserMessage({
      content: [{ type: 'text', text: reminderText(sincePlan, unfinished, previewItems) }],
      source: {
        ...PLUGIN_SOURCE,
        form: 'notice',
        summary: `${String(unfinished.length)} unfinished × ${String(sincePlan)} tool calls`,
      },
    })
  }

  // Observe-and-enrich, never veto: count first (state advances regardless of
  // the downstream outcome), DELEGATE so a later listener can still block or
  // replace, then fold the reminder onto whatever came back — additionalContexts
  // rides both decision variants, so a blocked call still gets the nudge.
  ctx.on('tools/post-execute', async (exec, _result, next): Promise<PostToolDecision> => {
    const reminder = observe(exec)
    const downstream = await next()
    if (reminder === undefined) return downstream
    return {
      ...downstream,
      additionalContexts: prependContext(reminder, downstream.additionalContexts),
    }
  })
}
