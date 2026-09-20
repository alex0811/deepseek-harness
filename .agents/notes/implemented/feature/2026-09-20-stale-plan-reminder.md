# Agent Note: Stale-plan reminder

Status: implemented

English | [中文](2026-09-20-stale-plan-reminder.zh.md)

## Problem

The to-do dock renders the `todos` projection, which is exactly the newest `todo_write` snapshot in the Session log — never an inference from completed work. A model that writes a plan once and then executes for a long stretch therefore leaves the panel showing finished work as open, with no signal that the list is behind.

Recorded Sessions show how large that stretch is. In one Session the model wrote its plan, ran 147 further tool calls across 29 minutes, implemented the change, wrote tests, ran five acceptance criteria, and reported success — while the plan still read `2 completed · 1 in_progress · 8 pending`. Another Session wrote a plan once and then ran 189 tool calls without rewriting it. A user reading the panel at that point sees a task list that never advances, while the transcript shows the work finishing.

The model-facing tool description already says to mark a completed item the moment it is done and not to batch completions; long executions show that instruction alone is not enough, and nothing else in the harness asks the model to return to its list.

## Decision

`@deepseek-ai/dsh-stale-plan-reminder` is an advisory guard beside `repeat-tool-reminder` in the `guard/` group. It reads the `todos` projection on every `tools/post-execute` — the same value the dock renders, so the guard holds no second copy of the list — and counts completed tool calls since that plan value last changed. The projection publishes a new array on every `todo/write` and `null` on a `turn/start`, so a reference change is exactly "the model published a new list" and restarts the count at zero.

When the count lands on a configured threshold and the plan still has unfinished items, the guard attaches one reminder to the post-execute decision's `additionalContexts`. The reminder states how many tool calls have passed, lists the open items (up to `previewItems`, head-truncated, with a trailing count), and asks for the complete updated list. It never blocks, rewrites, or delays a call, and it always delegates through `next()` so a later listener keeps its own veto.

Both config fields are required: `thresholds` (the tool-call counts that fire, ascending and unique) and `previewItems` (how many open items one reminder quotes). The `dsh` base bundle enables the guard at `[10, 25, 60]` with `previewItems: 5`, so an execution like the ones above draws three nudges instead of none.

The guard stays silent when the `todos` unit is unregistered (a preset without `tool-todo` has no list to maintain), when the plan is fully completed, and for direct `ctx.tools.execute` callers that have no owning agent. Progress lives in a `WeakMap<Session, Progress>`, so Sessions count independently, nothing is persisted, and a resumed Session starts fresh.

The tool description still owns the update contract; the guard adds only a trigger. Guidance stays out of prompt sections per the [prompt-ownership decision](../architecture/2026-07-05-prompt-variables-and-tool-guidance-ownership.md), which this decision leaves standing.

## Alternatives considered

**Completing items from the transcript.** Rejected: the log carries no per-item completion signal — a `bash` result or a file write does not say which plan item it finished. Any inference would be a guess written into a durable, model-visible record.

**A UI-only staleness hint** ("updated 12 minutes ago"). Rejected as the primary fix: it makes the staleness legible but leaves the plan wrong, and the recorded failures are minutes to tens of minutes long. The panel showing an age instead of a usable plan is still a plan the user cannot act on.

**Blocking until the list is updated.** Rejected: `PostToolDecision` supports blocking, but refusing a model's next call over bookkeeping turns a display gap into a failed execution, and the guard cannot know that the model's own ordering is wrong.

**A stronger tool description or system-prompt sentence.** Rejected as the fix: the description's "do not batch completions" is already explicit, and the observed failures happen inside a single turn where the model simply stops returning to the list. Prompt text alone has no trigger, which is what a counting guard supplies.

**Folding `todo/write` events inside the guard instead of reading the projection.** Rejected: a second fold could disagree with the dock's value after a restore, a retirement, or a cache-seeded Session — the one state a user compares against the panel must stay single-sourced.

**Reminding on a wall-clock interval.** Rejected: elapsed time says nothing about progress; a model waiting on a background job has run no new tool calls, and a model streaming a long tool has run one. Completed tool calls are the unit the plan itself is written in.

## Consequences

Reminders are retained context for the owning agent — bounded by `previewItems`, an 80-character item cap, and the configured thresholds, which stop past the largest one until the model writes the list again. A model that rewrites identical content restarts the count, because the guard detects publication rather than change, and a rewrite is the moment the reminder was asking for. The guard is advisory: a model that ignores all three nudges still leaves a stale list, and the panel still cannot show work the model never recorded.

The guard also cannot verify the work it is asking about, adds a `tools/post-execute` listener to every deployment that mounts the base bundle, and stays per-Session in memory, so a process restart loses only its counter and never a plan. Unmounting the row restores the previous behavior exactly.

## Testing

- `packages/guard/stale-plan-reminder/tests/stale-plan-reminder.spec.ts` drives the real agent loop with a scripted mock adapter: exact reminder text and source, threshold cadence, restart on a plan rewrite, silence for completed lists, unregistered units and agent-less calls, the preview cap and item truncation, per-Session counters, delegation through `next()`, the blocked-decision fold, and fail-loud config validation.
- `packages/guard/stale-plan-reminder/tests/loader-composition.spec.ts` boots the plugin through the real Loader from a `cordis.yml`, so the config fields are proven to drive behavior and a missing field fails at load.
- `snapshots/session/stale-plan-reminder/` replays a committed Session that pins the model-visible reminder: a plan write, ten tool calls, the nudge on the tenth, and the final answer.
