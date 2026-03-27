import { describe, it, expect } from 'vitest'
import { explainExecution, summarizeExecution, visualizePlan } from '../../src/trace/explainer.js'
import { createAgent } from '../../src/core/agent-factory.js'
import type { ExecutionResult } from '../../src/types/execution.js'
import type { Plan } from '../../src/types/plan.js'

function makeResult(): ExecutionResult {
  const agent = createAgent({ name: 'researcher', role: 'research' })
  const plan: Plan = {
    id: 'plan_1',
    task: { id: 't1', description: 'test', input: 'hello', budget: {} },
    steps: [
      { id: 's1', agent, input: { type: 'task_input' }, dependencies: [], status: 'complete', output: 'done',
        cost: { timestamp: 0, agentId: agent.id, agentName: 'researcher', provider: 'anthropic', model: 'sonnet', inputTokens: 500, outputTokens: 200, cachedInputTokens: 0, costCents: 5.5, durationMs: 800 } },
    ],
    mode: 'deep',
    estimatedCost: { estimatedTokens: 700, estimatedCostCents: 6, estimatedLatencyMs: 1000, estimatedAgents: 1, confidence: 0.8 },
    status: 'complete',
  }

  return {
    output: 'done',
    confidence: 0.85,
    evidence: [],
    agentOutputs: [{
      agentId: agent.id,
      agentName: 'researcher',
      output: 'done',
      cost: { inputTokens: 500, outputTokens: 200, cachedInputTokens: 0, totalTokens: 700, costCents: 5.5, calls: 1 },
      durationMs: 800,
    }],
    cost: {
      totalTokens: 700,
      inputTokens: 500,
      outputTokens: 200,
      cachedInputTokens: 0,
      totalCostCents: 5.5,
      totalLatencyMs: 850,
      budgetUsed: 0.055,
      perAgent: new Map([['researcher', { tokens: 700, costCents: 5.5, calls: 1 }]]),
      perProvider: new Map([['anthropic', { tokens: 700, costCents: 5.5, cacheHits: 0 }]]),
      savings: { promptCachingCents: 0, tierRoutingCents: 0, earlyStopCents: 0 },
    },
    trace: { id: 'plan_1', startedAt: 0, completedAt: 850, spans: [] },
    plan,
    partial: false,
  }
}

describe('Explainer', () => {
  it('generates human-readable explanation', () => {
    const explanation = explainExecution(makeResult())
    expect(explanation).toContain('Execution Report')
    expect(explanation).toContain('COMPLETE')
    expect(explanation).toContain('researcher')
    expect(explanation).toContain('5.50')
    expect(explanation).toContain('anthropic')
  })

  it('generates compact summary', () => {
    const summary = summarizeExecution(makeResult())
    expect(summary).toContain('[OK]')
    expect(summary).toContain('1/1 steps')
    expect(summary).toContain('5.50')
  })

  it('marks partial results', () => {
    const result = makeResult()
    result.partial = true
    const summary = summarizeExecution(result)
    expect(summary).toContain('[PARTIAL]')
  })
})

describe('Plan Visualizer', () => {
  it('renders DAG ASCII', () => {
    const agent1 = createAgent({ name: 'worker1', role: 'w' })
    const agent2 = createAgent({ name: 'worker2', role: 'w' })
    const merger = createAgent({ name: 'merger', role: 'm' })

    const plan: Plan = {
      id: 'p1',
      task: { id: 't', description: 't', input: '', budget: {} },
      steps: [
        { id: 's1', agent: agent1, input: { type: 'task_input' }, dependencies: [], status: 'pending' },
        { id: 's2', agent: agent2, input: { type: 'task_input' }, dependencies: [], status: 'pending' },
        { id: 's3', agent: merger, input: { type: 'merged', sources: [] }, dependencies: ['s1', 's2'], status: 'pending' },
      ],
      mode: 'swarm',
      estimatedCost: { estimatedTokens: 0, estimatedCostCents: 0, estimatedLatencyMs: 0, estimatedAgents: 3, confidence: 0.5 },
      status: 'draft',
    }

    const viz = visualizePlan(plan)
    expect(viz).toContain('worker1')
    expect(viz).toContain('worker2')
    expect(viz).toContain('merger')
    expect(viz).toContain('↓')
  })
})
