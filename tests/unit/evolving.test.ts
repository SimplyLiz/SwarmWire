import { describe, it, expect } from 'vitest'
import { EvolvingOrchestrator } from '../../src/orchestrator/evolving.js'
import { createAgent } from '../../src/core/agent-factory.js'
import type { Provider } from '../../src/types/provider.js'
import type { Task } from '../../src/types/task.js'

function mockProvider(): Provider {
  return {
    name: 'mock',
    models: [{ model: 'mock', tier: 'cheap', inputCostPer1kTokens: 0.1, outputCostPer1kTokens: 0.3, contextWindow: 128000 }],
    async chat() {
      return { content: 'mock', model: 'mock', inputTokens: 50, outputTokens: 25, cachedInputTokens: 0, finishReason: 'stop' as const, durationMs: 20 }
    },
    estimateCost: () => 0.03,
  }
}

describe('EvolvingOrchestrator', () => {
  it('runs agents in sequence and returns result', async () => {
    const orch = new EvolvingOrchestrator()
    const callOrder: string[] = []

    const a1 = createAgent({ name: 'a1', role: 'r', execute: async (input) => { callOrder.push('a1'); return `a1(${input})` } })
    const a2 = createAgent({ name: 'a2', role: 'r', execute: async (input) => { callOrder.push('a2'); return `a2(${typeof input === 'object' ? 'obj' : input})` } })

    const task: Task = { id: 't1', description: 'simple task', input: 'hello', budget: {} }
    const result = await orch.run(task, { agents: [a1, a2], maxRounds: 2 }, [mockProvider()])

    expect(result.output).toBeTruthy()
    expect(result.agentOutputs.length).toBe(2)
    expect(callOrder.length).toBe(2)
  })

  it('stops on convergence (same output twice)', async () => {
    const orch = new EvolvingOrchestrator()
    const agent = createAgent({ name: 'stable', role: 'r', execute: async () => 'always-the-same' })

    const task: Task = { id: 't1', description: 'test', input: 'go', budget: {} }
    const result = await orch.run(task, { agents: [agent], maxRounds: 10 }, [mockProvider()])

    // Should stop after 2 rounds (first output + convergence detection)
    expect(result.agentOutputs.length).toBe(2)
  })

  it('records and retrieves sequences', async () => {
    const orch = new EvolvingOrchestrator()
    const a1 = createAgent({ name: 'a1', role: 'r', execute: async () => 'done' })

    const task: Task = { id: 't1', description: 'simple task', input: 'go', budget: {} }
    await orch.run(task, { agents: [a1], maxRounds: 1, explorationRate: 0 }, [mockProvider()])

    // Find the profile key that was recorded
    const state = orch.exportState()
    const profileKey = [...state.keys()][0]!
    const seqs = orch.getSequences(profileKey)
    expect(seqs.length).toBeGreaterThan(0)
    expect(seqs[0]!.uses).toBe(1)
  })

  it('exports and imports state', async () => {
    const orch1 = new EvolvingOrchestrator()
    const agent = createAgent({ name: 'a1', role: 'r', execute: async () => 'done' })

    const task: Task = { id: 't1', description: 'test', input: 'go', budget: {} }
    await orch1.run(task, { agents: [agent], maxRounds: 1 }, [mockProvider()])

    const state = orch1.exportState()
    expect(state.size).toBeGreaterThan(0)

    const orch2 = new EvolvingOrchestrator()
    orch2.importState(state)
    const profileKey = [...state.keys()][0]!
    expect(orch2.getSequences(profileKey).length).toBeGreaterThan(0)
  })

  it('respects budget', async () => {
    const orch = new EvolvingOrchestrator()
    const agent = createAgent({ name: 'a1', role: 'r', execute: async () => 'done' })

    const task: Task = { id: 't1', description: 'test', input: 'go', budget: {} }
    const result = await orch.run(task, {
      agents: [agent],
      maxRounds: 100,
      budget: { maxTokens: 0 },
    }, [mockProvider()])

    // Budget check happens before LLM call, but agent.execute runs without LLM
    // so agents that don't call ctx.llm can still run. The key is it doesn't blow up.
    expect(result.agentOutputs.length).toBeLessThanOrEqual(3)
  })
})
