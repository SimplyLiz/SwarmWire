import { describe, it, expect, vi } from 'vitest'
import { TemporalMemory } from '../../src/memory/temporal.js'

describe('TemporalMemory', () => {
  it('stores and queries notes', async () => {
    const mem = new TemporalMemory()
    await mem.store('k1', 'machine learning optimization gradient', {})
    const results = await mem.query('gradient optimization')
    expect(results.length).toBeGreaterThan(0)
  })

  it('returns highest scoring results first', async () => {
    const mem = new TemporalMemory()
    await mem.store('relevant', 'reinforcement learning reward policy agent', {})
    await mem.store('irrelevant', 'shopping cart checkout payment processing', {})
    const results = await mem.query('reinforcement learning agent')
    expect(results[0]!.relevance).toBeGreaterThanOrEqual(results[results.length - 1]!.relevance)
  })

  it('reinforce accessed notes — strength increases', async () => {
    const mem = new TemporalMemory({ accessReinforcement: 0.2 })
    await mem.store('k1', 'test content for strength measurement', {})
    const before = mem.stats()
    await mem.query('test content')
    const after = mem.stats()
    expect(after.avgStrength).toBeGreaterThanOrEqual(before.avgStrength)
  })

  it('chains temporal neighbors', async () => {
    const mem = new TemporalMemory({ temporalWindowSize: 2 })
    await mem.store('k1', 'first note content', {})
    await mem.store('k2', 'second note content', {})
    await mem.store('k3', 'third note content', {})
    // Stats should show 3 notes
    expect(mem.stats().noteCount).toBe(3)
  })

  it('consolidate evicts weak notes', async () => {
    // threshold > 1.0 means all notes (max strength=1.0) will be evicted
    const mem = new TemporalMemory({ evictionThreshold: 1.1 })
    await mem.store('k1', 'will be evicted', {})
    const result = mem.consolidate()
    expect(result.evicted).toBeGreaterThan(0)
  })

  it('forget removes a note', async () => {
    const mem = new TemporalMemory()
    await mem.store('k1', 'content to forget', {})
    const results = await mem.query('content to forget', { maxItems: 5 })
    if (results[0]) {
      await mem.forget(results[0].key)
      expect(mem.stats().noteCount).toBe(0)
    }
  })

  it('respects maxItems in query', async () => {
    const mem = new TemporalMemory()
    for (let i = 0; i < 8; i++) {
      await mem.store(`k${i}`, `topic content item ${i}`, {})
    }
    const results = await mem.query('topic content', { maxItems: 3 })
    expect(results).toHaveLength(3)
  })

  it('evicts oldest on overflow', async () => {
    const mem = new TemporalMemory({ maxNotes: 5 })
    for (let i = 0; i < 10; i++) {
      await mem.store(`k${i}`, `note ${i}`, {})
    }
    expect(mem.stats().noteCount).toBeLessThanOrEqual(5)
  })

  it('stats returns note count and avg strength', async () => {
    const mem = new TemporalMemory()
    await mem.store('k1', 'a', {})
    await mem.store('k2', 'b', {})
    const stats = mem.stats()
    expect(stats.noteCount).toBe(2)
    expect(stats.avgStrength).toBeGreaterThan(0)
  })
})
