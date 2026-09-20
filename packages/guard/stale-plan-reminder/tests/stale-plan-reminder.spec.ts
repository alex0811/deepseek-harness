/**
 * Behavior suite for the stale-plan guard: threshold counting against the real
 * `todos` projection, resets on a plan rewrite and on a turn retirement, the
 * silent cases (no plan, nothing unfinished, unregistered unit), the preview
 * cap, per-session isolation, fold-onto-downstream-decision, and fail-loud
 * config validation — all driven through a real agent loop against a scripted
 * mock adapter (no network).
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as StalePlanReminder from '@deepseek-ai/dsh-stale-plan-reminder'
import type { Config } from '@deepseek-ai/dsh-stale-plan-reminder'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/** Mount the core spine, the to-do tool (its projection), and the guard. */
async function harness(config: Config, options: { todoTool?: boolean } = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (options.todoTool !== false) await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  await ctx.plugin(StalePlanReminder, config)
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

/** Every injected-context message in the agent's log, with its source, flattened for terse assertions. */
function reminders(agent: Agent): { text: string; source: unknown }[] {
  return agent.session.snapshotEvents()
    .filter((event): event is SessionEvent<'user/message'> => event.type === 'user/message' && event.data.source.kind !== 'user')
    .map(event => ({
      text: event.data.content.map(block => block.type === 'text' ? block.text : '').join('|'),
      source: event.data.source,
    }))
}

const guardSource = (unfinished: number, toolCalls: number) => ({
  kind: 'plugin',
  plugin: 'stale-plan-reminder',
  form: 'notice',
  summary: `${String(unfinished)} unfinished × ${String(toolCalls)} tool calls`,
})

/** Drive one scripted turn for a fresh agent and return it. */
async function run(ctx: Context, id: string, adapter: MockAdapter): Promise<Agent> {
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })
  const idle = waitForIdle(ctx, agent)
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
  await idle
  return agent
}

const PLAN: { content: string; status: 'in_progress' | 'pending' | 'completed' }[] = [
  { content: 'fix the widget', status: 'in_progress' },
  { content: 'write the report', status: 'pending' },
]

