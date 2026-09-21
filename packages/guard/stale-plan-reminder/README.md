---
description: "Advisory plan-hygiene guard that reminds the model to update its to-do list while it keeps working, for users and maintainers choosing, configuring, or debugging the plugin."
kind: "package-reference"
---

# @deepseek-ai/dsh-stale-plan-reminder

English | [中文](README.zh.md)

## Summary

This package keeps an agent's to-do list current with the work it has done. The list is a whole-value snapshot, so a model that writes a plan once and then works for a long time leaves finished items checked as open. After a configured number of tool calls without a plan write, the guard reports the open items and asks for the complete update. It never blocks a call, counts each Session separately, and restarts on a plan rewrite or a new turn. The base bundle enables it at 10, 25, and 60 tool calls.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin when agents execute long stretches of work against a plan and the plan is expected to track that work. There is nothing to wire: the `dsh` base bundle already runs it, and the defaults work for most sessions — tune the cadence and the quoted preview below when a deployment wants a nudge sooner, later, or shorter.

### When to choose it

Choose it when a Session's plan is user-visible and should follow the work: without the guard, the plan advances only when the model happens to rewrite it, which in recorded sessions can be hundreds of tool calls apart. Avoid it when the plan is deliberately a fixed opening statement, when the model maintains the list on its own cadence, or when extra reminder tokens in a long execution cost more than a stale list does.

### Setting the cadence and preview

```yaml
- name: '@deepseek-ai/dsh-stale-plan-reminder'
  config:
    thresholds: [10, 25, 60]   # completed tool calls since the last plan write
    previewItems: 5            # open items quoted in one reminder
```

| Field | Required | Meaning |
|---|---|---|
| `thresholds` | yes | Completed tool calls since the plan last changed that trigger a reminder; ascending, unique, integers >= 1. Past the largest count the reminder repeats every `largest` calls |
| `previewItems` | yes | Unfinished items quoted in one reminder; the rest collapse into a trailing count |

Both fields are required — cadence and preview length are deployment choices with no universally correct value. Invalid configuration fails at startup with a clear error — an empty list, a count below 1, a duplicate, or a non-positive preview — never a silent change of behavior. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-stale-plan-reminder) documents every accepted value.

### What you get

With the shipped configuration, a model that keeps working for ten tool calls without touching the list receives a reminder naming the open items; twenty-five and sixty calls bring the same nudge again if the list is still unchanged, and a plan rewrite restarts the count. A run that outlasts the cadence keeps drawing the nudge every sixty calls, so the longest executions never fall silent with a stale list on screen. A turn that retires the plan (`turn/start`) also restarts it, so a fresh turn never inherits a stale count. Sessions without a plan, and Sessions whose plan is fully completed, receive nothing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the guard counts staleness and delivers reminders, and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The guard is built on four commitments:

- **Advisory, not veto.** The guard enriches post-execute decisions with model context; it never blocks or rewrites a call, so `PostToolDecision` blocking stays a later listener's job.
- **One authoritative plan.** The list is read from the `todos` session projection — the same value the dock renders — so the guard holds no second copy and cannot disagree with the UI.
- **Count in post-execute.** Detection runs on `tools/post-execute`, which covers every attempt (denied calls included) with no cross-event bookkeeping; `exec.agent` names the Session that owns the plan.
- **Fail loud at load.** `thresholds` and `previewItems` validate in `apply` and throw, never falling back to defaults.

### Detection: tool calls since the last plan write

Each Session's progress lives in a `WeakMap<Session, Progress>` holding the plan value it counts from and the tool calls completed since. The plan value is compared by reference: the projection publishes a new array on every `todo/write` and `null` on a `turn/start`, so a reference change is exactly "the model published a new list" and restarts the count at zero.

- **A missing `todos` unit is capability absence.** A preset without `tool-todo` registers no such projection; `stateOf` returns `undefined` and the guard stays silent — there is no list to keep current.
- **Fully completed lists are silent.** A reminder exists to close open items; a plan with nothing open draws none, however long the run continues.
- **Calls without an agent are ignored.** A direct `ctx.tools.execute()` caller has no model to remind and no Session to key on.
- **Per-session, in-memory.** Another Session's counter never trips this one, and a resumed Session starts fresh — the guard is a heuristic nudge, not a logged invariant.

### Reminder delivery

Reminders ride the post-execute decision's `additionalContexts` (source `{kind: 'plugin', plugin: 'stale-plan-reminder', form: 'notice', summary: '<unfinished> unfinished × <calls> tool calls'}`), never a `content` replacement: the `tool/result` event stays the tool's own output for audit. The loop buffers the context and appends it as an injected `user/message` after the step's tool results — model-visible, source-attributed, and reconstructable from the session log with no new session event. The guard always delegates via `next()` and prepends its reminder to the downstream decision's context array, so both decision variants (a blocked call included) still get the nudge while every entry keeps its own source and metadata.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, fail-loud validation, the per-Session progress map and its post-execute listener |
| — | No runtime invariant companion is published; the progress map is private to one post-execute listener and exposes no package-owned event or snapshot that an independent companion can observe. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the tools waterfall to the projection the guard reads and the guard group map.

- [Tools subsystem reference](../../../docs/subsystems/tools.md) — the `tools/post-execute` waterfall, `additionalContexts`, and the decision shapes this guard consumes.
- [Session projection reference](../../../docs/subsystems/session-projection.md) — the whole-value fold and read face behind `todos`.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-stale-plan-reminder) — every accepted config field and its source declaration.
- [guard group map](../README.md) — the sibling guard packages and the loop-hygiene family.

-----

<a id="model-experience"></a>
## Model Experience

### Stale-plan context message

#### What the model sees

On each configured threshold, the owning agent receives the reminder below. It appears only while the plan has unfinished items; no tool schema or normal-call text is added. In the reminder, `(in progress) ` marks an item already reported as active, `- …and <omitted> more` appears only past `previewItems`, and each item line is head-truncated at 80 characters.

##### Stale-plan reminder

```markdown
Your to-do list has not been updated for <toolCalls> tool calls and still shows <unfinished> unfinished item(s):
- (in progress) <item>
- <item>
- …and <omitted> more
If any of them is finished, send the COMPLETE updated list with todo_write now: mark finished items completed as they finish (do not batch completions), and keep the items you are actively working on marked in_progress.
```

#### Token effect

Zero tokens before the first threshold. Each reminder is retained history for that Session, bounded by `previewItems` and the item-line cap; agents keep independent counters.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the guard is a poor fit. They are current package constraints, not a task backlog.

- **The tail cadence is fixed** — past the largest threshold the reminder repeats every `largest` calls, with no backoff and no wall-clock input, so a very long execution pays that reminder's tokens at a steady rate whether or not the model is deliberately keeping its list.
- **It cannot check the work, only the bookkeeping** — the guard never marks items complete itself; it asks the model, which may still decline or batch.
- **A plan rewritten with identical content restarts the count** — the guard detects publication (a new projection reference), not whether anything changed.
- **Compaction does not reset the count** — a count spanning a compaction checkpoint keeps running.
- **Advisory only** — escalating to a blocking form at a high threshold is not implemented, though `PostToolDecision` already supports blocking.
- **Sessions with subagent plans each remind their own agent** — plans stay isolated per Session, so a parent's stale list never reminds a child.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above and in the package code.

Open question: whether the reminder should quantify elapsed wall-clock time alongside tool calls.

</details>
