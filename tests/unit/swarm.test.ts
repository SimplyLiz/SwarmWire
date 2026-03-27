import { describe, it, expect } from 'vitest'
import { Swarm } from '../../src/core/swarm.js'
import type { Provider } from '../../src/types/provider.js'
import type { SwarmEvent } from '../../src/types/pattern.js'

function mockProvider(): Provider {
  return {
    name: 'mock',
    models: [{ model: 'mock-model', tier: 'cheap', inputCostPer1kTokens: 0.1, outputCostPer1kTokens: 0.3, contextWindow: 128000 }],
    async chat() {
      return {
        content: 'mock response',
        model: 'mock-model',
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 0,
        finishReason: 'stop' as const,
        durationMs: 50,
      }
    },
    estimateCost: () => 0.06,
  }
}

describe('Swarm', () => {
  it('creates and registers agents', () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    const agent = swarm.agent({
      name: 'test-agent',
      role: 'test',
      model: { provider: 'mock', model: 'mock-model' },
    })

    expect(agent.name).toBe('test-agent')
    expect(agent.modelTier).toBe('standard')
  })

  it('runs a simple task with string input', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({
      name: 'worker',
      role: 'do stuff',
      execute: async (input) => `done: ${input}`,
    })

    const result = await swarm.run('hello world')
    expect(result.output).toBe('done: hello world')
    expect(result.cost).toBeDefined()
    expect(result.plan).toBeDefined()
  })

  it('runs with pipeline pattern', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    const step1 = swarm.agent({
      name: 'step1',
      role: 'first step',
      execute: async (input) => `step1(${input})`,
    })
    const step2 = swarm.agent({
      name: 'step2',
      role: 'second step',
      execute: async (input) => `step2(${input})`,
    })

    const result = await swarm.run('input', {
      pattern: 'pipeline',
      stages: [
        { name: 'first', agent: step1 },
        { name: 'second', agent: step2 },
      ],
    })

    expect(result.output).toBe('step2(step1(input))')
  })

  it('emits events during execution', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({
      name: 'worker',
      role: 'work',
      execute: async (input) => input,
    })

    const events: SwarmEvent[] = []
    swarm.on('step:start', (e) => events.push(e))
    swarm.on('step:complete', (e) => events.push(e))
    swarm.on('execution:complete', (e) => events.push(e))

    await swarm.run('test')

    expect(events.some((e) => e.type === 'step:start')).toBe(true)
    expect(events.some((e) => e.type === 'step:complete')).toBe(true)
    expect(events.some((e) => e.type === 'execution:complete')).toBe(true)
  })

  it('plans without executing', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'a1', role: 'work' })
    swarm.agent({ name: 'a2', role: 'work' })

    const plan = await swarm.plan('research topic')
    expect(plan.status).toBe('draft')
    expect(plan.steps.length).toBeGreaterThan(0)
    expect(plan.estimatedCost.estimatedTokens).toBeGreaterThan(0)
  })

  it('executes a pre-built plan', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    const agent = swarm.agent({
      name: 'worker',
      role: 'work',
      execute: async (input) => `executed: ${input}`,
    })

    const plan = await swarm.plan('test task')
    const result = await swarm.execute(plan)

    expect(result.output).toBe('executed: test task')
  })

  it('respects budget limits', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({
      name: 'worker',
      role: 'work',
      execute: async (input) => input,
    })

    const result = await swarm.run('test', {
      budget: { maxCostCents: 1000 },
    })

    expect(result.cost.totalCostCents).toBeDefined()
  })
})
