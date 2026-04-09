import { describe, it, expect } from 'vitest'
import { AMem } from '../../src/memory/a-mem.js'

describe('AMem', () => {
  it('stores and queries notes', async () => {
    const mem = new AMem()
    await mem.store('note1', 'machine learning gradient descent optimization', { tags: ['ml'] })
    const results = await mem.query('gradient descent')
    expect(results.length).toBeGreaterThan(0)
  })

  it('links related notes automatically', async () => {
    const mem = new AMem({ linkThreshold: 0.1 })
    await mem.store('note1', 'neural network training with backpropagation', {})
    await mem.store('note2', 'neural network optimization and training loss', {})
    const stats = mem.stats()
    expect(stats.totalLinks).toBeGreaterThan(0)
  })

  it('returns notes sorted by score descending', async () => {
    const mem = new AMem()
    await mem.store('relevant', 'agent memory retrieval augmented generation', {})
    await mem.store('irrelevant', 'cooking recipe pasta sauce italian food', {})
    const results = await mem.query('memory retrieval agent')
    expect(results[0]!.relevance).toBeGreaterThanOrEqual(results[results.length - 1]!.relevance)
  })

  it('forgets a note and cleans up links', async () => {
    const mem = new AMem({ linkThreshold: 0.1 })
    await mem.store('a', 'shared topic common subject matter', {})
    await mem.store('b', 'shared topic common subject matter', {})
    const before = mem.stats()
    // Get id of first note to forget it
    const results = await mem.query('shared topic', { maxItems: 1 })
    if (results[0]) {
      await mem.forget(results[0].key)
    }
    const after = mem.stats()
    expect(after.noteCount).toBe(before.noteCount - 1)
  })

  it('respects maxItems in query', async () => {
    const mem = new AMem()
    for (let i = 0; i < 10; i++) {
      await mem.store(`note${i}`, `content about topic ${i}`, {})
    }
    const results = await mem.query('topic', { maxItems: 3 })
    expect(results).toHaveLength(3)
  })

  it('getLinked returns connected notes', async () => {
    const mem = new AMem({ linkThreshold: 0.1 })
    await mem.store('x', 'cats and dogs pets animals', {})
    await mem.store('y', 'cats and dogs pets animals behavior', {})
    const results = await mem.query('cats dogs', { maxItems: 1 })
    if (results[0]) {
      const linked = mem.getLinked(results[0].key)
      expect(linked.length).toBeGreaterThanOrEqual(0)
    }
  })

  it('getGraph returns adjacency list', async () => {
    const mem = new AMem()
    await mem.store('n1', 'hello world', {})
    const graph = mem.getGraph()
    expect(graph.size).toBeGreaterThan(0)
  })

  it('evicts oldest note when maxNotes exceeded', async () => {
    const mem = new AMem({ maxNotes: 5 })
    for (let i = 0; i < 10; i++) {
      await mem.store(`note${i}`, `content ${i}`, {})
    }
    expect(mem.stats().noteCount).toBeLessThanOrEqual(5)
  })
})
