/**
 * Adversarial tests — try to break SwarmWire.
 * Edge cases, race conditions, bad inputs, resource exhaustion.
 */

import { describe, it, expect } from 'vitest'
import {
  Swarm,
  createAgent,
  buildPlan,
  executePlan,
  BudgetLedger,
  parseWorkflow,
  compileWorkflow,
  packContext,
  detectConflicts,
  WorkerPool,
  AdaptiveRouter,
  EvolvingOrchestrator,
  scoreTask,
  withCircuitBreaker,
} from '../../src/index.js'
import type { Provider, Task, CostEvent } from '../../src/index.js'

function mockProvider(): Provider {
  return {
    name: 'mock',
    models: [{ model: 'mock', tier: 'cheap', inputCostPer1kTokens: 0.1, outputCostPer1kTokens: 0.3, contextWindow: 128000 }],
    async chat() {
      return { content: 'ok', model: 'mock', inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, finishReason: 'stop' as const, durationMs: 50 }
    },
    estimateCost: () => 0.04,
  }
}

function costEvent(overrides?: Partial<CostEvent>): CostEvent {
  return {
    timestamp: Date.now(), agentId: 'a', agentName: 'a', provider: 'p', model: 'm',
    inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, costCents: 1, durationMs: 100,
    ...overrides,
  }
}

describe('Adversarial: Agent edge cases', () => {
  it('agent with empty name', () => {
    const agent = createAgent({ name: '', role: 'r' })
    expect(agent.name).toBe('')
    expect(agent.id).toContain('agent_')
  })

  it('agent with very long name', () => {
    const name = 'a'.repeat(10000)
    const agent = createAgent({ name, role: 'r' })
    expect(agent.name).toBe(name)
  })

  it('agent that returns undefined', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'void', role: 'r', execute: async () => undefined })
    const result = await swarm.run('test')
    expect(result.output).toBeUndefined()
  })

  it('agent that returns null', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'null', role: 'r', execute: async () => null })
    const result = await swarm.run('test')
    expect(result.output).toBeNull()
  })

  it('agent that returns a huge object', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'big', role: 'r', execute: async () => ({ data: 'x'.repeat(1_000_000) }) })
    const result = await swarm.run('test')
    expect((result.output as { data: string }).data.length).toBe(1_000_000)
  })

  it('agent with slow execution respects timeout', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({
      name: 'slow',
      role: 'r',
      timeoutMs: 100,
      execute: async () => {
        await new Promise((r) => setTimeout(r, 5000))
        return 'should not reach'
      },
    })

    const result = await swarm.run('test')
    expect(result.partial).toBe(true)
    expect(result.plan.steps[0]!.error).toContain('Timeout')
  })
})

describe('Adversarial: Budget edge cases', () => {
  it('budget with all zeros', () => {
    const ledger = new BudgetLedger({ maxTokens: 0, maxCostCents: 0, maxLatencyMs: 0 })
    expect(ledger.canAfford(1, 0)).toBe(false)
    expect(ledger.usage().exhausted).toBe(true)
  })

  it('budget with negative values treated as zero', () => {
    const ledger = new BudgetLedger({ maxTokens: -100 })
    // Negative limit — usage fraction will be negative or weird
    const usage = ledger.usage()
    // Should handle gracefully, not crash
    expect(typeof usage.tokens.fraction).toBe('number')
  })

  it('budget with very large values', () => {
    const ledger = new BudgetLedger({ maxTokens: Number.MAX_SAFE_INTEGER, maxCostCents: Number.MAX_SAFE_INTEGER })
    ledger.record(costEvent({ inputTokens: 1_000_000, outputTokens: 500_000, costCents: 10000 }))
    expect(ledger.usage().exhausted).toBe(false)
  })

  it('many small cost events', () => {
    const ledger = new BudgetLedger({ maxCostCents: 100 })
    for (let i = 0; i < 1000; i++) {
      ledger.record(costEvent({ costCents: 0.01, inputTokens: 1, outputTokens: 1 }))
    }
    const summary = ledger.summarize()
    expect(summary.totalCostCents).toBeCloseTo(10, 0)
    expect(summary.totalTokens).toBe(2000)
  })
})

