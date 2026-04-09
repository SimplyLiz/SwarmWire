import { describe, it, expect, vi } from 'vitest'
import { SpeculativeToolExecutor, createKeywordPredictor } from '../../src/executor/speculative-tools.js'
import type { Tool } from '../../src/types/tool.js'

function mockTool(name: string, output: unknown, delay = 0): Tool {
  return {
    name,
    description: `Mock ${name}`,
    inputSchema: {},
    execute: vi.fn(async () => {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay))
      return output
    }),
  }
}

describe('SpeculativeToolExecutor', () => {
  it('executes a tool and returns result', async () => {
    const tool = mockTool('fetch', { data: 42 })
    const exec = new SpeculativeToolExecutor({ tools: [tool] })
    const result = await exec.execute('fetch', { url: 'x' })
    expect(result.output).toEqual({ data: 42 })
    expect(result.cacheHit).toBe(false)
  })

  it('returns cached result on second execute', async () => {
    const tool = mockTool('fetch', 'cached')
    const exec = new SpeculativeToolExecutor({ tools: [tool] })
    exec.prefetch([{ toolName: 'fetch', input: { url: 'x' }, confidence: 0.9 }])
    // Small delay to let prefetch settle
    await new Promise((r) => setTimeout(r, 10))
    const result = await exec.execute('fetch', { url: 'x' })
    expect(result.cacheHit).toBe(true)
    expect(result.output).toBe('cached')
  })

  it('skips prefetch below confidence threshold', () => {
    const tool = mockTool('fetch', 'data')
    const exec = new SpeculativeToolExecutor({ tools: [tool], minConfidence: 0.8 })
    exec.prefetch([{ toolName: 'fetch', input: {}, confidence: 0.3 }])
    expect((tool.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('respects maxSpeculative limit', () => {
    const tools = ['a', 'b', 'c', 'd'].map((n) => mockTool(n, n))
    const exec = new SpeculativeToolExecutor({ tools, maxSpeculative: 2 })
    exec.prefetch(tools.map((t) => ({ toolName: t.name, input: {}, confidence: 1 })))
    const totalCalls = tools.reduce((s, t) => s + (t.execute as ReturnType<typeof vi.fn>).mock.calls.length, 0)
    expect(totalCalls).toBeLessThanOrEqual(2)
  })

  it('throws for unknown tool', async () => {
    const exec = new SpeculativeToolExecutor({ tools: [] })
    await expect(exec.execute('unknown', {})).rejects.toThrow('Tool not found')
  })

  it('tracks stats', async () => {
    const tool = mockTool('t', 'v')
    const exec = new SpeculativeToolExecutor({ tools: [tool] })
    await exec.execute('t', {})
    expect(exec.getStats().misses).toBe(1)
  })
})

describe('createKeywordPredictor', () => {
  it('returns predictions when keywords match', () => {
    const predictor = createKeywordPredictor([
      { toolName: 'search', keywords: ['search', 'find', 'lookup'], defaultInput: { q: '' } },
    ])
    const preds = predictor('please search for documents about agents')
    expect(preds.length).toBeGreaterThan(0)
    expect(preds[0]!.toolName).toBe('search')
    expect(preds[0]!.confidence).toBeGreaterThan(0)
  })

  it('returns empty when no keywords match', () => {
    const predictor = createKeywordPredictor([
      { toolName: 'file', keywords: ['file', 'disk', 'write'], defaultInput: {} },
    ])
    const preds = predictor('calculate the average price')
    expect(preds).toHaveLength(0)
  })
})
