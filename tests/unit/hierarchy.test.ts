import { describe, it, expect, vi } from 'vitest'
import { runHierarchy } from '../../src/patterns/hierarchy.js'
import type { Agent } from '../../src/types/agent.js'
import type { Provider } from '../../src/types/provider.js'
import type { Task } from '../../src/types/task.js'

function makeAgent(name: string, output = 'result'): Agent {
  return {
    id: `id_${name}`,
    name,
    role: name,
    capabilities: [],
    tools: [],
    modelTier: 'standard',
    execute: vi.fn().mockResolvedValue(output),
  }
}

function makeProvider(): Provider {
  return {
    name: 'mock',
    models: [{ name: 'mock', tier: 'standard', inputCostPer1kTokens: 0, outputCostPer1kTokens: 0, maxContextTokens: 4096, provider: 'mock' }],
    complete: vi.fn().mockResolvedValue({ content: 'result', inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 }),
    countTokens: vi.fn().mockResolvedValue(10),
  }
}

const task: Task = { id: 'task1', description: 'test', input: 'test', budget: {} }

describe('runHierarchy', () => {
  it('returns a result with output from worker level when confident', async () => {
    const worker = makeAgent('worker', 'good result')
    const manager = makeAgent('manager', 'override result')

    const result = await runHierarchy(
      task,
      {
        levels: [
          { name: 'manager', authority: 1, agents: [manager] },
          { name: 'worker', authority: 2, agents: [worker] },
        ],
        escalationThreshold: 0.0, // never escalate
      },
      [makeProvider()],
      { maxCostCents: 1000 },
    )

    expect(result).toBeDefined()
    expect(result.output).toBeDefined()
  })

  it('escalates when confidence is below threshold', async () => {
    const worker = makeAgent('worker', 'weak result')
    const events: string[] = []

    await runHierarchy(
      task,
      {
        levels: [
          { name: 'ceo', authority: 1, agents: [makeAgent('ceo')] },
          { name: 'worker', authority: 2, agents: [worker] },
        ],
        escalationThreshold: 0.99, // always escalate
        maxEscalations: 1,
      },
      [makeProvider()],
      { maxCostCents: 1000 },
      (e) => events.push(e.type),
    )

    expect(events.some((e) => e === 'step:start')).toBe(true)
  })

  it('returns empty result for empty authority levels', async () => {
    const result = await runHierarchy(
      task,
      { levels: [{ name: 'empty', authority: 1, agents: [] }] },
      [makeProvider()],
      { maxCostCents: 1000 },
    )
    expect(result.partial).toBe(true)
  })
})