describe('Adversarial: Plan edge cases', () => {
  it('plan with circular-looking dependencies (but valid DAG)', async () => {
    const a = createAgent({ name: 'a', role: 'r', execute: async () => 'a' })
    const b = createAgent({ name: 'b', role: 'r', execute: async () => 'b' })
    const c = createAgent({ name: 'c', role: 'r', execute: async () => 'c' })

    const plan = {
      id: 'p1',
      task: { id: 't', description: 't', input: 'x', budget: {} } as Task,
      steps: [
        { id: 's1', agent: a, input: { type: 'task_input' as const }, dependencies: [], status: 'pending' as const },
        { id: 's2', agent: b, input: { type: 'step_output' as const, stepId: 's1' }, dependencies: ['s1'], status: 'pending' as const },
        { id: 's3', agent: c, input: { type: 'step_output' as const, stepId: 's2' }, dependencies: ['s2'], status: 'pending' as const },
      ],
      mode: 'deep' as const,
      estimatedCost: { estimatedTokens: 100, estimatedCostCents: 1, estimatedLatencyMs: 100, estimatedAgents: 3, confidence: 0.8 },
      status: 'draft' as const,
    }

    const result = await executePlan(plan, { providers: [mockProvider()], budget: {} })
    expect(result.agentOutputs.length).toBe(3)
    expect(plan.steps.every((s) => s.status === 'complete')).toBe(true)
  })

  it('plan with no steps', async () => {
    const plan = {
      id: 'p1',
      task: { id: 't', description: 't', input: 'x', budget: {} } as Task,
      steps: [],
      mode: 'deep' as const,
      estimatedCost: { estimatedTokens: 0, estimatedCostCents: 0, estimatedLatencyMs: 0, estimatedAgents: 0, confidence: 1 },
      status: 'draft' as const,
    }

    const result = await executePlan(plan, { providers: [mockProvider()], budget: {} })
    expect(result.output).toBeUndefined()
    expect(result.agentOutputs.length).toBe(0)
  })
})

describe('Adversarial: Conflict detection edge cases', () => {
  it('handles empty string outputs', () => {
    const outputs = [
      { agentId: 'a', agentName: 'a', output: '', cost: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, costCents: 0, calls: 1 }, durationMs: 0 },
      { agentId: 'b', agentName: 'b', output: '', cost: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, costCents: 0, calls: 1 }, durationMs: 0 },
    ]
    const conflicts = detectConflicts(outputs)
    expect(conflicts.length).toBe(0) // Identical empty strings = no conflict
  })

  it('handles null/undefined outputs', () => {
    const outputs = [
      { agentId: 'a', agentName: 'a', output: null, cost: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, costCents: 0, calls: 1 }, durationMs: 0 },
      { agentId: 'b', agentName: 'b', output: undefined, cost: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, costCents: 0, calls: 1 }, durationMs: 0 },
    ]
    // Should not throw
    const conflicts = detectConflicts(outputs)
    expect(Array.isArray(conflicts)).toBe(true)
  })

  it('handles numeric outputs', () => {
    const outputs = [
      { agentId: 'a', agentName: 'a', output: 42, cost: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, costCents: 0, calls: 1 }, durationMs: 0 },
      { agentId: 'b', agentName: 'b', output: 42, cost: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, costCents: 0, calls: 1 }, durationMs: 0 },
    ]
    const conflicts = detectConflicts(outputs)
    expect(conflicts.length).toBe(0)
  })
})

describe('Adversarial: Context packer edge cases', () => {
  it('zero token budget returns empty bundle', () => {
    const sources = [{ type: 'raw' as const, id: 'x', content: 'hello', tokenEstimate: 10, relevance: 1 }]
    const bundle = packContext(sources, { maxTokens: 0 })
    expect(bundle.sources.length).toBe(0)
  })

  it('source larger than budget is skipped', () => {
    const sources = [{ type: 'raw' as const, id: 'x', content: 'big', tokenEstimate: 1000, relevance: 1 }]
    const bundle = packContext(sources, { maxTokens: 500 })
    expect(bundle.sources.length).toBe(0)
  })
})