describe('reminder cadence', () => {
  it('reminds at the configured count with the open items and the exact update request', async () => {
    const ctx = await harness({ thresholds: [3], previewItems: 5 })
    const agent = await run(ctx, 'stale-plan-1', new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: PLAN }),
      toolCallResponse('c2', 'probe', {}),
      toolCallResponse('c3', 'probe', {}),
      toolCallResponse('c4', 'probe', {}),
      textResponse('done'),
    ]))

    const found = reminders(agent)
    expect(found).toHaveLength(1)
    expect(found[0]!.text).toBe([
      'Your to-do list has not been updated for 3 tool calls and still shows 2 unfinished item(s):',
      '- (in progress) fix the widget',
      '- write the report',
      'If any of them is finished, send the COMPLETE updated list with todo_write now: mark finished '
      + 'items completed as they finish (do not batch completions), and keep the items you are '
      + 'actively working on marked in_progress.',
    ].join('\n'))
    expect(found[0]!.source).toEqual(guardSource(2, 3))

    // The reminder is advisory context, never a rewrite of the tool result.
    const todoResults = agent.session.snapshotEvents()
      .filter((event): event is SessionEvent<'tool/result'> => event.type === 'tool/result')
      .map(event => event.data.message.content.flatMap(block => block.type === 'tool-result' && block.content !== undefined
        ? block.content.flatMap(inner => inner.type === 'text' ? [inner.text] : [])
        : []))
    expect(todoResults.some(lines => lines.some(line => line.includes('Updated todo list')))).toBe(true)
  })

  it('stays silent when every item is already completed', async () => {
    const ctx = await harness({ thresholds: [2], previewItems: 5 })
    const agent = await run(ctx, 'stale-plan-2', new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: [{ content: 'done already', status: 'completed' }] }),
      toolCallResponse('c2', 'probe', {}),
      toolCallResponse('c3', 'probe', {}),
      textResponse('done'),
    ]))

    expect(reminders(agent)).toEqual([])
  })

  it('stays silent without a plan and works when the to-do unit is not registered at all', async () => {
    const withTool = await harness({ thresholds: [2], previewItems: 5 })
    const agentA = await run(withTool, 'stale-plan-3', new MockAdapter([
      toolCallResponse('c1', 'probe', {}),
      toolCallResponse('c2', 'probe', {}),
      textResponse('done'),
    ]))
    expect(reminders(agentA)).toEqual([])

    const withoutTool = await harness({ thresholds: [2], previewItems: 5 }, { todoTool: false })
    const agentB = await run(withoutTool, 'stale-plan-4', new MockAdapter([
      toolCallResponse('c1', 'probe', {}),
      toolCallResponse('c2', 'probe', {}),
      // The threshold is reached with no plan at all: capability absence must
      // stay silent rather than remind about a list that cannot exist.
      toolCallResponse('c3', 'probe', {}),
      textResponse('done'),
    ]))
    expect(reminders(agentB)).toEqual([])
  })

  it('ignores calls with no owning agent, which have no plan and no model to remind', async () => {
    const ctx = await harness({ thresholds: [1], previewItems: 5 })
    ctx.tools.register(defineContentToolFixture({
      name: 'probe',
      description: 'p',
      parameters: {},
      async execute() { return [{ type: 'text', text: 'ok' }] },
    }))
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('no-agent'),
      name: 'probe',
      arguments: {},
    })

    expect(result.additionalContexts).toBeUndefined()
  })

  it('restarts the count when the model rewrites the plan', async () => {
    const ctx = await harness({ thresholds: [3], previewItems: 5 })
    const agent = await run(ctx, 'stale-plan-5', new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: PLAN }),
      toolCallResponse('c2', 'probe', {}),
      toolCallResponse('c3', 'probe', {}),
      // Same list, written again: the projection reference moves, so the guard
      // treats this as a fresh plan and the next two calls must not remind.
      toolCallResponse('c4', 'todo_write', { todos: PLAN }),
      toolCallResponse('c5', 'probe', {}),
      toolCallResponse('c6', 'probe', {}),
      toolCallResponse('c7', 'probe', {}),
      textResponse('done'),
    ]))

    const found = reminders(agent)
    expect(found).toHaveLength(1)
    expect(found[0]!.source).toEqual(guardSource(2, 3))
    expect(found[0]!.text).toContain('has not been updated for 3 tool calls')
  })

  it('quotes at most previewItems open items and counts the rest', async () => {
    const ctx = await harness({ thresholds: [1], previewItems: 2 })
    const agent = await run(ctx, 'stale-plan-6', new MockAdapter([
      toolCallResponse('c1', 'todo_write', {
        todos: [
          { content: 'first open item', status: 'in_progress' },
          { content: 'second open item', status: 'pending' },
          { content: 'third open item', status: 'pending' },
          { content: 'fourth open item', status: 'pending' },
          { content: 'finished item', status: 'completed' },
        ],
      }),
      toolCallResponse('c2', 'probe', {}),
      textResponse('done'),
    ]))

    const found = reminders(agent)
    expect(found).toHaveLength(1)
    expect(found[0]!.text).toContain('still shows 4 unfinished item(s):')
    expect(found[0]!.text).toContain('- (in progress) first open item')
    expect(found[0]!.text).toContain('- second open item')
    expect(found[0]!.text).toContain('- …and 2 more')
    expect(found[0]!.text).not.toContain('- third open item')
    expect(found[0]!.text).not.toContain('- finished item')
    expect(found[0]!.source).toEqual(guardSource(4, 1))
  })

  it('head-truncates a long item line so one task cannot carry unbounded text', async () => {
    const ctx = await harness({ thresholds: [1], previewItems: 5 })
    const long = 'x'.repeat(200)
    const agent = await run(ctx, 'stale-plan-7', new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: [{ content: long, status: 'pending' }] }),
      toolCallResponse('c2', 'probe', {}),
      textResponse('done'),
    ]))

    const text = reminders(agent)[0]!.text
    expect(text).toContain(`- ${'x'.repeat(79)}…`)
    expect(text).not.toContain(long)
  })
})

