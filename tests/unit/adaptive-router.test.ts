import { describe, it, expect } from 'vitest'
import { AdaptiveRouter } from '../../src/planner/adaptive-router.js'
import { createAgent } from '../../src/core/agent-factory.js'
import type { TaskScore } from '../../src/types/task.js'

function makeScore(domain = ['code'], difficulty = 'medium'): TaskScore {
  return {
    difficulty: difficulty as 'medium',
    risk: 'low',
    domain,
    freshnessNeed: 'relaxed',
    recommendedMode: 'deep',
    estimatedAgents: 1,
    estimatedTokens: 5000,
    modelTier: 'standard',
    factors: { inputComplexity: 0.3, domainSpecificity: 0.3, reasoningDepth: 0.3, outputStructure: 0.2, contextRequired: 0.2 },
  }
}

describe('AdaptiveRouter', () => {
  it('returns default scores for agents with no history', () => {
    const router = new AdaptiveRouter()
    const agents = [
      createAgent({ name: 'a1', role: 'r', modelTier: 'cheap' }),
      createAgent({ name: 'a2', role: 'r', modelTier: 'premium' }),
    ]

    const scores = router.scoreAgents(agents, makeScore())
    expect(scores.length).toBe(2)
    // Premium should score higher by default
    expect(scores[0]!.agentName).toBe('a2')
  })

  it('ranks agents based on execution history', () => {
    const router = new AdaptiveRouter()

    // Record good history for a1, bad for a2
    for (let i = 0; i < 10; i++) {
      router.record({
        taskDomain: ['code'],
        taskDifficulty: 'medium',
        agentName: 'a1',
        model: 'test',
        provider: 'test',
        success: true,
        costCents: 5,
        durationMs: 500,
        qualityScore: 0.9,
        timestamp: Date.now(),
      })
      router.record({
        taskDomain: ['code'],
        taskDifficulty: 'medium',
        agentName: 'a2',
        model: 'test',
        provider: 'test',
        success: i < 3, // 30% success rate
        costCents: 20,
        durationMs: 2000,
        qualityScore: 0.4,
        timestamp: Date.now(),
      })
    }

    const agents = [
      createAgent({ name: 'a1', role: 'r' }),
      createAgent({ name: 'a2', role: 'r' }),
    ]

    const scores = router.scoreAgents(agents, makeScore())
    expect(scores[0]!.agentName).toBe('a1')
    expect(scores[0]!.score).toBeGreaterThan(scores[1]!.score)
  })

  it('picks best agent', () => {
    const router = new AdaptiveRouter()

    router.record({
      taskDomain: ['data'],
      taskDifficulty: 'easy',
      agentName: 'data-expert',
      model: 'test',
      provider: 'test',
      success: true,
      costCents: 2,
      durationMs: 200,
      qualityScore: 0.95,
      timestamp: Date.now(),
    })

    const agents = [
      createAgent({ name: 'data-expert', role: 'r' }),
      createAgent({ name: 'generalist', role: 'r' }),
    ]

    const picked = router.pickAgent(agents, makeScore(['data'], 'easy'))
    expect(picked?.name).toBe('data-expert')
  })

  it('tracks stats', () => {
    const router = new AdaptiveRouter()
    router.record({
      taskDomain: ['code', 'security'],
      taskDifficulty: 'hard',
      agentName: 'a1',
      model: 'test',
      provider: 'test',
      success: true,
      costCents: 10,
      durationMs: 1000,
      qualityScore: 0.8,
      timestamp: Date.now(),
    })

    const stats = router.stats()
    expect(stats.totalRecords).toBe(1)
    expect(stats.domains).toContain('code')
    expect(stats.domains).toContain('security')
  })
})
