---
description: "Package map for the loop-hygiene guard family: the advisory repeat-tool and stale-plan reminders and the per-tool-call timeout policy, for users and maintainers choosing or composing the guards."
kind: "package-group"
---

# guard/ — loop-hygiene guard family

English | [中文](README.zh.md)

## Summary

The `guard/` group keeps the agent loop productive by watching for three failure patterns. `repeat-tool-reminder` notices identical tool-call loops and asks the model to change approach or finish. `stale-plan-reminder` notices a to-do list falling behind long work and asks for the complete updated list. `timeout-policy` limits tool calls that declare a deadline, so a hung call returns a clear timed-out error. All three ship enabled in the `dsh` base bundle; a composition can tune or remove them.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Three small plugins cover the three patterns; each README below explains when to keep, tune, or remove it.

| Package | What it provides |
|---|---|
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.md) | Reminds the model when it repeats the same tool call, so it changes approach or finishes |
| [`stale-plan-reminder/`](stale-plan-reminder/README.md) | Reminds the model to send its complete to-do list while work continues, so a visible plan follows the work |
| [`timeout-policy/`](timeout-policy/README.md) | Times out tool calls that declare a limit, so the model gets a clear error instead of waiting forever |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the tools subsystem reference for the tool-call pipeline, then the reminders' configuration and the timeout-library decision behind the policy.

- [Tools subsystem reference](../../docs/subsystems/tools.md) — the tool-call pipeline and decisions all three guards build on.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-repeat-tool-reminder) — every accepted field of the repeat-call reminder.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-stale-plan-reminder) — every accepted field of the stale-plan reminder.
- [Timeout deadline library Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md) — the timing/termination split `timeout-policy` enforces.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
