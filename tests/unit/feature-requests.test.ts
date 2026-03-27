/**
 * Tests for the 6 user feature requests.
 */

import { describe, it, expect } from 'vitest'
import {
  Swarm,
  createAgent,
  runFanOut,
  buildPlan,
} from '../../src/index.js'
import type { Provider, Task, LlmRequest, ResponseFormat } from '../../src/index.js'

function mockProvider(): Provider {
  return {
    name: 'mock',
    models: [{ model: 'mock', tier: 'cheap', inputCostPer1kTokens: 0.1, outputCostPer1kTokens: 0.3, contextWindow: 128000 }],
    async chat(req: LlmRequest) {
      // If responseFormat requested, return JSON
      if (req.responseFormat) {
        const json = JSON.stringify({ name: 'TypeScript', score: 95 })
        return {
          content: json,
          parsed: { name: 'TypeScript', score: 95 },
          model: 'mock', inputTokens: 100, outputTokens: 50, cachedInputTokens: 0,
          finishReason: 'stop' as const, durationMs: 50,
        }
      }
      return {
        content: 'plain response', model: 'mock', inputTokens: 100, outputTokens: 50,
        cachedInputTokens: 0, finishReason: 'stop' as const, durationMs: 50,
      }
    },
    estimateCost: () => 0.04,
  }
}

// ─── #1 + #5: Structured Output ───

describe('Feature: Structured Output (responseFormat)', () => {
  it('context.llm<T>() returns parsed object when responseFormat is set', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })

    interface LangScore { name: string; score: number }

    const agent = swarm.agent({
      name: 'scorer',
      role: 'score languages',
      model: { provider: 'mock', model: 'mock' },
      execute: async (input, ctx) => {
        const result = await ctx.llm<LangScore>('Score TypeScript', {
          responseFormat: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: { name: { type: 'string' }, score: { type: 'number' } },
              required: ['name', 'score'],
            },
          },
        })
        return result
      },
    })

    const result = await swarm.run('test')

    // Output should be the parsed object, not a string
    expect(result.output).toEqual({ name: 'TypeScript', score: 95 })

    // Cost should be tracked (not bypassed)
    expect(result.cost.totalTokens).toBeGreaterThan(0)
    expect(result.cost.totalCostCents).toBeGreaterThan(0)
  })

  it('context.llm() still returns string without responseFormat', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({
      name: 'plain',
      role: 'r',
      model: { provider: 'mock', model: 'mock' },
      execute: async (input, ctx) => ctx.llm('hello'),
    })

    const result = await swarm.run('test')
    expect(typeof result.output).toBe('string')
    expect(result.output).toBe('plain response')
  })

  it('responseFormat flows through to LlmRequest', async () => {
    let capturedRequest: LlmRequest | null = null
    const provider: Provider = {
      ...mockProvider(),
      async chat(req) {
        capturedRequest = req
        return { content: '{}', parsed: {}, model: 'mock', inputTokens: 50, outputTokens: 25, cachedInputTokens: 0, finishReason: 'stop', durationMs: 20 }
      },
    }

    const swarm = new Swarm({ providers: [provider] })
    swarm.agent({
      name: 'test',
      role: 'r',
      model: { provider: 'mock', model: 'mock' },
      execute: async (_, ctx) => ctx.llm('test', {
        responseFormat: { type: 'json_schema', schema: { type: 'object' }, name: 'MySchema' },
      }),
    })

    await swarm.run('test')
    expect(capturedRequest?.responseFormat).toBeDefined()
    expect(capturedRequest?.responseFormat?.name).toBe('MySchema')
    expect(capturedRequest?.responseFormat?.schema).toEqual({ type: 'object' })
  })
})

// ─── #2: Fan-Out Pattern ───

describe('Feature: runFanOut()', () => {
  it('runs all agents in parallel with same input', async () => {
    const callOrder: string[] = []
    const agents = ['a', 'b', 'c'].map((name) =>
      createAgent({ name, role: 'r', execute: async (input) => { callOrder.push(name); return `${name}: ${input}` } })
    )

    const task: Task = { id: 't', description: 'test', input: 'shared-input', budget: {} }
    const result = await runFanOut(task, { agents, input: 'override-input' }, [mockProvider()], {})

    expect(result.output.length).toBe(3)
    expect(result.output).toContain('a: override-input')
    expect(result.output).toContain('b: override-input')
    expect(result.output).toContain('c: override-input')
  })

  it('individual failures dont kill the batch when optional=true', async () => {
    const agents = [
      createAgent({ name: 'ok1', role: 'r', execute: async () => 'success' }),
      createAgent({ name: 'fail', role: 'r', execute: async () => { throw new Error('boom') } }),
      createAgent({ name: 'ok2', role: 'r', execute: async () => 'success' }),
    ]

    const task: Task = { id: 't', description: 'test', input: 'go', budget: {} }
    const result = await runFanOut(task, { agents, optional: true }, [mockProvider()], {})

    // 2 successful outputs
    expect(result.agentOutputs.filter((o) => o.status === 'completed').length).toBe(2)
    expect(result.allResults.filter((o) => o.status === 'failed').length).toBe(1)
  })
})

