/**
 * Tests for research-backed routing features:
 * Semantic cache, speculative cascade, query decomposition, latency router.
 */

import { describe, it, expect } from 'vitest'
import { SemanticCache } from '../../src/planner/semantic-cache.js'
import { speculativeCascade } from '../../src/planner/speculative-cascade.js'
import { decomposeQuery, executeDecomposed } from '../../src/planner/query-decomposer.js'
import { LatencyRouter } from '../../src/planner/latency-router.js'
import { buildModelLadder } from '../../src/planner/cascade-router.js'
import type { Provider, LlmResponse, ProviderModelInfo } from '../../src/types/provider.js'

// ─── Helpers ───

function makeProvider(name: string, models: Array<{
  model: string; tier: 'cheap' | 'standard' | 'premium'; inputCost: number; outputCost: number; quality?: 'good' | 'bad'; delayMs?: number
}>): Provider {
  return {
    name,
    models: models.map((m) => ({ model: m.model, tier: m.tier, inputCostPer1kTokens: m.inputCost, outputCostPer1kTokens: m.outputCost, contextWindow: 128000 })),
    async chat(req) {
      const m = models.find((mm) => mm.model === req.model) ?? models[0]!
      if (m.delayMs) await new Promise((r) => setTimeout(r, m.delayMs))
      const isGood = m.quality !== 'bad'
      return {
        content: isGood ? 'This is a thorough, well-structured response that specifically addresses the query with detailed examples.' : 'idk',
        model: req.model, inputTokens: 150, outputTokens: isGood ? 200 : 5, cachedInputTokens: 0,
        finishReason: 'stop' as const, durationMs: m.delayMs ?? 50,
      }
    },
    estimateCost: (model, inp, out) => {
      const m = models.find((mm) => mm.model === model)
      if (!m) return 0
      return (inp / 1000) * m.inputCost + (out / 1000) * m.outputCost
    },
  }
}

// ─── Semantic Cache ───

describe('SemanticCache', () => {
  it('caches and retrieves similar queries', async () => {
    const cache = new SemanticCache({ similarityThreshold: 0.7 })
    const mockResponse: LlmResponse = {
      content: 'TypeScript generics allow...', model: 'test', inputTokens: 100,
      outputTokens: 50, cachedInputTokens: 0, finishReason: 'stop', durationMs: 100,
    }

    await cache.store(
      { model: 'test', messages: [{ role: 'user', content: 'Explain TypeScript generics' }] },
      mockResponse, 5
    )

    // Similar query should hit cache
    const hit = await cache.lookup({ model: 'test', messages: [{ role: 'user', content: 'Explain TypeScript generics please' }] })
    expect(hit).not.toBeNull()
    expect(hit?.content).toContain('TypeScript generics')
  })

  it('misses on dissimilar queries', async () => {
    const cache = new SemanticCache({ similarityThreshold: 0.85 })
    const mockResponse: LlmResponse = {
      content: 'TypeScript generics allow...', model: 'test', inputTokens: 100,
      outputTokens: 50, cachedInputTokens: 0, finishReason: 'stop', durationMs: 100,
    }

    await cache.store(
      { model: 'test', messages: [{ role: 'user', content: 'Explain TypeScript generics' }] },
      mockResponse, 5
    )

    const miss = await cache.lookup({ model: 'test', messages: [{ role: 'user', content: 'How to deploy Kubernetes on AWS' }] })
    expect(miss).toBeNull()
  })

  it('tracks hit/miss stats', async () => {
    const cache = new SemanticCache()
    const mockResponse: LlmResponse = {
      content: 'Response', model: 'test', inputTokens: 100,
      outputTokens: 50, cachedInputTokens: 0, finishReason: 'stop', durationMs: 100,
    }

    await cache.store({ model: 'test', messages: [{ role: 'user', content: 'test query' }] }, mockResponse, 5)

    await cache.lookup({ model: 'test', messages: [{ role: 'user', content: 'test query' }] }) // hit
    await cache.lookup({ model: 'test', messages: [{ role: 'user', content: 'completely different question about kubernetes' }] }) // miss

    const stats = cache.stats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
    expect(stats.hitRate).toBe(0.5)
  })

  it('cachedChat wraps provider call', async () => {
    const cache = new SemanticCache()
    let callCount = 0

    const chatFn = async () => {
      callCount++
      return { content: 'response', model: 'test', inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, finishReason: 'stop' as const, durationMs: 50 }
    }

    const req = { model: 'test', messages: [{ role: 'user' as const, content: 'hello world' }] }

    const r1 = await cache.cachedChat(req, chatFn, () => 5)
    expect(r1.cacheHit).toBe(false)
    expect(callCount).toBe(1)

    const r2 = await cache.cachedChat(req, chatFn, () => 5)
    expect(r2.cacheHit).toBe(true)
    expect(callCount).toBe(1) // Not called again
  })

  it('clears cache', async () => {
    const cache = new SemanticCache()
    const req = { model: 'test', messages: [{ role: 'user' as const, content: 'test' }] }
    await cache.store(req, { content: 'r', model: 'test', inputTokens: 10, outputTokens: 5, cachedInputTokens: 0, finishReason: 'stop', durationMs: 10 }, 1)

    await cache.clear()
    const miss = await cache.lookup(req)
    expect(miss).toBeNull()
  })
})

