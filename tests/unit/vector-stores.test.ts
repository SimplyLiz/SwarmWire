import { describe, it, expect } from 'vitest'
import { createFlatVectorStore } from '../../src/memory/vector-stores.js'

// Stable hash-based embed for deterministic tests
function embed(text: string): number[] {
  const words = text.toLowerCase().split(/\W+/).filter(Boolean)
  const dim = 32
  const vec = new Array<number>(dim).fill(0)
  for (const w of words) {
    let h = 5381
    for (let i = 0; i < w.length; i++) h = ((h << 5) + h) ^ w.charCodeAt(i)
    vec[Math.abs(h) % dim]! += 1
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map((v) => v / norm)
}

const config = { dimension: 32, embedFn: embed }

describe('createFlatVectorStore', () => {
  it('stores and retrieves items', async () => {
    const store = createFlatVectorStore(config)
    await store.store('k1', 'machine learning neural networks', { tags: ['ml'] })
    const results = await store.query('neural networks machine learning')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.key).toBe('k1')
  })

  it('returns items sorted by relevance desc', async () => {
    const store = createFlatVectorStore(config)
    await store.store('relevant', 'deep learning transformer attention model', {})
    await store.store('irrelevant', 'pizza pasta tomato sauce cheese recipe', {})
    const results = await store.query('transformer attention deep learning')
    expect(results[0]!.key).toBe('relevant')
  })

  it('respects maxItems', async () => {
    const store = createFlatVectorStore(config)
    for (let i = 0; i < 10; i++) {
      await store.store(`k${i}`, `content item ${i} topic`, {})
    }
    const results = await store.query('topic content', { maxItems: 3 })
    expect(results).toHaveLength(3)
  })

  it('respects minRelevance filter', async () => {
    const store = createFlatVectorStore(config)
    await store.store('k1', 'completely unrelated random gibberish zzz', {})
    const results = await store.query('machine learning agent', { minRelevance: 0.99 })
    expect(results).toHaveLength(0)
  })

  it('forget removes item', async () => {
    const store = createFlatVectorStore(config)
    await store.store('to-delete', 'some content here', {})
    await store.forget('to-delete')
    const results = await store.query('some content here')
    expect(results.find((r) => r.key === 'to-delete')).toBeUndefined()
  })

  it('returns relevance in [0, 1]', async () => {
    const store = createFlatVectorStore(config)
    await store.store('k1', 'hello world test content', {})
    const results = await store.query('hello world')
    for (const r of results) {
      expect(r.relevance).toBeGreaterThanOrEqual(0)
      expect(r.relevance).toBeLessThanOrEqual(1)
    }
  })
})