describe('scope and delivery', () => {
  it('counts each session separately', async () => {
    const ctx = await harness({ thresholds: [2], previewItems: 5 })
    ctx.llm.registerAdapter(['mock-stale'], new MockAdapter([
      toolCallResponse('a1', 'todo_write', { todos: PLAN }),
      toolCallResponse('a2', 'probe', {}),
      toolCallResponse('a3', 'probe', {}),
      textResponse('done'),
    ]))
    ctx.llm.registerAdapter(['mock-quiet'], new MockAdapter([
      toolCallResponse('b1', 'todo_write', { todos: [{ content: 'nothing left', status: 'completed' }] }),
      toolCallResponse('b2', 'probe', {}),
      toolCallResponse('b3', 'probe', {}),
      textResponse('done'),
    ]))
    const stale = await ctx.agentLoop.create(SessionId('stale-plan-a'), { provider: 'mock-stale', model: 'mock' })
    const quiet = await ctx.agentLoop.create(SessionId('stale-plan-b'), { provider: 'mock-quiet', model: 'mock' })
    const staleIdle = waitForIdle(ctx, stale)
    const quietIdle = waitForIdle(ctx, quiet)
    stale.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    quiet.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await staleIdle
    await quietIdle

    expect(reminders(stale)).toHaveLength(1)
    expect(reminders(quiet)).toEqual([])
  })

  it('never blocks: the downstream decision survives and the reminder is prepended to earlier contexts', async () => {
    const ctx = await harness({ thresholds: [1], previewItems: 5 })
    ctx.on('tools/post-execute', async (_exec, _result, next) => {
      const downstream = await next()
      const later = createUserMessage({
        content: [{ type: 'text', text: 'later listener' }],
        source: { kind: 'plugin', plugin: 'test' },
      })
      return { ...downstream, additionalContexts: [...downstream.additionalContexts ?? [], later] }
    })
    const agent = await run(ctx, 'stale-plan-8', new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: PLAN }),
      toolCallResponse('c2', 'probe', {}),
      textResponse('done'),
    ]))

    // The later listener attaches its own context to every execution; on the
    // threshold call the guard's reminder precedes it in the same decision.
    expect(reminders(agent).map(entry => entry.text)).toEqual([
      'later listener',
      'Your to-do list has not been updated for 1 tool calls and still shows 2 unfinished item(s):\n'
      + '- (in progress) fix the widget\n'
      + '- write the report\n'
      + 'If any of them is finished, send the COMPLETE updated list with todo_write now: mark finished '
      + 'items completed as they finish (do not batch completions), and keep the items you are '
      + 'actively working on marked in_progress.',
      'later listener',
    ])
  })

  it('rides a blocked decision: a later veto still carries the reminder', async () => {
    const ctx = await harness({ thresholds: [1], previewItems: 5 })
    ctx.on('tools/post-execute', async (exec, _result, next) => {
      const downstream = await next()
      if (exec.name !== 'probe') return downstream
      return {
        kind: 'block',
        feedback: [{ type: 'text', text: 'blocked by policy' }],
        ...downstream.additionalContexts === undefined
          ? {}
          : { additionalContexts: downstream.additionalContexts },
      }
    })
    const agent = await run(ctx, 'stale-plan-10', new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: PLAN }),
      toolCallResponse('c2', 'probe', {}),
      textResponse('done'),
    ]))

    const blocked = agent.session.snapshotEvents().some(event => event.type === 'tool/result'
      && event.data.message.content.some(block => block.type === 'tool-result' && block.isError === true))
    expect(blocked).toBe(true)
    expect(reminders(agent).map(entry => entry.source)).toEqual([guardSource(2, 1)])
  })
})

describe('config validation', () => {
  const invalid: [string, Config][] = [
    ['empty thresholds', { thresholds: [], previewItems: 1 }],
    ['zero threshold', { thresholds: [0], previewItems: 1 }],
    ['fractional threshold', { thresholds: [1.5], previewItems: 1 }],
    ['duplicate thresholds', { thresholds: [2, 2], previewItems: 1 }],
    ['zero preview items', { thresholds: [1], previewItems: 0 }],
    ['fractional preview items', { thresholds: [1], previewItems: 1.5 }],
  ]

  for (const [label, config] of invalid) {
    it(`fails loud on ${label}`, async () => {
      const ctx = new Context()
      await mountAgentLoopTestDependencies(ctx)
      await expect(ctx.plugin(StalePlanReminder, config)).rejects.toThrow(/stale-plan-reminder/)
    })
  }

  it('accepts unsorted thresholds by normalizing them', async () => {
    const ctx = await harness({ thresholds: [5, 1], previewItems: 1 })
    const agent = await run(ctx, 'stale-plan-9', new MockAdapter([
      toolCallResponse('c1', 'todo_write', { todos: PLAN }),
      toolCallResponse('c2', 'probe', {}),
      toolCallResponse('c3', 'probe', {}),
      toolCallResponse('c4', 'probe', {}),
      toolCallResponse('c5', 'probe', {}),
      toolCallResponse('c6', 'probe', {}),
      textResponse('done'),
    ]))

    expect(reminders(agent).map(entry => entry.source)).toEqual([guardSource(2, 1), guardSource(2, 5)])
  })
})
