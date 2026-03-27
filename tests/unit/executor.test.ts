import { describe, it, expect } from 'vitest'
import { executePlan } from '../../src/executor/executor.js'
import { createAgent } from '../../src/core/agent-factory.js'
import type { Plan, Step } from '../../src/types/plan.js'
import type { Task } from '../../src/types/task.js'
import type { Provider } from '../../src/types/provider.js'

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
    estimateCost: (_m, inp, out) => (inp + out) / 1000 * 0.4,
  }
}

function agentWithExecute(name: string, fn: (input: unknown) => unknown) {
  return createAgent({
    name,
    role: name,
    model: { provider: 'mock', model: 'mock-model' },
    execute: async (input) => fn(input),
  })
}

describe('Executor', () => {
  it('executes a single-step plan', async () => {
    const agent = agentWithExecute('echo', (input) => `processed: ${input}`)
    const task: Task = { id: 't1', description: 'test', input: 'hello', budget: {} }
    const plan: Plan = {
      id: 'p1',
      task,
      steps: [{
        id: 's1',
        agent,
        input: { type: 'task_input' },
        dependencies: [],
        status: 'pending',
      }],
      mode: 'deep',
      estimatedCost: { estimatedTokens: 100, estimatedCostCents: 1, estimatedLatencyMs: 100, estimatedAgents: 1, confidence: 0.8 },
      status: 'draft',
    }

    const result = await executePlan(plan, { providers: [mockProvider()], budget: {} })
    expect(result.output).toBe('processed: hello')
    expect(result.partial).toBe(false)
    expect(result.agentOutputs.length).toBe(1)
  })

  it('executes parallel steps in a DAG', async () => {
    const order: string[] = []
    const a1 = agentWithExecute('w1', () => { order.push('w1'); return 'result1' })
    const a2 = agentWithExecute('w2', () => { order.push('w2'); return 'result2' })
    const merger = agentWithExecute('merge', (input) => { order.push('merge'); return `merged: ${JSON.stringify(input)}` })

    const task: Task = { id: 't1', description: 'test', input: 'go', budget: {} }
    const plan: Plan = {
      id: 'p1',
      task,
      steps: [
        { id: 's1', agent: a1, input: { type: 'task_input' }, dependencies: [], status: 'pending' },
        { id: 's2', agent: a2, input: { type: 'task_input' }, dependencies: [], status: 'pending' },
        { id: 's3', agent: merger, input: { type: 'merged', sources: [{ type: 'step_output', stepId: 's1' }, { type: 'step_output', stepId: 's2' }] }, dependencies: ['s1', 's2'], status: 'pending' },
      ],
      mode: 'swarm',
      estimatedCost: { estimatedTokens: 300, estimatedCostCents: 3, estimatedLatencyMs: 300, estimatedAgents: 3, confidence: 0.7 },
      status: 'draft',
    }

    const result = await executePlan(plan, { providers: [mockProvider()], budget: {} })
    expect(order).toContain('merge')
    expect(order.indexOf('merge')).toBe(2) // merge runs last
    expect(result.agentOutputs.length).toBe(3)
  })

  it('enforces budget and skips steps when exhausted', async () => {
    let callCount = 0
    const agent = agentWithExecute('counter', () => { callCount++; return 'ok' })

    const task: Task = { id: 't1', description: 'test', input: 'go', budget: {} }
    const plan: Plan = {
      id: 'p1',
      task,
      steps: [
        { id: 's1', agent, input: { type: 'task_input' }, dependencies: [], status: 'pending' },
        { id: 's2', agent, input: { type: 'step_output', stepId: 's1' }, dependencies: ['s1'], status: 'pending' },
        { id: 's3', agent, input: { type: 'step_output', stepId: 's2' }, dependencies: ['s2'], status: 'pending' },
      ],
      mode: 'deep',
      estimatedCost: { estimatedTokens: 100, estimatedCostCents: 1, estimatedLatencyMs: 100, estimatedAgents: 1, confidence: 0.8 },
      status: 'draft',
    }

    // Budget of 0 tokens — everything should be skipped or budget-blocked
    const result = await executePlan(plan, {
      providers: [mockProvider()],
      budget: { maxTokens: 0 },
    })

    // First step might run before budget check kicks in, but subsequent ones should be skipped
    expect(result.partial).toBe(true)
  })

  it('handles step failures gracefully', async () => {
    const failing = agentWithExecute('fail', () => { throw new Error('boom') })
    const ok = agentWithExecute('ok', () => 'fine')

    const task: Task = { id: 't1', description: 'test', input: 'go', budget: {} }
    const plan: Plan = {
      id: 'p1',
      task,
      steps: [
        { id: 's1', agent: failing, input: { type: 'task_input' }, dependencies: [], status: 'pending' },
        { id: 's2', agent: ok, input: { type: 'step_output', stepId: 's1' }, dependencies: ['s1'], status: 'pending' },
      ],
      mode: 'deep',
      estimatedCost: { estimatedTokens: 100, estimatedCostCents: 1, estimatedLatencyMs: 100, estimatedAgents: 1, confidence: 0.8 },
      status: 'draft',
    }

    const result = await executePlan(plan, { providers: [mockProvider()], budget: {} })
    expect(result.partial).toBe(true)
    expect(plan.steps[0]!.status).toBe('failed')
    expect(plan.steps[0]!.error).toBe('boom')
  })

  it('optional failed steps dont block dependents', async () => {
    const failing = agentWithExecute('fail', () => { throw new Error('boom') })
    const ok = agentWithExecute('ok', () => 'fine')

    const task: Task = { id: 't1', description: 'test', input: 'go', budget: {} }
    const plan: Plan = {
      id: 'p1',
      task,
      steps: [
        { id: 's1', agent: failing, input: { type: 'task_input' }, dependencies: [], status: 'pending', optional: true },
        { id: 's2', agent: ok, input: { type: 'task_input' }, dependencies: ['s1'], status: 'pending' },
      ],
      mode: 'deep',
      estimatedCost: { estimatedTokens: 100, estimatedCostCents: 1, estimatedLatencyMs: 100, estimatedAgents: 1, confidence: 0.8 },
      status: 'draft',
    }

    const result = await executePlan(plan, { providers: [mockProvider()], budget: {} })
    // s2 should still run because s1 is optional
    expect(plan.steps[1]!.status).toBe('complete')
  })
})
