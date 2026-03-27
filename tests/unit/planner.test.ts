import { describe, it, expect } from 'vitest'
import { buildPlan } from '../../src/planner/planner.js'
import { createAgent } from '../../src/core/agent-factory.js'
import type { Task } from '../../src/types/task.js'

function makeTask(description: string): Task {
  return { id: 'test', description, input: description, budget: {} }
}

function makeAgent(name: string) {
  return createAgent({
    name,
    role: `${name} role`,
    model: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  })
}

describe('Planner', () => {
  it('builds single-step plan for one agent', () => {
    const plan = buildPlan(makeTask('simple task'), { agents: [makeAgent('a1')] })
    expect(plan.steps.length).toBe(1)
    expect(plan.steps[0]!.dependencies.length).toBe(0)
    expect(plan.status).toBe('draft')
  })

  it('builds orchestrator-worker plan with parallel workers + merge', () => {
    const agents = [makeAgent('worker1'), makeAgent('worker2'), makeAgent('synthesizer')]
    const plan = buildPlan(makeTask('analyze security trade-offs of our existing architecture and compare approaches'), {
      agents,
    })

    // Last step should depend on all workers
    const lastStep = plan.steps[plan.steps.length - 1]!
    expect(lastStep.dependencies.length).toBeGreaterThan(0)
    expect(plan.steps.length).toBe(3) // 2 workers + 1 merge
  })

  it('builds pipeline plan with sequential dependencies', () => {
    const agents = [makeAgent('step1'), makeAgent('step2'), makeAgent('step3')]
    const plan = buildPlan(makeTask('process data'), {
      agents,
      pattern: { pattern: 'pipeline' },
    })

    expect(plan.steps.length).toBe(3)
    expect(plan.steps[0]!.dependencies).toEqual([])
    expect(plan.steps[1]!.dependencies).toEqual([plan.steps[0]!.id])
    expect(plan.steps[2]!.dependencies).toEqual([plan.steps[1]!.id])
  })

  it('includes budget estimate', () => {
    const plan = buildPlan(makeTask('test'), { agents: [makeAgent('a1')] })
    expect(plan.estimatedCost.estimatedTokens).toBeGreaterThan(0)
    expect(plan.estimatedCost.confidence).toBeGreaterThan(0)
  })
})
