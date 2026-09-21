---
description: "Web turn reminders: the optional chime and system notification when a Session finishes or waits for the user; for users and maintainers of the Web GUI's attention behavior."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-notification

English | [中文](README.zh.md)

## Summary

This package adds turn reminders to the Web GUI: when a top-level Session stops running, or publishes an interaction that waits for the user, the page plays a chime and posts a system notification, so a task that finished while the user was elsewhere does not sit unnoticed. Triggers, channels, and the focus override are preferences in the General settings row this package owns, and subagent Sessions never remind because they run under a task the user is already tracking.

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

Mount this plugin alongside the rest of the Web profile; the **Task reminders** row then appears in the General settings section, and reminders fire without further setup wherever the page can produce them.

### The reminder row

Five switches carry the preferences: **When a task finishes** and **When it waits for me** choose the triggers, **Sound** and **System notification** choose the channels, and **Also remind while focused** decides whether a reminder may interrupt while the user is looking at the page. The two triggers default on, both channels default on, and the focus override defaults off, so a task that finishes behind another window announces itself once. Preferences are durable: they live in the `ui-notification` section of the Host user-settings document, so a reload, another browser window, and the Desktop shell all read the same answers.

### Browser notification permission

A system notification needs the browser's own permission, which the page can only request from a click. While the answer is still open, the row renders **Allow browser notifications**; the grant retires the button, and a refusal replaces it with a line naming the browser's site settings. The row re-reads the permission whenever the window regains focus, so a change made in the browser's settings appears without a reload. A page that exposes no Notification API at all — an embedded webview, for example — renders neither control and keeps the sound working.

### What a reminder says

The banner is titled with the Session's display label and its body states the outcome: the task finished, or the Session is waiting for input or approval. Repeated reminders for one Session replace each other in the notification center rather than stacking.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin subscribes to `ctx.uiSession.sessionStatus`, the unified per-Session status source, and folds each published snapshot through a transition detector holding only the previous observation per Session. A Session's first observation is a baseline, so an idle Session that a reload or a reconnect republishes stays silent; the detector reports `completed` when a running Session stops and `awaiting-input` when a request appears, a replacement request included. A step that both stops the Session and publishes a request reports only the wait, which already asks the user to act. The subscription is the only reminder input: no polling, no timer, and no reminder for a Session the Session catalog no longer carries.

Delivery then passes two filters before it reaches the page. `reminderSubject` resolves the Session's display label and rejects subagent Sessions and Sessions absent from the catalog; `ReminderPolicy` reads the live preferences and skips delivery while the page is visible and focused unless the override is on. The channels behind the policy are read lazily from the page's own globals, so a page that never reminds pays nothing: the system channel wraps `Notification` (permission read per call, banner posted with a `dsh-session-<id>` tag), the sound channel schedules a two-note sine chime on one `AudioContext` created at the first reminder, and the foreground channel reads visibility and focus. Every missing capability degrades to a no-op rather than an error: a page without audio, a refused banner, and a page without the Notification API each stay silent and record one console line.

The row registers into `settings.general.item` through `ctx.slots.inject`, so an assembly that declares the section after this plugin still seats the row. Its inject face carries live preference and permission sources in the `hooks` compartment; toggling a switch publishes the new value immediately and writes the field through `ctx.settingsScope`, while the scope's own acceptance republishes the section so a rejected write reverts the row. The decisions behind the reminder surface, and what they gave up, are recorded in the [Web turn reminders Agent Note](../../../.agents/notes/implemented/feature/2026-09-20-web-turn-reminders.md).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-session](../ui-session/README.md) — the unified Session status source every reminder reads.
- [ui-settings](../ui-settings/README.md) — the settings-namespace scope the preferences bind through.
- [ui-settings-general](../ui-settings-general/README.md) — the General section that renders this package's row.
- [ui-workspace](../ui-workspace/README.md) — the completion dot marking the same running-to-idle step.
- [Web client architecture](../../../docs/subsystems/web-client.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package reads Session status for a human and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current reminder surface. They are current package constraints, not a general notification comparison or a task backlog.

- **The chime is synthesized, not chosen** — one rising two-note figure plays for both triggers, so the triggers are indistinguishable by ear and no user-supplied sound is read. A page whose first `AudioContext` construction fails keeps the sound off for the session rather than retrying per reminder.
- **A reminder does not take the user to the Session** — the banner carries the Session label only; selecting it focuses nothing, because Session selection belongs to the workspace browser and this package contributes no navigation.
- **Only the running-to-idle step reminds** — a subagent or background job that finishes while its parent Session stays idle or keeps running produces no reminder, and a Session that failed produces the same copy as one that succeeded; failure detail stays in the transcript.
- **A request is reported once per key** — the detector compares pending-interaction identity, so a domain that republishes the same request under a new key reminds again, while a request that stays pending across a reconnect does not.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The reminder is page-local by construction: the Host stores preferences and nothing else, so the Desktop shell, a loopback browser, and a remote browser each deliver through their own capabilities. The chime is synthesized through Web Audio instead of shipping an audio asset, which keeps the published package to the two bundle artifacts and avoids a sound file whose license and loudness nobody reviews.

</details>

**Runtime invariant:** No companion is published. This package projects the unified Session status onto page-local reminders and one settings row; it owns no cross-plugin mutable state, and its slot registration and status subscription both prove disposal through the HMR-safety specs.
