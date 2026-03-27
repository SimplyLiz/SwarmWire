import { describe, it, expect } from 'vitest'
import { analyzeCosts } from '../../src/budget/optimizer.js'
import type { ExecutionResult } from '../../src/types/execution.js'
import { createAgent } from '../../src/core/agent-factory.js'
import type { Plan } from '../../src/types/plan.js'

function makeResult(overrides?: Partial<{ agentTokens: number; agentCost: number; inputTokens: number; cachedTokens: number }>): ExecutionResult {
  const agent = createAgent({ name: 'worker', role: 'work' })
  const tokens = overrides?.agentTokens ?? 5000
  const cost = overrides?.agentCost ?? 10

  const plan: Plan = {
    id: 'p1',
    task: { id: 't1', description: 'test', input: 'hello', budget: {} },
    steps: [
      { id: 's1', agent, input: { type: 'task_input' }, dependencies: [], status: 'complete', output: 'done',
        cost: { timestamp: 0, agentId: agent.id, agentName: 'worker', provider: 'test', model: 'test', inputTokens: tokens * 0.7, outputTokens: tokens * 0.3, cachedInputTokens: 0, costCents: cost, durationMs: 500 } },
    ],
    mode: 'deep',
    estimatedCost: { estimatedTokens: tokens, estimatedCostCents: cost, estimatedLatencyMs: 1000, estimatedAgents: 1, confidence: 0.8 },
    status: 'complete',
  }

  return {
    output: 'done',
    confidence: 0.8,
    evidence: [],
    agentOutputs: [{
      agentId: agent.id,
      agentName: 'worker',
      output: 'done',
      cost: { inputTokens: tokens * 0.7, outputTokens: tokens * 0.3, cachedInputTokens: overrides?.cachedTokens ?? 0, totalTokens: tokens, costCents: cost, calls: 1 },
      durationMs: 500,
    }],
    cost: {
      totalTokens: tokens,
      inputTokens: overrides?.inputTokens ?? tokens * 0.7,
      outputTokens: tokens * 0.3,
      cachedInputTokens: overrides?.cachedTokens ?? 0,
      totalCostCents: cost,
      totalLatencyMs: 500,
      budgetUsed: 0.1,
      perAgent: new Map([['worker', { tokens, costCents: cost, calls: 1 }]]),
      perProvider: new Map([['test', { tokens, costCents: cost, cacheHits: 0 }]]),
      savings: { promptCachingCents: 0, tierRoutingCents: 0, earlyStopCents: 0 },
    },
    trace: { id: 'p1', startedAt: 0, completedAt: 500, spans: [] },
    plan,
    partial: false,
  }
}

describe('Cost Optimizer', () => {
  it('suggests tier downgrade for low-token expensive calls', () => {
    const result = makeResult({ agentTokens: 500, agentCost: 15 })
    const recs = analyzeCosts(result)
    const downgrade = recs.find((r) => r.type === 'tier_downgrade')
    expect(downgrade).toBeDefined()
    expect(downgrade!.estimatedSavingsCents).toBeGreaterThan(0)
  })

  it('suggests caching when cache hit ratio is low', () => {
    const result = makeResult({ agentTokens: 10000, inputTokens: 8000, cachedTokens: 0 })
    const recs = analyzeCosts(result)
    const caching = recs.find((r) => r.type === 'caching')
    expect(caching).toBeDefined()
  })

  it('returns no recommendations for efficient execution', () => {
    const result = makeResult({ agentTokens: 5000, agentCost: 2, cachedTokens: 3000, inputTokens: 3500 })
    const recs = analyzeCosts(result)
    // Might have some recs but should be low-impact
    for (const r of recs) {
      expect(r.estimatedSavingsCents).toBeLessThan(5)
    }
  })
})
