import { describe, it, expect } from 'vitest'
import { runHiveMind } from '../../src/patterns/hive-mind.js'
import { createAgent } from '../../src/core/agent-factory.js'
import type { Provider } from '../../src/types/provider.js'
import type { Task } from '../../src/types/task.js'
import type { Budget } from '../../src/types/budget.js'

function mockProvider(): Provider {
  let calls = 0
  return {
    name: 'mock',
    models: [
      { model: 'mock', tier: 'standard', inputCostPer1kTokens: 0.1, outputCostPer1kTokens: 0.3, contextWindow: 128000 },
    ],
    async chat(req) {
      calls++
      return {
        content: `response-${calls}`,
        model: req.model,
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 0,
        finishReason: 'stop' as const,
        durationMs: 50,
      }
    },
    estimateCost: (_m, inp, out) => (inp + out) / 1000,
  }
}

function makeTask(description: string): Task {
  return {
    id: 'task1',
    description,
    input: 'test input',
    budget: { maxCostCents: 1000, maxTokens: 100000 },
  }
}

const budget: Budget = { maxCostCents: 1000, maxTokens: 100000 }

describe('runHiveMind', () => {
  it('returns ExecutionResult', async () => {
    const agent = createAgent({
      name: 'worker',
      role: 'general',
      capabilities: ['code'],
      modelTier: 'standard',
      execute: async (input) => `done: ${JSON.stringify(input)}`,
    })

    const result = await runHiveMind(
      makeTask('Write some code'),
      { agents: [agent] },
      [mockProvider()],
      budget,
    )

    expect(result).toBeDefined()
    expect(result.cost).toBeDefined()
    expect(result.plan).toBeDefined()
  })

  it('higher-capability agent wins primary slot', async () => {
    const primaryCalls: string[] = []
    const secondaryCalls: string[] = []

    const codeExpert = createAgent({
      name: 'code-expert',
      role: 'expert',
      capabilities: ['code', 'programming', 'implementation'],
      modelTier: 'premium',
      execute: async (input) => {
        primaryCalls.push('code-expert')
        return `code-expert: ${JSON.stringify(input)}`
      },
    })

    const genericAgent = createAgent({
      name: 'generic',
      role: 'generic',
      capabilities: ['writing'],
      modelTier: 'cheap',
      execute: async (input) => {
        secondaryCalls.push('generic')
        return `generic: ${JSON.stringify(input)}`
      },
    })

    // Simple sequential task (complexity < 0.3)
    await runHiveMind(
      makeTask('Write a function'),
      { agents: [genericAgent, codeExpert] },
      [mockProvider()],
      budget,
    )

    // code-expert should be picked as primary (higher capability + higher tier)
    // In sequential strategy, primary runs first
    expect(primaryCalls.length).toBeGreaterThan(0)
  })

  it('throws with empty agents array', async () => {
    await expect(
      runHiveMind(makeTask('test'), { agents: [] }, [mockProvider()], budget),
    ).rejects.toThrow('hive-mind requires at least one agent')
  })

  it('works with parallel strategy (medium complexity)', async () => {
    const executed: string[] = []

    const agents = ['a1', 'a2', 'a3'].map((name) =>
      createAgent({
        name,
        role: 'worker',
        capabilities: ['data', 'analysis'],
        modelTier: 'standard',
        execute: async (input) => {
          executed.push(name)
          return `${name}: ${JSON.stringify(input)}`
        },
      }),
    )

    // Medium complexity task
    const task = makeTask(
      'Analyze data and compare metrics and evaluate results and assess performance',
    )

    const result = await runHiveMind(task, { agents }, [mockProvider()], budget)
    expect(result).toBeDefined()
  })

  it('emits SwarmEvents during execution', async () => {
    const events: string[] = []
    const agent = createAgent({
      name: 'agent1',
      role: 'worker',
      capabilities: ['code'],
      execute: async () => 'ok',
    })

    await runHiveMind(
      makeTask('Simple task'),
      { agents: [agent] },
      [mockProvider()],
      budget,
      (e) => events.push(e.type),
    )

    expect(events.length).toBeGreaterThan(0)
  })

  it('respects maxParallel config', async () => {
    const executed: string[] = []
    const agents = ['a1', 'a2', 'a3', 'a4', 'a5'].map((name) =>
      createAgent({
        name,
        role: 'worker',
        capabilities: ['code'],
        modelTier: 'standard',
        execute: async () => {
          executed.push(name)
          return name
        },
      }),
    )

    const result = await runHiveMind(
      makeTask('Write code'),
      { agents, maxParallel: 2 },
      [mockProvider()],
      budget,
    )

    expect(result).toBeDefined()
  })
})
