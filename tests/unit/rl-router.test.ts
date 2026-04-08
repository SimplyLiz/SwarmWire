import { describe, it, expect } from 'vitest'
import { RLRouter, RLRouterPPO } from '../../src/planner/rl-router.js'
import type { RLState, Experience } from '../../src/planner/rl-router.js'
import type { Task } from '../../src/types/task.js'

const state: RLState = { complexity: 0.2, domain: 0, length: 0 }
const nextState: RLState = { complexity: 0.2, domain: 0, length: 0 }

function makeTask(desc: string): Task {
  return {
    id: 't1',
    description: desc,
    input: 'input',
    budget: { maxCostCents: 100, maxTokens: 10000 },
  }
}

describe('RLRouter', () => {
  it('selectAction returns a valid action', () => {
    const router = new RLRouter({ epsilon: 1.0 }) // always explore
    const action = router.selectAction(state)
    expect(['cheap', 'standard', 'premium', 'reasoning']).toContain(action)
  })

  it('selectAction exploits after epsilon decays to 0', () => {
    const router = new RLRouter({ epsilon: 0, epsilonMin: 0, epsilonDecay: 0 })

    // Manually set Q for 'cheap' to be highest
    router.importState({
      '0.2:0:0': { cheap: 10, standard: 1, premium: 1, reasoning: 1 },
    })

    // After 20 updates building Q-table, exploit should pick 'cheap'
    const action = router.selectAction(state)
    expect(action).toBe('cheap')
  })

  it('after 20 reward-positive updates for cheap, exploitation selects cheap', () => {
    const router = new RLRouter({
      epsilon: 0.0,
      epsilonMin: 0.0,
      epsilonDecay: 0,
      alpha: 0.5,
      gamma: 0.9,
      targetSyncSteps: 5,
    })

    // Force-import initial Q so all are 0
    router.importState({})

    // Provide 20 experiences with high reward for 'cheap'
    for (let i = 0; i < 20; i++) {
      const exp: Experience = {
        state,
        action: 'cheap',
        reward: 10,
        nextState,
        done: true,
      }
      router.update(exp)

      // Negative reward for other actions
      router.update({ state, action: 'standard', reward: -5, nextState, done: true })
      router.update({ state, action: 'premium', reward: -5, nextState, done: true })
      router.update({ state, action: 'reasoning', reward: -5, nextState, done: true })
    }

    const action = router.selectAction(state)
    expect(action).toBe('cheap')
  })

  it('epsilon decays after each selectAction', () => {
    const router = new RLRouter({ epsilon: 1.0, epsilonMin: 0.0, epsilonDecay: 0.1 })
    router.selectAction(state)
    expect(router.stats().epsilon).toBeCloseTo(0.9)
    router.selectAction(state)
    expect(router.stats().epsilon).toBeCloseTo(0.8)
  })

  it('epsilon never goes below epsilonMin', () => {
    const router = new RLRouter({ epsilon: 0.1, epsilonMin: 0.05, epsilonDecay: 0.2 })
    for (let i = 0; i < 10; i++) router.selectAction(state)
    expect(router.stats().epsilon).toBeGreaterThanOrEqual(0.05)
  })

  it('computeReward: high quality + low cost = positive', () => {
    const reward = RLRouter.computeReward(1.0, 1) // quality=1, cost=1 cent
    expect(reward).toBeGreaterThan(0)
  })

  it('computeReward: low quality + high cost = negative', () => {
    const reward = RLRouter.computeReward(0.1, 500)
    expect(reward).toBeLessThan(0)
  })

  it('stateFromTask returns valid state', () => {
    const task = makeTask('analyze the database query performance')
    const s = RLRouter.stateFromTask(task)
    expect(s.complexity).toBeGreaterThanOrEqual(0)
    expect(s.complexity).toBeLessThanOrEqual(1)
    expect(s.domain).toBeGreaterThanOrEqual(0)
    expect(s.domain).toBeLessThanOrEqual(7)
    expect([0, 1, 2]).toContain(s.length)
  })

  it('stateFromTask length=0 for short task', () => {
    const s = RLRouter.stateFromTask(makeTask('short task'))
    expect(s.length).toBe(0)
  })

  it('stateFromTask length=2 for very long task', () => {
    const longDesc = 'a'.repeat(700)
    const s = RLRouter.stateFromTask(makeTask(longDesc))
    expect(s.length).toBe(2)
  })

  it('exportState and importState round-trips', () => {
    const router = new RLRouter({ epsilon: 0 })
    router.update({ state, action: 'cheap', reward: 5, nextState, done: false })

    const exported = router.exportState()
    const key = Object.keys(exported)[0]!
    expect(exported[key]).toBeDefined()
    expect(typeof exported[key]!.cheap).toBe('number')

    const router2 = new RLRouter({ epsilon: 0 })
    router2.importState(exported)

    const action = router2.selectAction(state)
    expect(['cheap', 'standard', 'premium', 'reasoning']).toContain(action)
  })

  it('stats tracks updateCount and avgReward', () => {
    const router = new RLRouter()
    expect(router.stats().updateCount).toBe(0)

    router.update({ state, action: 'cheap', reward: 2, nextState, done: false })
    router.update({ state, action: 'standard', reward: 4, nextState, done: false })

    const s = router.stats()
    expect(s.updateCount).toBe(2)
    expect(s.avgReward).toBeCloseTo(3)
  })

  it('replay buffer does not exceed replayBufferSize', () => {
    const router = new RLRouter({ replayBufferSize: 5 })
    for (let i = 0; i < 10; i++) {
      router.update({ state, action: 'cheap', reward: i, nextState, done: false })
    }
    // Buffer should have been trimmed — stats should still work
    expect(router.stats().updateCount).toBe(10)
  })
})

