import { describe, it, expect, vi, afterEach } from 'vitest'
import { SleepTimeAgent } from '../../src/workers/sleep-time-agent.js'
import type { MemoryBackend, MemoryItem, StoreMeta } from '../../src/types/memory.js'
import type { Provider } from '../../src/types/provider.js'

function mockMemory(items: MemoryItem[] = []): MemoryBackend {
  const stored: Array<{ key: string; value: unknown; meta: StoreMeta }> = []
  return {
    store: vi.fn(async (key, value, meta) => { stored.push({ key, value, meta }) }),
    query: vi.fn(async () => items),
    forget: vi.fn(async () => {}),
  }
}

function mockProvider(response = '["insight one", "insight two"]'): Provider {
  return {
    name: 'mock',
    chat: vi.fn(async () => ({
      content: response,
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 0,
      durationMs: 10,
    })),
    countTokens: vi.fn(async () => 10),
  } as unknown as Provider
}

describe('SleepTimeAgent', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns empty result when no memories', async () => {
    const agent = new SleepTimeAgent({
      memory: mockMemory([]),
      provider: mockProvider(),
      model: { model: 'test-model' },
    })
    const result = await agent.consolidate()
    expect(result.itemsReviewed).toBe(0)
    expect(result.insightsExtracted).toBe(0)
  })

  it('extracts insights from memory items', async () => {
    const items: MemoryItem[] = [
      { key: 'k1', value: 'agent executed task successfully', relevance: 0.8, meta: {}, storedAt: Date.now() },
      { key: 'k2', value: 'retry helped recover from failure', relevance: 0.7, meta: {}, storedAt: Date.now() },
    ]
    const mem = mockMemory(items)
    const agent = new SleepTimeAgent({
      memory: mem,
      provider: mockProvider('["agents benefit from retries", "success requires planning"]'),
      model: { model: 'test-model' },
    })
    const result = await agent.consolidate()
    expect(result.itemsReviewed).toBe(2)
    expect(result.insightsExtracted).toBe(2)
    expect(mem.store).toHaveBeenCalledTimes(2)
  })

  it('evicts weak memories when evictWeak=true', async () => {
    const items: MemoryItem[] = [
      { key: 'weak', value: 'old data', relevance: 0.01, meta: {}, storedAt: Date.now() },
    ]
    const mem = mockMemory(items)
    const agent = new SleepTimeAgent({
      memory: mem,
      provider: mockProvider('[]'),
      model: { model: 'test-model' },
      evictWeak: true,
      evictionThreshold: 0.05,
    })
    const result = await agent.consolidate()
    expect(result.itemsForgotten).toBe(1)
    expect(mem.forget).toHaveBeenCalledWith('weak')
  })

  it('handles LLM failure gracefully', async () => {
    const items: MemoryItem[] = [
      { key: 'k1', value: 'content', relevance: 0.9, meta: {}, storedAt: Date.now() },
    ]
    const badProvider = {
      name: 'bad',
      chat: vi.fn(async () => { throw new Error('LLM down') }),
      countTokens: vi.fn(),
    } as unknown as Provider
    const agent = new SleepTimeAgent({
      memory: mockMemory(items),
      provider: badProvider,
      model: { model: 'test-model' },
    })
    const result = await agent.consolidate()
    expect(result.insightsExtracted).toBe(0)
    expect(result.itemsReviewed).toBe(1)
  })

  it('start and stop work', async () => {
    vi.useFakeTimers()
    const agent = new SleepTimeAgent({
      memory: mockMemory(),
      provider: mockProvider(),
      model: { model: 'test-model' },
    })
    expect(agent.isRunning).toBe(false)
    agent.start(1000)
    expect(agent.isRunning).toBe(true)
    agent.stop()
    expect(agent.isRunning).toBe(false)
    vi.useRealTimers()
  })

  it('does not start twice', () => {
    vi.useFakeTimers()
    const agent = new SleepTimeAgent({
      memory: mockMemory(),
      provider: mockProvider(),
      model: { model: 'test-model' },
    })
    agent.start(1000)
    agent.start(1000) // second call should be no-op
    agent.stop()
    vi.useRealTimers()
  })
})
