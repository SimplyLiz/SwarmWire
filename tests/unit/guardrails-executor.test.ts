import { describe, it, expect } from 'vitest'
import { executePlan } from '../../src/executor/executor.js'
import { createAgent } from '../../src/core/agent-factory.js'
import { GuardrailTripped } from '../../src/core/guardrails.js'
import type { Guardrail } from '../../src/core/guardrails.js'
import type { Plan } from '../../src/types/plan.js'
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

function blockingGuardrail(name: string): Guardrail {
  return {
    name,
    mode: 'blocking',
    async check() {
      return { passed: false, severity: 'block', reason: `${name} blocked` }
    },
  }
}

function passingGuardrail(name: string): Guardrail {
  return {
    name,
    mode: 'blocking',
    async check() {
      return { passed: true }
    },
  }
}

function makePlan(agent: ReturnType<typeof createAgent>): Plan {
  const task: Task = { id: 't1', description: 'test', input: 'hello', budget: {} }
  return {
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
}

describe('Guardrails-Executor integration', () => {
  it('fails step when input guardrail blocks', async () => {
    const agent = createAgent({
      name: 'guarded',
      role: 'test',
      model: { provider: 'mock', model: 'mock-model' },
      guardrails: {
        input: [blockingGuardrail('input-blocker')],
      },
      execute: async (input) => `processed: ${input}`,
    })

    const plan = makePlan(agent)
    const result = await executePlan(plan, { providers: [mockProvider()], budget: {} })

    expect(result.partial).toBe(true)
    expect(result.allResults.length).toBe(1)
    expect(result.allResults[0].status).toBe('failed')
    expect(result.allResults[0].error).toContain('input-blocker')
    expect(result.allResults[0].error).toContain('tripped')
  })

  it('fails step when output guardrail blocks', async () => {
    const agent = createAgent({
      name: 'guarded-output',
      role: 'test',
      model: { provider: 'mock', model: 'mock-model' },
      guardrails: {
        output: [blockingGuardrail('output-blocker')],
      },
      execute: async (input) => `processed: ${input}`,
    })

    const plan = makePlan(agent)
    const result = await executePlan(plan, { providers: [mockProvider()], budget: {} })

    expect(result.partial).toBe(true)
    expect(result.allResults.length).toBe(1)
    expect(result.allResults[0].status).toBe('failed')
    expect(result.allResults[0].error).toContain('output-blocker')
    expect(result.allResults[0].error).toContain('tripped')
  })

  it('executes normally when guardrails pass', async () => {
    const agent = createAgent({
      name: 'safe-agent',
      role: 'test',
      model: { provider: 'mock', model: 'mock-model' },
      guardrails: {
        input: [passingGuardrail('input-ok')],
        output: [passingGuardrail('output-ok')],
      },
      execute: async (input) => `processed: ${input}`,
    })

    const plan = makePlan(agent)
    const result = await executePlan(plan, { providers: [mockProvider()], budget: {} })

    expect(result.partial).toBe(false)
    expect(result.output).toBe('processed: hello')
    expect(result.allResults.length).toBe(1)
    expect(result.allResults[0].status).toBe('completed')
  })
})