// ─── Speculative Cascade ───

describe('Speculative Cascade', () => {
  it('accepts cheap model when quality is good', async () => {
    const provider = makeProvider('test', [
      { model: 'cheap', tier: 'cheap', inputCost: 0.1, outputCost: 0.3, quality: 'good' },
      { model: 'expensive', tier: 'premium', inputCost: 15, outputCost: 75, quality: 'good' },
    ])

    const ladder = buildModelLadder([provider])
    const result = await speculativeCascade(
      { model: '', messages: [{ role: 'user', content: 'test' }] },
      { ladder, parallelWidth: 2 },
    )

    expect(result.winnerSlot).toBe(0) // Cheapest won
    expect(result.model.model).toBe('cheap')
  })

  it('falls back to expensive when cheap is bad', async () => {
    const provider = makeProvider('test', [
      { model: 'cheap', tier: 'cheap', inputCost: 0.1, outputCost: 0.3, quality: 'bad' },
      { model: 'expensive', tier: 'premium', inputCost: 15, outputCost: 75, quality: 'good' },
    ])

    const ladder = buildModelLadder([provider])
    const result = await speculativeCascade(
      { model: '', messages: [{ role: 'user', content: 'test' }] },
      { ladder, parallelWidth: 2 },
    )

    expect(result.winnerSlot).toBe(1)
    expect(result.model.model).toBe('expensive')
  })

  it('tracks total cost (both parallel models)', async () => {
    const provider = makeProvider('test', [
      { model: 'cheap', tier: 'cheap', inputCost: 0.1, outputCost: 0.3, quality: 'good' },
      { model: 'mid', tier: 'standard', inputCost: 3, outputCost: 15, quality: 'good' },
    ])

    const ladder = buildModelLadder([provider])
    const result = await speculativeCascade(
      { model: '', messages: [{ role: 'user', content: 'test' }] },
      { ladder, parallelWidth: 2 },
    )

    // Both models ran, so total cost includes both
    expect(result.totalCostCents).toBeGreaterThan(0)
    expect(result.trace.length).toBe(2)
  })
})

// ─── Query Decomposition ───

describe('Query Decomposition', () => {
  it('decomposes numbered list into subtasks', () => {
    const result = decomposeQuery('1. Research TypeScript ORMs\n2. Compare their performance\n3. Write a recommendation')
    expect(result.subtasks.length).toBe(3)
  })

  it('decomposes bullet points', () => {
    const result = decomposeQuery('- Find all security vulnerabilities\n- Fix the critical ones\n- Write a report')
    expect(result.subtasks.length).toBe(3)
  })

  it('keeps simple queries as single task', () => {
    const result = decomposeQuery('What is TypeScript?')
    expect(result.subtasks.length).toBe(1)
  })

  it('assigns complexity based on content', () => {
    const result = decomposeQuery('1. List all files\n2. Analyze and compare the security trade-offs of each approach')
    expect(result.subtasks.length).toBe(2)
    // First is simple (list), second is complex (analyze + compare + trade-offs)
    expect(result.subtasks[0]!.complexity).toBe('trivial')
    expect(result.subtasks[1]!.complexity).toBe('complex')
  })

  it('maps complexity to model tiers', () => {
    const result = decomposeQuery('1. Get the current time\n2. Analyze the architectural implications')
    expect(result.subtasks[0]!.recommendedTier).toBe('cheap')
    expect(result.subtasks[1]!.recommendedTier).toBe('premium')
  })

  it('executes decomposed tasks against providers', async () => {
    const provider = makeProvider('test', [
      { model: 'cheap', tier: 'cheap', inputCost: 0.1, outputCost: 0.3 },
      { model: 'mid', tier: 'standard', inputCost: 3, outputCost: 15 },
      { model: 'expensive', tier: 'premium', inputCost: 15, outputCost: 75 },
    ])

    const decomposed = decomposeQuery('1. List all files\n2. Analyze the code quality')
    const ladder = buildModelLadder([provider])
    const result = await executeDecomposed(decomposed, ladder)

    expect(result.responses.length).toBe(2)
    expect(result.totalCostCents).toBeGreaterThan(0)
    // Trivial task should use cheap model, complex should use premium
    expect(result.responses[0]!.model).toBe('cheap')
  })
})