// ─── #3: plan() options ───

describe('Feature: plan() with input/parallel/stepsOptional', () => {
  it('parallel=true removes all dependencies', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'a', role: 'r' })
    swarm.agent({ name: 'b', role: 'r' })
    swarm.agent({ name: 'c', role: 'r' })

    const plan = await swarm.plan('test', { parallel: true })
    for (const step of plan.steps) {
      expect(step.dependencies).toEqual([])
    }
  })

  it('input overrides task input for all steps', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'a', role: 'r' })

    const plan = await swarm.plan('test', { input: { custom: 'data' } })
    for (const step of plan.steps) {
      expect(step.input).toEqual({ type: 'literal', value: { custom: 'data' } })
    }
  })

  it('stepsOptional=true marks all steps optional', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'a', role: 'r' })
    swarm.agent({ name: 'b', role: 'r' })

    const plan = await swarm.plan('test', { stepsOptional: true })
    for (const step of plan.steps) {
      expect(step.optional).toBe(true)
    }
  })

  it('all three combined = fan-out via plan()', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'a', role: 'r', execute: async (input) => `a(${input})` })
    swarm.agent({ name: 'b', role: 'r', execute: async (input) => `b(${input})` })

    const plan = await swarm.plan('test', {
      input: 'shared',
      parallel: true,
      stepsOptional: true,
    })

    expect(plan.steps.length).toBeGreaterThan(0)
    for (const step of plan.steps) {
      expect(step.dependencies).toEqual([])
      expect(step.optional).toBe(true)
      expect(step.input).toEqual({ type: 'literal', value: 'shared' })
    }
  })
})

// ─── #4: Status on AgentOutput ───

describe('Feature: AgentOutput status + allResults', () => {
  it('successful agents have status=completed', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'ok', role: 'r', execute: async () => 'done' })

    const result = await swarm.run('test')
    expect(result.agentOutputs[0]!.status).toBe('completed')
    expect(result.allResults[0]!.status).toBe('completed')
  })

  it('failed agents appear in allResults with status=failed and error', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    const ok = swarm.agent({ name: 'ok', role: 'r', execute: async () => 'done' })
    const fail = swarm.agent({ name: 'fail', role: 'r', execute: async () => { throw new Error('agent crashed') } })

    const plan = await swarm.plan('test', {
      agents: [ok, fail],
      parallel: true,
      stepsOptional: true,
    })
    const result = await swarm.execute(plan)

    const completed = result.allResults.filter((r) => r.status === 'completed')
    const failed = result.allResults.filter((r) => r.status === 'failed')

    expect(completed.length).toBe(1)
    expect(failed.length).toBe(1)
    expect(failed[0]!.error).toBe('agent crashed')
    expect(failed[0]!.agentName).toBe('fail')
  })

  it('agentOutputs only contains successful agents (backward compat)', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    const ok = swarm.agent({ name: 'ok', role: 'r', execute: async () => 'done' })
    const fail = swarm.agent({ name: 'fail', role: 'r', execute: async () => { throw new Error('boom') } })

    const plan = await swarm.plan('test', { agents: [ok, fail], parallel: true, stepsOptional: true })
    const result = await swarm.execute(plan)

    // agentOutputs = only completed (backward compatible)
    expect(result.agentOutputs.every((o) => o.status === 'completed')).toBe(true)
    // allResults = everything
    expect(result.allResults.length).toBeGreaterThan(result.agentOutputs.length)
  })
})

// ─── #6: result.events ───

describe('Feature: result.events array', () => {
  it('collects all events during execution', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'worker', role: 'r', execute: async () => 'done' })

    const result = await swarm.run('test')

    expect(result.events.length).toBeGreaterThan(0)
    const types = result.events.map((e) => e.type)
    expect(types).toContain('step:start')
    expect(types).toContain('step:complete')
    expect(types).toContain('execution:complete')
  })

  it('events include plan:created', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'worker', role: 'r', execute: async () => 'done' })

    const result = await swarm.run('test')
    expect(result.events.some((e) => e.type === 'plan:created')).toBe(true)
  })

  it('events are available without setting up swarm.on() listeners', async () => {
    // This is the whole point — no need for event listeners in async/streaming contexts
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'a', role: 'r', execute: async () => 'ok' })

    const result = await swarm.run('test')

    // Can replay events after the fact
    for (const event of result.events) {
      expect(event.type).toBeTruthy()
    }
  })
})
