import { describe, it, expect } from 'vitest'
import { ProceduralMemory } from '../../src/memory/procedural.js'

describe('ProceduralMemory', () => {
  it('learns and recalls a procedure', async () => {
    const mem = new ProceduralMemory()
    await mem.learn({
      name: 'summarize-text',
      goal: 'summarize a piece of text',
      steps: [
        { order: 1, action: 'read input', inputs: ['text'] },
        { order: 2, action: 'generate summary', output: 'summary' },
      ],
      tags: ['summarize'],
    })

    const results = await mem.recallFor('summarize text')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.goal).toContain('summarize')
  })

  it('recallFor finds by semantic similarity', async () => {
    const mem = new ProceduralMemory()
    await mem.learn({ name: 'translate', goal: 'translate text from one language to another', steps: [], tags: [] })
    await mem.learn({ name: 'summarize', goal: 'condense a long document to a short summary', steps: [], tags: [] })

    const results = await mem.recallFor('shorten a document')
    expect(results[0]!.name).toBe('summarize')
  })

  it('recordOutcome updates successCount', async () => {
    const mem = new ProceduralMemory()
    const proc = await mem.learn({ name: 'p1', goal: 'do something', steps: [], tags: [] })
    await mem.recordOutcome(proc.id, true)
    await mem.recordOutcome(proc.id, false)
    const results = await mem.recallFor('do something')
    expect(results[0]!.totalCount).toBe(2)
    expect(results[0]!.successCount).toBe(1)
  })

  it('evicts LRU when maxProcedures exceeded', async () => {
    const mem = new ProceduralMemory({ maxProcedures: 2 })
    await mem.learn({ name: 'p1', goal: 'goal one', steps: [], tags: [] })
    await mem.learn({ name: 'p2', goal: 'goal two', steps: [], tags: [] })
    await mem.learn({ name: 'p3', goal: 'goal three', steps: [], tags: [] })
    const results = await mem.recallFor('goal', { limit: 10 })
    expect(results).toHaveLength(2)
  })

  it('MemoryBackend store/query/forget interface', async () => {
    const mem = new ProceduralMemory()
    await mem.store('key1', 'how to bake a cake', { tags: [] })
    const items = await mem.query('bake cake')
    expect(items.length).toBeGreaterThan(0)
    const id = items[0]!.key
    await mem.forget(id)
    const after = await mem.query('bake cake')
    expect(after).toHaveLength(0)
  })
})