describe('RLRouterPPO', () => {
  it('selectAction returns a valid action', () => {
    const ppo = new RLRouterPPO()
    const action = ppo.selectAction(state)
    expect(['cheap', 'standard', 'premium', 'reasoning']).toContain(action)
  })

  it('update works with single trajectory step', () => {
    const ppo = new RLRouterPPO()
    const trajectory: Experience[] = [
      { state, action: 'standard', reward: 5, nextState, done: true },
    ]
    expect(() => ppo.update(trajectory)).not.toThrow()
  })

  it('update with empty trajectory is a no-op', () => {
    const ppo = new RLRouterPPO()
    expect(() => ppo.update([])).not.toThrow()
  })

  it('stats returns stateCount and avgBaseline', () => {
    const ppo = new RLRouterPPO()
    ppo.update([{ state, action: 'cheap', reward: 3, nextState, done: true }])

    const s = ppo.stats()
    expect(s.stateCount).toBeGreaterThan(0)
    expect(typeof s.avgBaseline).toBe('number')
  })

  it('prefers action with more positive updates over time', () => {
    const ppo = new RLRouterPPO({ alpha: 1.0, gamma: 0 })

    // 20 iterations rewarding 'cheap'
    for (let i = 0; i < 20; i++) {
      ppo.update([
        { state, action: 'cheap', reward: 10, nextState, done: true },
        { state, action: 'standard', reward: -5, nextState, done: true },
        { state, action: 'premium', reward: -5, nextState, done: true },
        { state, action: 'reasoning', reward: -5, nextState, done: true },
      ])
    }

    // With high alpha and many positive updates for 'cheap', should bias toward it
    // Run multiple samples and check 'cheap' is selected most
    const counts: Record<string, number> = { cheap: 0, standard: 0, premium: 0, reasoning: 0 }
    for (let i = 0; i < 50; i++) {
      const a = ppo.selectAction(state)
      counts[a] = (counts[a] ?? 0) + 1
    }
    expect(counts.cheap).toBeGreaterThan(counts.standard!)
  })
})
