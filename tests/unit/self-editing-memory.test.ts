import { describe, it, expect } from 'vitest'
import { SelfEditingMemory } from '../../src/memory/self-editing.js'

describe('SelfEditingMemory', () => {
  it('creates blocks from config', () => {
    const mem = new SelfEditingMemory({
      blocks: [{ name: 'persona', content: 'You are a helpful assistant.' }],
    })
    expect(mem.getBlock('persona')).toBeDefined()
    expect(mem.getBlock('persona')!.content).toBe('You are a helpful assistant.')
  })

  it('write updates content and increments version', () => {
    const mem = new SelfEditingMemory()
    mem.createBlock('notes')
    mem.write('notes', 'First draft content')
    const block = mem.getBlock('notes')!
    expect(block.content).toBe('First draft content')
    expect(block.version).toBe(1)
  })

  it('append adds to existing content', () => {
    const mem = new SelfEditingMemory({ blocks: [{ name: 'log' }] })
    mem.append('log', 'line1\n')
    mem.append('log', 'line2\n')
    expect(mem.getBlock('log')!.content).toBe('line1\nline2\n')
  })

  it('respects maxChars — truncates on write', () => {
    const mem = new SelfEditingMemory({ blocks: [{ name: 'small', maxChars: 10 }] })
    mem.write('small', 'this is longer than ten characters')
    expect(mem.getBlock('small')!.content.length).toBe(10)
  })

  it('strictSizing throws on overflow', () => {
    const mem = new SelfEditingMemory({ blocks: [{ name: 'strict', maxChars: 5 }], strictSizing: true })
    expect(() => mem.write('strict', 'toolong')).toThrow()
  })

  it('patch replaces substring', () => {
    const mem = new SelfEditingMemory({ blocks: [{ name: 'doc', content: 'Hello World' }] })
    mem.patch('doc', 'World', 'Claude')
    expect(mem.getBlock('doc')!.content).toBe('Hello Claude')
  })

  it('revert restores previous version', () => {
    const mem = new SelfEditingMemory()
    mem.createBlock('b')
    mem.write('b', 'version 1')
    mem.write('b', 'version 2')
    mem.revert('b', 1)
    expect(mem.getBlock('b')!.content).toBe('version 1')
  })

  it('getHistory tracks edits', () => {
    const mem = new SelfEditingMemory()
    mem.createBlock('h')
    mem.write('h', 'a')
    mem.write('h', 'b')
    expect(mem.getHistory('h').length).toBe(2)
  })

  it('toContextString formats all blocks', () => {
    const mem = new SelfEditingMemory({
      blocks: [
        { name: 'persona', content: 'helpful assistant' },
        { name: 'goal', content: 'answer questions' },
      ],
    })
    const ctx = mem.toContextString()
    expect(ctx).toContain('persona')
    expect(ctx).toContain('helpful assistant')
    expect(ctx).toContain('goal')
  })

  it('MemoryBackend store and query work', async () => {
    const mem = new SelfEditingMemory()
    await mem.store('key1', 'machine learning neural networks training', {})
    const results = await mem.query('neural networks')
    expect(results.length).toBeGreaterThan(0)
  })

  it('MemoryBackend forget removes block', async () => {
    const mem = new SelfEditingMemory()
    await mem.store('key1', 'content', {})
    await mem.forget('key1')
    expect(mem.getBlock('key1')).toBeUndefined()
  })

  it('stats reports correctly', () => {
    const mem = new SelfEditingMemory({ blocks: [{ name: 'a', content: 'hello' }] })
    const stats = mem.stats()
    expect(stats.blockCount).toBe(1)
    expect(stats.totalChars).toBe(5)
  })
})
