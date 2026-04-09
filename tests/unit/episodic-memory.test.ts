import { describe, it, expect } from 'vitest'
import { EpisodicMemory } from '../../src/memory/episodic.js'

describe('EpisodicMemory', () => {
  it('records and recalls entries', async () => {
    const mem = new EpisodicMemory()
    await mem.record({
      sessionId: 'sess1',
      timestamp: Date.now(),
      description: 'summarize text about dogs',
      input: 'dogs are pets',
      output: 'dogs summary',
      success: true,
      durationMs: 100,
      costCents: 0.01,
      tags: ['summarize'],
    })

    const results = await mem.recall('summarize text')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.description).toBe('summarize text about dogs')
  })

  it('filters by sessionId', async () => {
    const mem = new EpisodicMemory()
    await mem.record({ sessionId: 's1', timestamp: Date.now(), description: 'task1', input: 'q', output: 'a', success: true, durationMs: 10, costCents: 0, tags: [] })
    await mem.record({ sessionId: 's2', timestamp: Date.now(), description: 'task2', input: 'q', output: 'a', success: true, durationMs: 10, costCents: 0, tags: [] })
    const results = await mem.recall('task', { sessionId: 's1' })
    expect(results.every((r) => r.sessionId === 's1')).toBe(true)
  })

  it('filters by tags', async () => {
    const mem = new EpisodicMemory()
    await mem.record({ timestamp: Date.now(), description: 'tagged', input: 'x', output: 'y', success: true, durationMs: 10, costCents: 0, tags: ['important'] })
    await mem.record({ timestamp: Date.now(), description: 'untagged', input: 'x', output: 'y', success: true, durationMs: 10, costCents: 0, tags: [] })
    const results = await mem.recall('x', { tags: ['important'] })
    expect(results.every((r) => r.tags.includes('important'))).toBe(true)
  })

  it('evicts old entries when maxEntries exceeded', async () => {
    const mem = new EpisodicMemory({ maxEntries: 3 })
    for (let i = 0; i < 5; i++) {
      await mem.record({ timestamp: Date.now(), description: `ep${i}`, input: 'x', output: 'y', success: true, durationMs: 10, costCents: 0, tags: [] })
    }
    const results = await mem.recall('ep', { limit: 100 })
    expect(results.length).toBeLessThanOrEqual(3)
  })

  it('MemoryBackend store/query/forget interface', async () => {
    const mem = new EpisodicMemory()
    await mem.store('key1', 'value1', { tags: ['t1'] })
    const items = await mem.query('value1', { tags: ['t1'] })
    expect(items.length).toBeGreaterThan(0)
    const id = items[0]!.key
    await mem.forget(id)
    const after = await mem.query('value1', { tags: ['t1'] })
    expect(after).toHaveLength(0)
  })
})
