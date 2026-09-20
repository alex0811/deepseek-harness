// Real-composition proof for the stale-plan guard: the package loads and is
// configured through the real Loader (`cordis.yml`), and the reminder it
// injects is produced by the same tool pipeline an agent loop uses. Direct
// `ctx.tools.execute` calls carry the execution's owner agent, which is the
// only input the guard needs to read that Session's plan projection.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import * as StalePlanReminder from '@deepseek-ai/dsh-stale-plan-reminder'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Register one idle agent fixture owning its own Session, as the loop would. */
async function agent(ctx: Context, id: string): Promise<Agent> {
  const scope = ctx.plugin(() => {})
  const session = Session.create(SessionId(id))
  const value: Agent = {
    id: SessionId(id),
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx: scope.ctx,
    followup: () => {},
    steer: () => {},
    inject: () => {},
    send: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.agents.register(value)
  return value
}

/**
 * Boot a cordis.yml carrying the guard's config block beside the to-do tool
 * whose projection the guard reads.
 * @param configLines - YAML lines nested under the guard's `config:` key.
 * @returns the booted context.
 */
async function boot(configLines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-stale-plan-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-tool-todo'",
    '  config:',
    '    allowParallelInProgress: true',
    "- name: '@deepseek-ai/dsh-stale-plan-reminder'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-tool-todo', ToolTodo],
    ['@deepseek-ai/dsh-stale-plan-reminder', StalePlanReminder],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return ctx
}

/** Run one probe call for an owner and return the contexts the pipeline attached. */
async function probe(ctx: Context, owner: Agent, callId: string): Promise<readonly { content: { type: string; text?: string }[] }[]> {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(callId),
    name: 'probe',
    arguments: {},
    agent: owner,
  })
  return result.additionalContexts ?? []
}

describe('stale-plan reminder through the real Loader composition', () => {
  it('reads thresholds and previewItems from cordis.yml and injects the reminder', async () => {
    const ctx = await boot(['    thresholds: [2]', '    previewItems: 1'])
    ctx.tools.register(defineContentToolFixture({
      name: 'probe',
      description: 'p',
      parameters: {},
      async execute() { return [{ type: 'text', text: 'ok' }] },
    }))
    const owner = await agent(ctx, 'stale-plan-loader')
    owner.session.append('todo/write', {
      todos: [
        { content: 'open one', status: 'in_progress' },
        { content: 'open two', status: 'pending' },
      ],
    })

    // The plan was appended outside a tool call, so the first probe only
    // establishes the counter; the threshold lands on the third.
    expect(await probe(ctx, owner, 'call-1')).toEqual([])
    expect(await probe(ctx, owner, 'call-2')).toEqual([])
    const contexts = await probe(ctx, owner, 'call-3')
    expect(contexts).toHaveLength(1)
    const text = contexts[0]!.content.flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : []).join('\n')
    expect(text).toBe([
      'Your to-do list has not been updated for 2 tool calls and still shows 2 unfinished item(s):',
      '- (in progress) open one',
      '- …and 1 more',
      'If any of them is finished, send the COMPLETE updated list with todo_write now: mark finished '
      + 'items completed as they finish (do not batch completions), and keep the items you are '
      + 'actively working on marked in_progress.',
    ].join('\n'))
  }, 30_000)

  it('fails loud at load when the config block is missing a required field', async () => {
    await expect(boot(['    thresholds: [2]'])).rejects.toThrow(/previewItems/)
  }, 30_000)
})
