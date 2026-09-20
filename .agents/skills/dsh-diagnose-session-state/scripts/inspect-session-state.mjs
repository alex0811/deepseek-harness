#!/usr/bin/env node
/**
 * Read-only forensics for one persisted Session: what the model recorded in its
 * to-do plan, when it recorded it, how much work ran between records, and what
 * the Host's projection cache holds now. It answers "the panel did not refresh"
 * reports from the two durable artifacts (the Session log and the projection
 * cache) without a running Host, a browser, or the repository's build.
 *
 * Usage (see ../SKILL.md for the workflow):
 *   node inspect-session-state.mjs --session <id-or-dir-substring>
 *   node inspect-session-state.mjs --title <title-substring>
 *   node inspect-session-state.mjs --recent [count]
 *
 * Options:
 *   --home <dir>  Harness home to read (default $DSH_HOME, then ~/.dsh)
 *   --json        Machine-readable report instead of the text form
 *   --writes <n>  Keep at most n newest plan snapshots (default 8)
 * @module .agents/skills/dsh-diagnose-session-state/scripts/inspect-session-state
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** Largest Session log this reader accepts, in bytes (decompression and parse are in-memory). */
const MAX_LOG_BYTES = 1 << 30
/** A plan write older than this many minutes while work continued counts as a stale plan. */
const STALE_MINUTES = 5
/** A plan write followed by this many further tool calls with no rewrite counts as never maintained. */
const NEVER_UPDATED_TOOL_CALLS = 20

/** Print usage and exit non-zero on a malformed invocation. */
function usage(message) {
  process.stderr.write(`${message}\n\n`
    + 'usage: inspect-session-state.mjs --session <id|substring> | --title <substring> | --recent [count]\n'
    + '       [--home <dir>] [--json] [--writes <n>]\n')
  process.exit(2)
}

/**
 * Parse the command line into explicit options.
 * @returns {{mode: 'session'|'title'|'recent', needle?: string, count?: number, home: string, json: boolean, writes: number}}
 */
function parseArguments() {
  const argv = process.argv.slice(2)
  const options = {
    mode: undefined,
    needle: undefined,
    home: process.env.DSH_HOME ?? join(homedir(), '.dsh'),
    json: false,
    writes: 8,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const next = () => {
      index += 1
      const value = argv[index]
      if (value === undefined) usage(`${flag} requires a value`)
      return value
    }
    switch (flag) {
      case '--session': options.mode = 'session'; options.needle = next(); break
      case '--title': options.mode = 'title'; options.needle = next(); break
      case '--recent': {
        options.mode = 'recent'
        const candidate = argv[index + 1]
        if (candidate !== undefined && !candidate.startsWith('--')) {
          index += 1
          options.count = Number(candidate)
        }
        break
      }
      case '--home': options.home = resolve(next()); break
      case '--json': options.json = true; break
      case '--writes': options.writes = Number(next()); break
      default: usage(`unknown argument ${JSON.stringify(flag)}`)
    }
  }
  if (options.mode === undefined) usage('one of --session, --title, or --recent is required')
  if (options.mode === 'recent' && options.count === undefined) options.count = 10
  if (options.mode !== 'recent' && (options.needle ?? '').length === 0) usage('the search value must not be empty')
  return options
}

