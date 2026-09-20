---
name: dsh-diagnose-session-state
description: Diagnose a stale or unrefreshed DeepSeek Harness Web GUI session from durable evidence — a to-do dock stuck on an early plan or missing checks, or frozen background jobs, queue, approvals, and context meters. Use when a user names a session and says a panel did not update or a plan's check marks do not match the work that ran; it reads the persisted Session log and Host projection cache without a browser and returns a verdict separating model plan maintenance, Host state, and browser delivery.
---

# Diagnose a stale Session surface

A user reports that a Session's on-screen state looks wrong: the `任务`/to-do dock never left its first snapshot, finished work is still unchecked, jobs or queue entries are frozen. Answer from durable evidence before touching a browser or a running Host: the persisted Session log holds every plan write and every tool call, and the Host's projection cache holds the value the Host would serve right now ([session projection](../../../docs/subsystems/session-projection.md), [web client](../../../docs/subsystems/web-client.md)).

## What each surface actually is

The dock renders the `todos` projection, and that projection is nothing more than **the newest `todo_write` snapshot in the Session log**. It is not inferred from completed work. Two consequences decide most reports:

- The panel is exactly as fresh as the model's last `todo_write` call. A model that writes a plan once and then runs hundreds of tool calls leaves the panel at the plan, no matter how much work finished.
- The plan is retired at `turn/start` and kept after `turn/end`, so a new user message hides the panel until the model writes a plan again.
- The `todos` unit is registered by the agent preset, so a Session observed while no Agent is mounted contributes no `todos` key at all — a panel can be empty even though the log carries a finished plan. The inspector's `CACHE` line distinguishes that case from a stale value.

The Host pushes projection changes over the Session control stream; the browser applies them with a higher-sequence-wins rule. Nothing in the Session log records whether the browser applied a frame, so the log can prove the Host had a value, never that a tab displayed it.

## Run the inspector

The skill ships a read-only inspector, `scripts/inspect-session-state.mjs`, that needs no build, no Host, and no browser:

```sh
# exact Session id (fastest; a directory-name substring is enough)
node .agents/skills/dsh-diagnose-session-state/scripts/inspect-session-state.mjs --session 6120d28a

# when the user remembers a title instead of an id (scans newest first)
node .agents/skills/dsh-diagnose-session-state/scripts/inspect-session-state.mjs --title "长图导航栏"

# orient first: the newest Sessions with their latest plan state
node .agents/skills/dsh-diagnose-session-state/scripts/inspect-session-state.mjs --recent 10

# machine-readable, for follow-up processing
node .agents/skills/dsh-diagnose-session-state/scripts/inspect-session-state.mjs --session <id> --json
```

It reads `$DSH_HOME` (default `~/.dsh`; override with `--home`) and prints the Session identity, its turn list, every plan write with the time and tool calls since the previous one, the standing plan after folding `turn/start` retirements, the Host projection-cache row, and one or more verdicts.

Reading the output:

| Field | Meaning |
|---|---|
| `PLAN WRITES` | Each `todo_write`: sequence, timestamp, turn/step, per-status counts, and the gap (`+5.7m / 37 tool calls`) since the previous write. |
| `changed` | Per-item status transitions, additions, and removals between consecutive writes. |
| `STANDING` | The plan the Host would serve right now, or `null` with the `turn/start` that retired it. |
| `CACHE` | The Host's persisted `todos` row (`seq`, `ver`, value). It agrees with `STANDING` unless a checkpoint write is pending. |

## Verdicts and what to do next

| Verdict | Meaning | Next step |
|---|---|---|
| `never-updated` | The model wrote a plan once, then ran many tool calls without rewriting it. | Model plan maintenance, not a UI defect. Report the gap; if the user wants it fixed, the options are a plan-maintenance reminder guard, a "plan updated N ago" hint in the panel, or relaxing the `turn/start` retirement. |
| `plan-stale` | The newest plan write predates the end of the work by minutes and many tool calls, and still lists unfinished items. | Same as above: the panel matches the plan; the plan does not match the work. |
| `turn-cleared` | A `turn/start` after the last write retired the plan. | Expected behaviour. The panel is hidden until the model writes a new plan in the new turn. |
| `no-plan` | The Session never recorded a plan. | The dock was never populated; look for a different surface or Session. |
| `consistent` | The newest write is the standing plan and trails the log by less than the thresholds. | If the user still saw stale content, the Host was right and the browser missed the push — collect the delivery evidence below. |

## Collect delivery evidence when the log cannot explain it

A report is a genuine client-side loss only when the log shows a newer plan write than what the tab displayed. Ask for, from the affected tab before it is closed:

- DevTools console: any line starting `[session-controller] control stream failed:` — copy it verbatim with its timestamp. That callback is the only place a lost control stream is reported.
- Whether a reload shows the newest plan. A fresh page takes the Host baseline, so the newest value appearing after a reload proves the Host and the value were fine and the long-lived tab lost the live push.
- Whether other projection-fed surfaces were frozen at the same moment (background jobs, queue, approvals, token/context meters). They share the control stream, so a simultaneous freeze points at the stream rather than at the to-do unit.

Treat a missing browser console line as missing evidence, not as proof that delivery worked: the message is written only to the console and nothing persists it.

## Boundaries

- The inspector is read-only. Never edit, truncate, or delete Session logs or projection-cache rows while diagnosing.
- Session logs are concatenated-zstd containers; the inspector prefers the `zstd` CLI (Node's own zstd API stops after the first frame) and falls back to a per-frame scan.
- A Session whose log is still being appended may end in a torn frame or partial record; the inspector keeps the complete prefix, so a running Session is diagnosable.
- Host-side truth is the projection cache row, written at `turn/end`, at Session disposal, and on the configured event/interval throttle; while a turn runs it can trail the live fold by that throttle.