// ─── Latency Router ───

describe('Latency Router', () => {
  it('picks model with lowest latency when optimizing for latency', () => {
    const provider = makeProvider('test', [
      { model: 'slow', tier: 'cheap', inputCost: 0.1, outputCost: 0.3 },
      { model: 'fast', tier: 'standard', inputCost: 3, outputCost: 15 },
    ])

    const ladder = buildModelLadder([provider])
    const router = new LatencyRouter({ ladder, optimizeFor: 'latency' })

    // Record latencies
    router.recordLatency('test', 'slow', 5000)
    router.recordLatency('test', 'slow', 4500)
    router.recordLatency('test', 'fast', 200)
    router.recordLatency('test', 'fast', 250)

    const pick = router.pick()
    expect(pick?.model.model).toBe('fast')
  })

  it('picks cheapest model when optimizing for cost', () => {
    const provider = makeProvider('test', [
      { model: 'cheap', tier: 'cheap', inputCost: 0.1, outputCost: 0.3 },
      { model: 'expensive', tier: 'premium', inputCost: 15, outputCost: 75 },
    ])

    const ladder = buildModelLadder([provider])
    const router = new LatencyRouter({ ladder, optimizeFor: 'cost' })

    const pick = router.pick()
    expect(pick?.model.model).toBe('cheap')
  })

  it('respects maxLatencyMs constraint', () => {
    const provider = makeProvider('test', [
      { model: 'slow-cheap', tier: 'cheap', inputCost: 0.1, outputCost: 0.3 },
      { model: 'fast-mid', tier: 'standard', inputCost: 3, outputCost: 15 },
    ])

    const ladder = buildModelLadder([provider])
    const router = new LatencyRouter({ ladder, maxLatencyMs: 1000, optimizeFor: 'balanced' })

    router.recordLatency('test', 'slow-cheap', 3000)
    router.recordLatency('test', 'slow-cheap', 2500)
    router.recordLatency('test', 'fast-mid', 500)
    router.recordLatency('test', 'fast-mid', 600)

    const pick = router.pick()
    expect(pick?.model.model).toBe('fast-mid')
  })

  it('tracks EMA latency with smoothing', () => {
    const provider = makeProvider('test', [
      { model: 'test', tier: 'cheap', inputCost: 0.1, outputCost: 0.3 },
    ])

    const ladder = buildModelLadder([provider])
    const router = new LatencyRouter({ ladder, emaSmoothing: 0.5 })

    router.recordLatency('test', 'test', 1000)
    router.recordLatency('test', 'test', 500)
    // EMA: 0.5 * 500 + 0.5 * 1000 = 750

    const stats = router.getStats()
    expect(stats[0]!.emaLatencyMs).toBe(750)
  })

  it('exports and imports state', () => {
    const provider = makeProvider('test', [
      { model: 'test', tier: 'cheap', inputCost: 0.1, outputCost: 0.3 },
    ])

    const ladder = buildModelLadder([provider])
    const r1 = new LatencyRouter({ ladder })
    r1.recordLatency('test', 'test', 500)

    const state = r1.exportState()
    const r2 = new LatencyRouter({ ladder })
    r2.importState(state)

    expect(r2.getStats().length).toBe(1)
    expect(r2.getStats()[0]!.emaLatencyMs).toBe(500)
  })
})
