import { describe, it, expect } from 'vitest'
import { TimeTravelStore } from '../../src/executor/time-travel.js'
import type { Plan } from '../../src/types/plan.js'

function makePlan(id: string): Plan {
  return {
    id,
    task: { id: `task_${id}`, description: 'test', input: 'test', budget: {} },
    steps: [],
    mode: 'deep',
    estimatedCost: { estimatedTokens: 0, estimatedCostCents: 0, estimatedLatencyMs: 0, estimatedAgents: 0, confidence: 0.5 },
    status: 'complete',
  }
}

describe('TimeTravelStore', () => {
  it('records and retrieves timeline entries', () => {
    const store = new TimeTravelStore()
    const plan = makePlan('plan1')
    store.record('plan1', 'step1', 'agent1', plan, new Map([['step1', 'result']]), [])
    const timeline = store.getTimeline('plan1')
    expect(timeline).toHaveLength(1)
    expect(timeline[0]!.stepId).toBe('step1')
    expect(timeline[0]!.stepName).toBe('agent1')
  })

  it('returns empty timeline for unknown plan', () => {
    const store = new TimeTravelStore()
    expect(store.getTimeline('unknown')).toEqual([])
  })

  it('rewindTo returns checkpoint for known stepId', () => {
    const store = new TimeTravelStore()
    const plan = makePlan('plan1')
    store.record('plan1', 'step1', 'agent1', plan, new Map(), [])
    store.record('plan1', 'step2', 'agent2', plan, new Map(), [])
    const ckpt = store.rewindTo('plan1', 'step1')
    expect(ckpt).not.toBeNull()
    expect(ckpt!.planId).toBe('plan1')
  })

  it('rewindTo returns null for unknown stepId', () => {
    const store = new TimeTravelStore()
    const plan = makePlan('plan1')
    store.record('plan1', 'step1', 'agent1', plan, new Map(), [])
    expect(store.rewindTo('plan1', 'ghost')).toBeNull()
  })

  it('caps history at maxHistory', () => {
    const store = new TimeTravelStore(3)
    const plan = makePlan('plan1')
    for (let i = 0; i < 5; i++) {
      store.record('plan1', `step${i}`, 'agent', plan, new Map(), [])
    }
    expect(store.getTimeline('plan1')).toHaveLength(3)
  })

  it('export/import round-trips', () => {
    const store = new TimeTravelStore()
    const plan = makePlan('plan1')
    store.record('plan1', 'step1', 'agent1', plan, new Map(), [])
    const exported = store.export()
    const store2 = new TimeTravelStore()
    store2.import(exported)
    expect(store2.getTimeline('plan1')).toHaveLength(1)
  })

  it('clear removes timeline for a plan', () => {
    const store = new TimeTravelStore()
    const plan = makePlan('plan1')
    store.record('plan1', 'step1', 'agent1', plan, new Map(), [])
    store.clear('plan1')
    expect(store.getTimeline('plan1')).toHaveLength(0)
  })
})
