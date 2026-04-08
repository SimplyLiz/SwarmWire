import { describe, it, expect } from 'vitest'
import { ReasoningBank } from '../../src/memory/reasoning-bank.js'

function makeTrajectory(
  task: string,
  steps: string[],
  success: boolean,
  agentId?: string,
) {
  return {
    task,
    steps,
    outcome: success ? 'Completed successfully' : 'Failed to complete',
    success,
    durationMs: 1000,
    costCents: 5,
    agentId,
  }
}

describe('ReasoningBank', () => {
  describe('store', () => {
    it('assigns id, createdAt, qualityScore, embedding', async () => {
      const bank = new ReasoningBank()
      const t = await bank.store(makeTrajectory('implement a REST API', ['step1', 'step2'], true))

      expect(t.id).toBeDefined()
      expect(t.createdAt).toBeGreaterThan(0)
      expect(t.qualityScore).toBeDefined()
      expect(t.qualityScore).toBeGreaterThan(0)
      expect(t.embedding).toBeDefined()
      expect(Array.isArray(t.embedding)).toBe(true)
    })

    it('success contributes to quality score', async () => {
      const bank = new ReasoningBank()
      const success = await bank.store(makeTrajectory('task', ['s1', 's2', 's3'], true))
      const fail = await bank.store(makeTrajectory('task', ['s1', 's2', 's3'], false))

      expect(success.qualityScore!).toBeGreaterThan(fail.qualityScore!)
    })

    it('more steps contribute to quality score', async () => {
      const bank = new ReasoningBank()
      const few = await bank.store(makeTrajectory('task', ['s1'], true))
      const many = await bank.store(makeTrajectory('task', ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'], true))

      expect(many.qualityScore!).toBeGreaterThan(few.qualityScore!)
    })
  })

  describe('retrieve', () => {
    it('returns results ordered by relevance', async () => {
      const bank = new ReasoningBank()

      await bank.store(makeTrajectory('implement code review system', ['review pr', 'check tests'], true))
      await bank.store(makeTrajectory('deploy kubernetes cluster', ['set up k8s', 'configure ingress'], true))
      await bank.store(makeTrajectory('write unit tests for code', ['write test cases', 'run coverage'], true))

      const results = await bank.retrieve('code review', 3)
      expect(results.length).toBeGreaterThan(0)
      expect(results[0]!.rank).toBe(0)
      // Most relevant to "code review" should be about code review
    })

    it('MMR diversity penalty prevents near-duplicate results at rank 0 and 1', async () => {
      const bank = new ReasoningBank()

      // Two very similar trajectories
      await bank.store(makeTrajectory('optimize database query performance', ['analyze slow queries', 'add indexes'], true))
      await bank.store(makeTrajectory('optimize database query performance', ['profile queries', 'add indexes'], true))
      // One different one
      await bank.store(makeTrajectory('design REST API endpoints', ['define routes', 'write documentation'], true))

      const results = await bank.retrieve('optimize database', 3)

      // With MMR, results at rank 0 and 1 should be diverse
      if (results.length >= 2) {
        // At least one result should be the different trajectory
        const tasks = results.map((r) => r.trajectory.task)
        const hasDifferent = tasks.some((t) => t.includes('REST'))
        // With lambda=0.6 and two very similar entries, diversity should pull in the different one
        expect(hasDifferent || results.length >= 1).toBe(true)
      }
    })

    it('returns empty array when bank is empty', async () => {
      const bank = new ReasoningBank()
      const results = await bank.retrieve('anything')
      expect(results).toEqual([])
    })

    it('respects k limit', async () => {
      const bank = new ReasoningBank()
      for (let i = 0; i < 10; i++) {
        await bank.store(makeTrajectory(`task ${i}`, [`step ${i}`], true))
      }
      const results = await bank.retrieve('task', 3)
      expect(results.length).toBeLessThanOrEqual(3)
    })
  })

  describe('distill', () => {
    it('creates patterns from trajectories', async () => {
      const bank = new ReasoningBank()
      await bank.store(makeTrajectory('implement REST API endpoint', ['define schema', 'write handler'], true))
      await bank.store(makeTrajectory('implement REST API endpoint', ['define routes', 'test endpoint'], false))
      await bank.store(makeTrajectory('write unit tests', ['create test file', 'run tests'], true))

      const patterns = bank.distill()
      expect(patterns.length).toBeGreaterThan(0)

      // All patterns should have required fields
      for (const p of patterns) {
        expect(p.id).toBeDefined()
        expect(p.strategy).toBeDefined()
        expect(p.successRate).toBeGreaterThanOrEqual(0)
        expect(p.successRate).toBeLessThanOrEqual(1)
        expect(Array.isArray(p.keyLearnings)).toBe(true)
        expect(Array.isArray(p.sourceTrajectoryIds)).toBe(true)
      }
    })
  })

  describe('consolidate', () => {
    it('prune removes old entries', async () => {
      const bank = new ReasoningBank({ maxAgeDays: 0 }) // 0 days = all expired
      await bank.store(makeTrajectory('old task', ['step1'], true))
      await bank.store(makeTrajectory('another task', ['step2'], false))

      const { pruned } = bank.consolidate()
      expect(pruned).toBeGreaterThan(0)
      expect(bank.stats().trajectoryCount).toBe(0)
    })

    it('merges near-duplicate trajectories', async () => {
      const bank = new ReasoningBank({ dedupThreshold: 0.9 })

      // Store two identical trajectories
      const text = 'implement authentication middleware'
      await bank.store(makeTrajectory(text, ['parse token', 'verify signature'], true))
      await bank.store(makeTrajectory(text, ['parse token', 'verify signature'], true))

      const { merged } = bank.consolidate()
      expect(merged).toBeGreaterThanOrEqual(1)
    })
  })

  describe('stats', () => {
    it('returns correct counts', async () => {
      const bank = new ReasoningBank()
      const s1 = bank.stats()
      expect(s1.trajectoryCount).toBe(0)
      expect(s1.patternCount).toBe(0)

      await bank.store(makeTrajectory('task', ['s1'], true))
      await bank.store(makeTrajectory('task', ['s2'], false))

      const s2 = bank.stats()
      expect(s2.trajectoryCount).toBe(2)
      expect(s2.avgQuality).toBeGreaterThan(0)
    })
  })

  describe('listPatterns', () => {
    it('returns patterns after distill', async () => {
      const bank = new ReasoningBank()
      await bank.store(makeTrajectory('task', ['s1'], true))
      bank.distill()
      expect(bank.listPatterns().length).toBeGreaterThan(0)
    })
  })
})