/** Locate the concatenated-zstd frame magic so a fallback reader can split frames. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** Decompress every frame; Node's own zstd API stops after the first frame, so the CLI is preferred. */
function readLogText(path) {
  try {
    return execFileSync('zstd', ['-dc', path], { maxBuffer: MAX_LOG_BYTES, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      /* v8 ignore next -- the CLI prints partial output before a torn-frame warning; only a hard failure reaches here */
      if (typeof error?.stdout === 'string' && error.stdout.length > 0) return error.stdout
      throw new Error(`cannot decompress ${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const buffer = readFileSync(path)
  const starts = []
  for (let at = buffer.indexOf(ZSTD_MAGIC); at !== -1; at = buffer.indexOf(ZSTD_MAGIC, at + 1)) starts.push(at)
  if (starts.length === 0) throw new Error(`${path} is not a zstd container`)
  const parts = []
  for (let index = 0; index < starts.length; index += 1) {
    const end = index + 1 < starts.length ? starts[index + 1] : buffer.length
    try {
      parts.push(zstdDecompressSync(buffer.subarray(starts[index], end)))
    } catch {
      // A torn final frame (crash mid-append) is the only expected failure; keep the complete prefix.
    }
  }
  if (parts.length === 0) throw new Error(`cannot decompress ${path}: install the zstd CLI for concatenated frames`)
  return Buffer.concat(parts).toString('utf8')
}

/** Parse the log, tolerating a torn final line and unrelated record types. */
function readEvents(path) {
  const events = []
  for (const line of readLogText(path).split('\n')) {
    if (line.length === 0) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // A trailing partial record from an in-flight append is expected; everything else parsed already.
    }
  }
  return events
}

/** Every persisted Session log under the harness home, newest first. */
function sessionFiles(home) {
  const root = join(home, 'sessions')
  const found = []
  let workspaces
  try {
    workspaces = readdirSync(root, { withFileTypes: true })
  } catch {
    throw new Error(`no Session store at ${root}; pass --home when the harness home is elsewhere`)
  }
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue
    const workspacePath = join(root, workspace.name)
    for (const directory of readdirSync(workspacePath, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue
      const log = join(workspacePath, directory.name, 'session.v3.jsonl.zstd')
      const plain = join(workspacePath, directory.name, 'session.v3.jsonl')
      const path = existsOrUndefined(log) ?? existsOrUndefined(plain)
      if (path === undefined) continue
      found.push({
        id: directory.name,
        workspace: workspace.name,
        directory: join(workspacePath, directory.name),
        path,
        modifiedAt: statSync(path).mtimeMs,
      })
    }
  }
  return found.sort((left, right) => right.modifiedAt - left.modifiedAt)
}

/** Absolute path when the entry exists, else undefined. */
function existsOrUndefined(path) {
  try {
    statSync(path)
    return path
  } catch {
    return undefined
  }
}

/** Counts per to-do status for one plan snapshot. */
function counts(todos) {
  const result = { completed: 0, in_progress: 0, pending: 0 }
  for (const todo of todos) result[todo.status] += 1
  return result
}

/** Compact `[2 completed · 1 in_progress · 6 pending]` form, dropping empty segments. */
function countsLabel(todos) {
  const value = counts(todos)
  const segments = []
  if (value.completed > 0) segments.push(`${String(value.completed)} completed`)
  if (value.in_progress > 0) segments.push(`${String(value.in_progress)} in_progress`)
  if (value.pending > 0) segments.push(`${String(value.pending)} pending`)
  return `[${segments.length === 0 ? 'empty' : segments.join(' · ')}]`
}

/** Human-readable `+5.7m / 78 tool calls` gap. */
function gapLabel(minutes, toolCalls) {
  const rounded = minutes < 1 ? '<1' : minutes.toFixed(minutes < 10 ? 1 : 0)
  return `+${rounded}m / ${String(toolCalls)} tool calls`
}

/** Per-item changes between two snapshots, by content, capped for readability. */
function describeChange(previous, current) {
  const before = new Map((previous ?? []).map(todo => [todo.content, todo.status]))
  const after = new Map(current.map(todo => [todo.content, todo.status]))
  const changes = []
  for (const [content, status] of after) {
    const was = before.get(content)
    if (was === undefined) changes.push(`+ ${short(content)}`)
    else if (was !== status) changes.push(`${short(content)}: ${was}→${status}`)
  }
  for (const content of before.keys()) if (!after.has(content)) changes.push(`- ${short(content)}`)
  return changes.length <= 6 ? changes : [...changes.slice(0, 6), `(+${String(changes.length - 6)} more)`]
}

/** First 46 characters of one plan line. */
function short(content) {
  return content.length <= 46 ? content : `${content.slice(0, 45)}…`
}

/** ISO second-precision timestamp for a millisecond epoch. */
function timestamp(milliseconds) {
  return milliseconds === undefined ? '?' : new Date(milliseconds).toISOString().replace('.000Z', 'Z').replace(/\.\d+Z$/u, 'Z')
}

/** `18m ago` / `3.5h ago` for a millisecond age. */
function ago(milliseconds) {
  const minutes = milliseconds / 60_000
  if (minutes < 1) return 'just now'
  if (minutes < 90) return `${minutes.toFixed(0)}m ago`
  return `${(minutes / 60).toFixed(1)}h ago`
}

/**
 * Build the complete report for one persisted Session.
 * @param candidate - session directory record from {@link sessionFiles}.
 * @param home - harness home, for the projection cache.
 * @param writesKept - how many newest plan snapshots the text report prints.
 * @returns the structured report.
 */
function buildReport(candidate, home, writesKept) {
  const events = readEvents(candidate.path)
  const title = events.filter(event => event.type === 'session/title')
    .map(event => event.data?.title ?? event.data?.text)
    .filter(value => typeof value === 'string')
    .at(-1)
  const header = events.find(event => event.type === 'session') ?? {}
  const plans = events.filter(event => event.type === 'todo/write')
  const turns = events.filter(event => event.type === 'turn/start' || event.type === 'turn/end')
  const toolCalls = events.filter(event => event.type === 'tool/call').length

  // Gaps measure work performed between consecutive plan writes: elapsed time and
  // tool calls, which is exactly what a frozen panel fails to reflect.
  let toolCallsSoFar = 0
  let lastCall
  const snapshots = []
  for (const event of events) {
    if (event.type === 'tool/call') {
      toolCallsSoFar += 1
      lastCall = event.data
    }
    if (event.type !== 'todo/write') continue
    const previous = snapshots.at(-1)
    const sinceToolCalls = toolCallsSoFar - (previous?.toolCalls ?? 0)
    const sinceMinutes = previous === undefined ? undefined : (event.time - previous.time) / 60_000
    snapshots.push({
      seq: event.seq,
      time: event.time,
      turn: lastCall?.turn,
      step: lastCall?.step,
      todos: (event.data?.todos ?? []).map(todo => ({ content: todo.content, status: todo.status })),
      toolCalls: toolCallsSoFar,
      sinceToolCalls,
      sinceMinutes,
      changes: describeChange(previous?.todos, event.data?.todos ?? []),
    })
  }

  // Fold the standing plan the way the Host projection does: a whole-list write
  // replaces the plan, and the next turn/start retires it (turn/end keeps it).
  let standing = null
  let standingSeq
  let clearedBy
  for (const event of events) {
    if (event.type === 'todo/write') {
      standing = event.data?.todos ?? []
      standingSeq = event.seq
      clearedBy = undefined
    } else if (event.type === 'turn/start' && standing !== null) {
      standing = null
      standingSeq = undefined
      clearedBy = { seq: event.seq, time: event.time }
    }
  }

  const last = events.at(-1)
  const firstTimed = events.find(event => typeof event.time === 'number')
  const persisted = existsOrUndefined(join(home, 'storages', 'session_projcache', 'sessions', `${candidate.id}.json`))
  let cache = null
  if (persisted !== undefined) {
    try {
      const record = JSON.parse(readFileSync(persisted, 'utf8'))
      const row = record?.record?.rows?.todos
      cache = row === undefined ? { present: false } : { present: true, ver: row.ver, seq: row.seq, todos: row.val ?? null }
    } catch (error) {
      cache = { error: error instanceof Error ? error.message : String(error) }
    }
  }

  const newestPlan = snapshots.at(-1)
  const toolCallsAfterNewestPlan = newestPlan === undefined ? 0 : toolCalls - newestPlan.toolCalls
  const minutesFromNewestPlanToEnd = newestPlan === undefined ? 0 : (last.time - newestPlan.time) / 60_000
  const unfinished = (standing ?? []).filter(todo => todo.status !== 'completed')

  const verdicts = []
  if (newestPlan === undefined) verdicts.push('no-plan: the Session never recorded a to-do list, so the panel had nothing to show')
  if (standing === null && newestPlan !== undefined) {
    verdicts.push(`turn-cleared: turn/start @seq ${String(clearedBy?.seq)} (${timestamp(clearedBy?.time)}) retired the finished plan; the panel hides until the next todo_write`)
  }
  if (standing !== null && unfinished.length > 0 && (minutesFromNewestPlanToEnd >= STALE_MINUTES || toolCallsAfterNewestPlan >= NEVER_UPDATED_TOOL_CALLS)) {
    verdicts.push(`plan-stale: the newest plan write came ${minutesFromNewestPlanToEnd.toFixed(1)}m and ${String(toolCallsAfterNewestPlan)} tool calls before the last event, and still lists ${String(unfinished.length)} unfinished item(s) — the panel matches the plan, the plan does not match the work`)
  }
  if (snapshots.length === 1 && toolCallsAfterNewestPlan >= NEVER_UPDATED_TOOL_CALLS) {
    verdicts.push(`never-updated: the plan was written once and then ${String(toolCallsAfterNewestPlan)} tool calls ran with no rewrite`)
  }
  if (verdicts.length === 0) {
    verdicts.push('consistent: the newest plan write is the standing plan and trails the log by less than the staleness thresholds — if a panel still looked stale, suspect the browser delivery path (see SKILL.md)')
  }

  return {
    session: {
      id: candidate.id,
      directory: candidate.directory,
      workspace: candidate.workspace,
      title: title ?? null,
      cwd: header.cwd ?? null,
      log: candidate.path,
      modifiedAt: candidate.modifiedAt,
      records: events.length,
      firstTime: firstTimed?.time,
      lastTime: last?.time,
      lastSeq: last?.seq,
      toolCalls,
      turns: turns.map(event => ({ type: event.type, seq: event.seq, time: event.time, reason: event.data?.reason?.kind })),
    },
    plans: snapshots.map(snapshot => ({ ...snapshot, counts: counts(snapshot.todos), label: countsLabel(snapshot.todos) })),
    standing: standing === null
      ? { value: null, clearedBy: clearedBy ?? null }
      : { value: standing, seq: standingSeq, unfinished: unfinished.length },
    cache,
    verdicts,
    writesKept,
  }
}

/** Render the report as the text the skill's workflow reads. */
function renderReport(report) {
  const { session } = report
  const lines = []
  lines.push(`SESSION   ${session.id}`)
  lines.push(`TITLE     ${session.title ?? '<untitled>'}`)
  lines.push(`WORKSPACE ${session.workspace}${session.cwd === null ? '' : `  cwd=${session.cwd}`}`)
  lines.push(`LOG       ${session.log}`)
  lines.push(`          ${String(session.records)} records · ${String(session.toolCalls)} tool calls · ${String(session.turns.filter(t => t.type === 'turn/start').length)} turn(s) · ${timestamp(session.firstTime)} → ${timestamp(session.lastTime)} (seq ${String(session.lastSeq)}) · written ${ago(Date.now() - session.modifiedAt)}`)
  const lastTurn = session.turns.at(-1)
  lines.push(`TURNS     ${session.turns.map(turn => `${turn.type === 'turn/start' ? 'start' : `end(${turn.reason ?? '?'})`}@${String(turn.seq)}`).join(' ')}${lastTurn === undefined ? '' : `  newest=${timestamp(lastTurn.time)}`}`)
  lines.push('')
  lines.push(`PLAN WRITES (${String(report.plans.length)}${report.plans.length > report.writesKept ? `, newest ${String(report.writesKept)} shown` : ''})`)
  for (const snapshot of report.plans.slice(-report.writesKept)) {
    const gap = snapshot.sinceMinutes === undefined ? '(first write)' : gapLabel(snapshot.sinceMinutes, snapshot.sinceToolCalls)
    lines.push(`  seq ${String(snapshot.seq).padEnd(5)} ${timestamp(snapshot.time)}  turn ${String(snapshot.turn ?? '?')}/${String(snapshot.step ?? '?')}  ${snapshot.label}  ${gap}`)
    if (snapshot.changes.length > 0) lines.push(`        changed: ${snapshot.changes.join(', ')}`)
  }
  lines.push('')
  if (report.standing.value === null) {
    const cleared = report.standing.clearedBy
    lines.push(`STANDING  null${cleared === null ? '' : ` — retired by turn/start @seq ${String(cleared.seq)} (${timestamp(cleared.time)})`}`)
  } else {
    const unfinished = report.standing.value.filter(todo => todo.status !== 'completed')
    lines.push(`STANDING  seq ${String(report.standing.seq)} · ${countsLabel(report.standing.value)} · unfinished ${String(unfinished.length)}`)
    for (const todo of unfinished) lines.push(`        ${todo.status.padEnd(11)} ${short(todo.content)}`)
  }
  if (report.cache === null) lines.push('CACHE     no projection-cache row for this Session')
  else if (report.cache.present === false) lines.push('CACHE     row present, no todos key (the to-do unit was unregistered when it was written)')
  else if (report.cache.error !== undefined) lines.push(`CACHE     unreadable: ${report.cache.error}`)
  else lines.push(`CACHE     todos @seq ${String(report.cache.seq)} (ver ${String(report.cache.ver)}) ${report.cache.todos === null ? '= null' : `= ${countsLabel(report.cache.todos)}`}`)
  lines.push('')
  for (const verdict of report.verdicts) lines.push(`VERDICT   ${verdict}`)
  return `${lines.join('\n')}\n`
}

/** One-line plan summary for the --recent listing. */
function summarize(candidate, home) {
  const events = readEvents(candidate.path)
  const title = events.filter(event => event.type === 'session/title').map(event => event.data?.title).filter(Boolean).at(-1)
  const plans = events.filter(event => event.type === 'todo/write')
  const standing = plans.at(-1)
  return {
    id: candidate.id,
    modification: ago(Date.now() - candidate.modifiedAt),
    title: typeof title === 'string' ? title : '<untitled>',
    records: events.length,
    plans: plans.length,
    latest: standing === undefined ? 'no plan' : countsLabel(standing.data?.todos ?? []),
  }
}

/** Entry point: resolve the Session, then print text or JSON. */
function main() {
  const options = parseArguments()
  const candidates = sessionFiles(options.home)
  if (candidates.length === 0) throw new Error(`no persisted Session logs under ${join(options.home, 'sessions')}`)

  if (options.mode === 'recent') {
    const rows = candidates.slice(0, options.count).map(candidate => summarize(candidate, options.home))
    if (options.json) process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
    else {
      for (const row of rows) {
        process.stdout.write(`${row.modification.padEnd(10)} ${row.id}\n           ${row.title}  ·  ${String(row.records)} records · ${String(row.plans)} plan write(s) · newest ${row.latest}\n`)
      }
    }
    return
  }

  let matches
  if (options.mode === 'session') {
    const needle = options.needle
    matches = candidates.filter(candidate => candidate.id.includes(needle) || candidate.workspace.includes(needle))
  } else {
    matches = []
    for (const candidate of candidates) {
      const events = readEvents(candidate.path)
      const titles = events.filter(event => event.type === 'session/title')
        .map(event => event.data?.title ?? event.data?.text)
        .filter(value => typeof value === 'string')
      if (titles.some(value => value.includes(options.needle))) {
        matches.push(candidate)
        if (matches.length >= 5) break
      }
    }
  }
  if (matches.length === 0) throw new Error(`no Session matches ${JSON.stringify(options.needle)} under ${join(options.home, 'sessions')}`)

  const reports = matches.map(candidate => buildReport(candidate, options.home, options.writes))
  if (options.json) process.stdout.write(`${JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2)}\n`)
  else {
    for (const report of reports) process.stdout.write(`${renderReport(report)}\n`)
    if (matches.length > 1) process.stdout.write(`(${String(matches.length)} Sessions matched; newest first)\n`)
  }
}

try {
  main()
} catch (error) {
  process.stderr.write(`inspect-session-state: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
