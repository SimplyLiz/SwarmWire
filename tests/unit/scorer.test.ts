import { describe, it, expect } from 'vitest'
import { scoreTask } from '../../src/planner/scorer.js'
import type { Task } from '../../src/types/task.js'

function makeTask(description: string): Task {
  return {
    id: 'test-task',
    description,
    input: description,
    budget: {},
  }
}

describe('TaskScorer', () => {
  it('scores a simple task as easy', () => {
    const score = scoreTask(makeTask('list all files in the directory'))
    expect(score.difficulty).toBe('easy')
    expect(score.recommendedMode).toBe('deep')
    expect(score.modelTier).toBe('cheap')
    expect(score.estimatedAgents).toBe(1)
  })

  it('scores a complex task as hard or complex', () => {
    const score = scoreTask(makeTask(
      'analyze and compare the security trade-offs of our existing authentication architecture against the proposed OAuth2 implementation, evaluate performance implications for the codebase'
    ))
    expect(['hard', 'complex']).toContain(score.difficulty)
    expect(score.recommendedMode).toBe('swarm')
    expect(['standard', 'premium']).toContain(score.modelTier)
  })

  it('detects domains', () => {
    const score = scoreTask(makeTask('refactor the database migration and fix the sql query'))
    expect(score.domain).toContain('data')
    expect(score.domain).toContain('code')
  })

  it('returns factors between 0 and 1', () => {
    const score = scoreTask(makeTask('research and design a distributed system architecture'))
    const { factors } = score
    for (const key of Object.keys(factors) as Array<keyof typeof factors>) {
      expect(factors[key]).toBeGreaterThanOrEqual(0)
      expect(factors[key]).toBeLessThanOrEqual(1)
    }
  })

  it('respects freshness hint from task', () => {
    const task = makeTask('find current api rate limits')
    task.freshness = 'strict'
    const score = scoreTask(task)
    expect(score.freshnessNeed).toBe('strict')
  })
})
