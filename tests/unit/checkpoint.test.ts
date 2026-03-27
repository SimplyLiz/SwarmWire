import { describe, it, expect } from 'vitest'
import { createCheckpoint, restoreFromCheckpoint, serializeCheckpoint, deserializeCheckpoint } from '../../src/executor/checkpoint.js'
import type { Plan } from '../../src/types/plan.js'
import { createAgent } from '../../src/core/agent-factory.js'

function makePlan(): Plan {
  const agent = createAgent({ name: 'test', role: 'test' })
  return {
    id: 'plan1',
    task: { id: 't1', description: 'test', input: 'hello', budget: {} },
    steps: [
      { id: 's1', agent, input: { type: 'task_input' }, dependencies: [], status: 'complete', output: 'result1' },
      { id: 's2', agent, input: { type: 'step_output', stepId: 's1' }, dependencies: ['s1'], status: 'running' },
      { id: 's3', agent, input: { type: 'step_output', stepId: 's2' }, dependencies: ['s2'], status: 'pending' },
    ],
    mode: 'deep',
    estimatedCost: { estimatedTokens: 100, estimatedCostCents: 1, estimatedLatencyMs: 100, estimatedAgents: 1, confidence: 0.8 },
    status: 'running',
  }
}

describe('Checkpoint', () => {
  it('captures plan state', () => {
    const plan = makePlan()
    const outputs = new Map([['s1', 'result1']])
    const ckpt = createCheckpoint(plan, outputs, [])

    expect(ckpt.planId).toBe('plan1')
    expect(ckpt.stepStates.length).toBe(3)
    expect(ckpt.stepStates[0]!.status).toBe('complete')
    expect(ckpt.stepStates[0]!.output).toBe('result1')
    expect(ckpt.stepStates[1]!.status).toBe('running')
  })

  it('restores completed steps and resets others', () => {
    const plan = makePlan()
    const outputs = new Map([['s1', 'result1']])
    const ckpt = createCheckpoint(plan, outputs, [])

    // Simulate modifying plan state
    plan.steps[0]!.status = 'pending'
    plan.steps[0]!.output = undefined

    const restored = restoreFromCheckpoint(plan, ckpt)
    expect(restored.plan.steps[0]!.status).toBe('complete')
    expect(restored.plan.steps[0]!.output).toBe('result1')
    expect(restored.plan.steps[1]!.status).toBe('pending') // running → pending for retry
    expect(restored.plan.steps[2]!.status).toBe('pending')
  })

  it('serializes and deserializes', () => {
    const plan = makePlan()
    const outputs = new Map<string, unknown>([['s1', 'result1']])
    const ckpt = createCheckpoint(plan, outputs, [])

    const json = serializeCheckpoint(ckpt)
    expect(typeof json).toBe('string')

    const restored = deserializeCheckpoint(json)
    expect(restored.planId).toBe('plan1')
    expect(restored.stepOutputs.get('s1')).toBe('result1')
  })
})