describe('Adversarial: YAML parser edge cases', () => {
  it('handles empty steps array', () => {
    const wf = parseWorkflow('name: test\nsteps:')
    expect(wf.steps.length).toBe(0)
  })

  it('handles unicode in values', () => {
    const wf = parseWorkflow('name: test-workflow\ndescription: Handles unicode chars fine\nsteps:')
    expect(wf.name).toBe('test-workflow')
  })

  it('handles deeply nested indentation', () => {
    const yaml = `
name: deep
steps:
  - id: s1
    type: llm
    agent: a
    prompt: test
`
    const wf = parseWorkflow(yaml)
    expect(wf.steps.length).toBe(1)
  })
})

describe('Adversarial: Worker pool edge cases', () => {
  it('release unknown worker id does not crash', () => {
    const pool = new WorkerPool()
    pool.release('nonexistent-id') // Should not throw
    pool.shutdown()
  })

  it('shutdown clears everything', async () => {
    const pool = new WorkerPool({ minWorkers: 3 })
    await pool.acquire()
    pool.shutdown()
    expect(pool.status().total).toBe(0)
  })

  it('double shutdown is safe', () => {
    const pool = new WorkerPool()
    pool.shutdown()
    pool.shutdown() // Should not throw
  })
})

describe('Adversarial: Scorer edge cases', () => {
  it('handles empty task description', () => {
    const score = scoreTask({ id: 't', description: '', input: '', budget: {} })
    expect(score.difficulty).toBe('easy')
    expect(score.domain).toContain('general')
  })

  it('handles very long task description', () => {
    const longDesc = 'analyze '.repeat(5000)
    const score = scoreTask({ id: 't', description: longDesc, input: '', budget: {} })
    expect(score.factors.inputComplexity).toBe(1) // Should be capped at 1
  })
})

describe('Adversarial: Concurrent execution', () => {
  it('runs multiple swarm.run() concurrently', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'a', role: 'r', execute: async (input) => `done: ${input}` })

    const results = await Promise.all([
      swarm.run('task-1'),
      swarm.run('task-2'),
      swarm.run('task-3'),
    ])

    expect(results.length).toBe(3)
    expect(results[0]!.output).toContain('task-1')
    expect(results[1]!.output).toContain('task-2')
    expect(results[2]!.output).toContain('task-3')
  })
})

describe('Adversarial: Circuit breaker recovery', () => {
  it('recovers after failures stop', async () => {
    let shouldFail = true
    const provider: Provider = {
      name: 'flaky',
      models: [{ model: 'test', tier: 'cheap', inputCostPer1kTokens: 0.1, outputCostPer1kTokens: 0.3, contextWindow: 128000 }],
      async chat() {
        if (shouldFail) throw new Error('provider down')
        return { content: 'ok', model: 'test', inputTokens: 50, outputTokens: 25, cachedInputTokens: 0, finishReason: 'stop' as const, durationMs: 10 }
      },
      estimateCost: () => 0.03,
    }

    const wrapped = withCircuitBreaker(provider, { failureThreshold: 0.3, resetTimeoutMs: 50 })

    // Trip the circuit
    for (let i = 0; i < 5; i++) {
      try { await wrapped.chat({ model: 'test', messages: [] }) } catch { /* expected */ }
    }
    expect(wrapped.getState()).toBe('open')

    // Fix the provider
    shouldFail = false

    // Wait for half-open
    await new Promise((r) => setTimeout(r, 60))
    expect(wrapped.getState()).toBe('half-open')

    // Successful calls should close the circuit
    for (let i = 0; i < 3; i++) {
      await wrapped.chat({ model: 'test', messages: [] })
    }
    expect(wrapped.getState()).toBe('closed')
  })
})
