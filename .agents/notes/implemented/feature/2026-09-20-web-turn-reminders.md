# Agent Note: Web turn reminders

Status: implemented

English | [中文](2026-09-20-web-turn-reminders.zh.md)

## Problem

A Web Session that runs for minutes leaves the user with no signal when it finishes. The Workspace browser's green dot already marks a Session that stopped while it was not the main view, and it stays until the user opens that Session — a stationary mark, useful when the user is at the page and useless when they are not. Every desktop alternative the user compares against (Otty, for one) answers the same gap differently: the page itself makes a sound and posts a system notification.

Nothing in the Web client owned that behavior. `ui-session` publishes the facts a reminder needs — a per-Session `running` flag and the effective pending interaction, both downstream of `api-session/status` events and the catalog baseline — but it deliberately owns no presentation and no browser capability. `ui-workspace` renders the dot as sidebar state. Neither may grow a notification path: `ui-session` is the data adapter every other UI package reads, and `ui-workspace` is the browser tree.

## Decision

`@deepseek-ai/dsh-client-ui-notification` is a Web client plugin whose only input is `ctx.uiSession.sessionStatus`, the unified status source described in [client Session references](../architecture/2026-09-15-client-session-references.md). Its `AttentionDetector` folds each published snapshot against the previous observation per Session and reports two transitions: `completed` when an observed running Session stops, and `awaiting-input` when the Session publishes a pending interaction, including a request that replaces an earlier one. A Session's first observation is a baseline, so the reload and reconnect snapshots that republish already-idle Sessions remind nobody, and one step that both stops a Session and publishes a request reports only the wait.

Delivery is page-local by construction. The Host stores preferences in the `ui-notification` user-settings section and nothing else; the page owns the chime and the banner through its own browser capabilities, so the Desktop shell, a loopback browser, and a remote browser each deliver through what they have. Two filters run before delivery: `reminderSubject` drops Sessions outside the catalog and Sessions whose `origin` is `subagent`, because a child Session runs under a task the user already tracks; `ReminderPolicy` reads the live preferences and holds delivery back while the page is visible and focused unless the user turned that override on. Reminders default to both triggers and both channels on, quiet while focused.

The chime is synthesized on one lazily created `AudioContext` — a rising two-note sine figure — rather than shipped as an audio asset, which keeps the published package to its two bundle artifacts. The banner is a `Notification` carrying the Session's display label as its title, the outcome as its body, and a `dsh-session-<id>` tag so repeated reminders for one Session replace each other. Every capability the page can lack degrades to a silent no-op with one console line: no `Notification` API, an ungranted or refused permission, a refused banner, no `AudioContext`, or a constructor that throws. The permission is read per call and re-read on window focus, so a grant made in the browser's own settings appears without a reload.

The feature owns its General-settings row (`settings.general.item`, id `notification`): the five switches write through `ctx.settingsScope`, and the row renders the **Allow browser notifications** control only while the permission is unanswered and an explanatory line while it is denied.

## Alternatives considered

**Host-side notifications through the Desktop shell.** Rejected: the Desktop main process could post OS notifications, but the same Web bundle also runs in an ordinary browser, where no Host path exists. A capability that only works in one shell would need a second, divergent implementation for the other, and the browser Notification API already reaches the OS from both.

**An in-page toast or banner instead of a system notification.** Rejected: the reminders exist for the window the user is *not* looking at, and an in-page toast is invisible there. It also duplicates the Workspace completion dot for the window the user *is* looking at.

**Reminding from `completionUnread` instead of folded transitions.** Rejected: that flag is defined as "stopped while lacking main-view ownership" and is cleared when the Session becomes the main view, so it cannot express "this Session finished" for the Session the user is watching or for one that finished before the page loaded. The detector reads `running` and `pendingInteraction` directly and keeps its own one-step memory.

**Reminding for every Session, subagents included.** Rejected: a delegated child finishing is not the answer the user is waiting for, and a team of subagents would produce a burst of banners for one task's progress.

**Delivering whenever the transition happens, focused or not.** Rejected: a reminder for work the user is watching interrupts without adding information. The focus override keeps that suppression user-controlled rather than hard-coded.

**A `ui-session` or `ui-workspace` responsibility.** Rejected: both packages own data or navigation state that other features read, and neither should acquire browser capabilities, an audio context, and a settings row. Keeping reminders in their own plugin also lets a deployment drop the row to remove the behavior entirely.

## Consequences

The rules that decide when a stop is reminder-worthy now live in a second place: `completionUnread` for the Workspace dot and the detector's per-Session fold for reminders. They agree on the running-to-idle step and on ignoring the initial baseline, and they differ deliberately on main-view ownership — a Session the user is watching still reminds once the window loses focus. A future change to what counts as "finished" must move both, and neither package can import the other's fold.

Reminders are best-effort page state: nothing is persisted, a reload forgets every observation, and a stop that happens while the page is closed is never reported. A Session that failed produces the same copy as one that succeeded, because status carries no failure fact; the transcript remains the place failure is legible. A subagent or background job that finishes while its parent Session stays idle or keeps running reminds nobody, and selecting a banner focuses nothing, because Session navigation belongs to `ui-workspace`.

Sound is one synthesized figure for both triggers, so the two are indistinguishable by ear and no user-supplied sound is read. A page whose first `AudioContext` construction fails stays silent for the session rather than retrying per reminder.

## Testing

- `packages/client/ui-notification/tests/attention.client.spec.ts` pins the transition rules: baselines, repeated snapshots, replacement requests, a stop and a request in one step, sessions leaving the catalog, and per-Session ordering.
- `packages/client/ui-notification/tests/reminder.client.spec.ts` pins the preference matrix and subject resolution, including the subagent and missing-catalog rejections.
- `packages/client/ui-notification/tests/channels.client.spec.ts` drives every browser capability double: permission states, a refused request, a refused banner, the two-note schedule, a suspended context, a rejected resume, and a page with no audio.
- `packages/client/ui-notification/tests/assembly.client.spec.ts` boots the real web-profile roster and drives `api-session/status` frames through the production Connection: the row registers into the assembled Settings section, both triggers deliver, a subagent stays silent, the focus override works, a preference write reaches `settings/mutate`, and the permission control republishes on grant and on window focus.
- `packages/client/ui-notification/tests/host.client.spec.ts` mounts the Host half over the real settings provider to pin the namespace defaults and schema rejection.
