/**
 * CascadeRouter tests — verify cost-efficient routing with escalation.
 */

import { describe, it, expect } from 'vitest'
import { CascadeRouter, buildModelLadder } from '../../src/planner/cascade-router.js'
import type { Provider, LlmResponse, ProviderModelInfo } from '../../src/types/provider.js'

// ─── Test Helpers ───

function makeProvider(name: string, models: Array<{
  model: string
  tier: 'cheap' | 'standard' | 'premium' | 'reasoning'
  inputCost: number
  outputCost: number
  /** If set, the model returns this quality of response */
  responseQuality?: 'good' | 'bad' | 'truncated' | 'empty' | 'error'
}>): Provider {
  const modelInfos: ProviderModelInfo[] = models.map((m) => ({
    model: m.model,
    tier: m.tier,
    inputCostPer1kTokens: m.inputCost,
    outputCostPer1kTokens: m.outputCost,
    contextWindow: 128_000,
  }))

  const qualityMap = new Map(models.map((m) => [m.model, m.responseQuality ?? 'good']))

  return {
    name,
    models: modelInfos,
    async chat(req) {
      const quality = qualityMap.get(req.model) ?? 'good'

      if (quality === 'error') throw new Error(`${req.model} failed`)

      const responses: Record<string, Partial<LlmResponse>> = {
        good: { content: 'This is a thorough, well-structured response that specifically addresses the query with detailed examples and clear reasoning.', finishReason: 'stop', outputTokens: 200 },
        bad: { content: 'idk', finishReason: 'stop', outputTokens: 5 },
        truncated: { content: 'This response was cut off because', finishReason: 'max_tokens', outputTokens: 100 },
        empty: { content: '', finishReason: 'stop', outputTokens: 0 },
      }

      const r = responses[quality]!
      return {
        content: r.content ?? '',
        model: req.model,
        inputTokens: 150,
        outputTokens: r.outputTokens ?? 50,
        cachedInputTokens: 0,
        finishReason: r.finishReason ?? 'stop',
        durationMs: 100,
      } as LlmResponse
    },
    estimateCost: (model, inp, out) => {
      const info = modelInfos.find((m) => m.model === model)
      if (!info) return 0
      return (inp / 1000) * info.inputCostPer1kTokens + (out / 1000) * info.outputCostPer1kTokens
    },
  }
}

function makeRequest(content = 'Explain how TypeScript generics work') {
  return { model: '', messages: [{ role: 'user' as const, content }] }
}

// ─── Tests ───

describe('ModelLadder', () => {
  it('sorts models from cheapest to most expensive', () => {
    const provider = makeProvider('test', [
      { model: 'expensive', tier: 'premium', inputCost: 15, outputCost: 75 },
      { model: 'cheap', tier: 'cheap', inputCost: 0.25, outputCost: 1.25 },
      { model: 'mid', tier: 'standard', inputCost: 3, outputCost: 15 },
    ])

    const ladder = buildModelLadder([provider])
    expect(ladder.rungs.length).toBe(3)
    expect(ladder.rungs[0]!.model.model).toBe('cheap')
    expect(ladder.rungs[1]!.model.model).toBe('mid')
    expect(ladder.rungs[2]!.model.model).toBe('expensive')
  })

  it('combines models across multiple providers', () => {
    const anthropic = makeProvider('anthropic', [
      { model: 'haiku', tier: 'cheap', inputCost: 0.8, outputCost: 4 },
      { model: 'sonnet', tier: 'standard', inputCost: 3, outputCost: 15 },
      { model: 'opus', tier: 'premium', inputCost: 15, outputCost: 75 },
    ])
    const openai = makeProvider('openai', [
      { model: 'gpt-4o-mini', tier: 'cheap', inputCost: 0.15, outputCost: 0.6 },
      { model: 'gpt-4o', tier: 'standard', inputCost: 2.5, outputCost: 10 },
    ])

    const ladder = buildModelLadder([anthropic, openai])
    expect(ladder.rungs.length).toBe(5)
    // Cheapest should be gpt-4o-mini (0.75 total) then haiku (4.8)
    expect(ladder.rungs[0]!.model.model).toBe('gpt-4o-mini')
    expect(ladder.rungs[0]!.provider.name).toBe('openai')
  })
})

describe('CascadeRouter: Basic routing', () => {
  it('uses cheapest model when it produces good quality', async () => {
    const provider = makeProvider('test', [
      { model: 'cheap', tier: 'cheap', inputCost: 0.1, outputCost: 0.3, responseQuality: 'good' },
      { model: 'expensive', tier: 'premium', inputCost: 15, outputCost: 75, responseQuality: 'good' },
    ])

    const router = new CascadeRouter({ providers: [provider] })
    const result = await router.route(makeRequest())

    expect(result.model.model).toBe('cheap')
    expect(result.escalations).toBe(0)
    expect(result.trace.length).toBe(1)
    expect(result.trace[0]!.accepted).toBe(true)
  })

  it('escalates when cheap model produces bad quality', async () => {
    const provider = makeProvider('test', [
      { model: 'cheap', tier: 'cheap', inputCost: 0.1, outputCost: 0.3, responseQuality: 'bad' },
      { model: 'mid', tier: 'standard', inputCost: 3, outputCost: 15, responseQuality: 'good' },
      { model: 'expensive', tier: 'premium', inputCost: 15, outputCost: 75, responseQuality: 'good' },
    ])

    const router = new CascadeRouter({ providers: [provider] })
    const result = await router.route(makeRequest())

    expect(result.model.model).toBe('mid')
    expect(result.escalations).toBe(1)
    expect(result.trace.length).toBe(2)
    expect(result.trace[0]!.accepted).toBe(false)
    expect(result.trace[1]!.accepted).toBe(true)
  })

  it('escalates through multiple models to find quality', async () => {
    const provider = makeProvider('test', [
      { model: 'cheap', tier: 'cheap', inputCost: 0.1, outputCost: 0.3, responseQuality: 'empty' },
      { model: 'mid', tier: 'standard', inputCost: 3, outputCost: 15, responseQuality: 'bad' },
      { model: 'expensive', tier: 'premium', inputCost: 15, outputCost: 75, responseQuality: 'good' },
    ])

    const router = new CascadeRouter({ providers: [provider], maxEscalations: 3 })
    const result = await router.route(makeRequest())

    expect(result.model.model).toBe('expensive')
    expect(result.escalations).toBe(2)
  })

  it('skips models that error and continues cascade', async () => {
    const provider = makeProvider('test', [
      { model: 'broken', tier: 'cheap', inputCost: 0.1, outputCost: 0.3, responseQuality: 'error' },
      { model: 'works', tier: 'standard', inputCost: 3, outputCost: 15, responseQuality: 'good' },
    ])

    const router = new CascadeRouter({ providers: [provider] })
    const result = await router.route(makeRequest())

    expect(result.model.model).toBe('works')
    expect(result.trace[0]!.accepted).toBe(false)
  })
})

describe('CascadeRouter: Quality estimators', () => {
  it('heuristic: truncated responses score lower', async () => {
    const provider = makeProvider('test', [
      { model: 'truncator', tier: 'cheap', inputCost: 0.1, outputCost: 0.3, responseQuality: 'truncated' },
      { model: 'complete', tier: 'standard', inputCost: 3, outputCost: 15, responseQuality: 'good' },
    ])

    const router = new CascadeRouter({ providers: [provider], qualityEstimator: 'heuristic' })
    const result = await router.route(makeRequest())

    // Truncated should escalate to complete
    expect(result.model.model).toBe('complete')
  })

  it('self-check: uncertain responses score lower', async () => {
    // Create a provider where cheap model says "I'm not sure"
    const provider: Provider = {
      name: 'test',
      models: [
        { model: 'uncertain', tier: 'cheap', inputCostPer1kTokens: 0.1, outputCostPer1kTokens: 0.3, contextWindow: 128000 },
        { model: 'confident', tier: 'standard', inputCostPer1kTokens: 3, outputCostPer1kTokens: 15, contextWindow: 128000 },
      ],
      async chat(req) {
        if (req.model === 'uncertain') {
          return { content: "I'm not sure about this, I apologize but I don't have access to that information.", model: req.model, inputTokens: 100, outputTokens: 30, cachedInputTokens: 0, finishReason: 'stop', durationMs: 50 }
        }
        return { content: 'Specifically, TypeScript generics work by using type parameters. For example, the key advantage is type safety with reusability.', model: req.model, inputTokens: 100, outputTokens: 80, cachedInputTokens: 0, finishReason: 'stop', durationMs: 50 }
      },
      estimateCost: () => 0.04,
    }

    const router = new CascadeRouter({ providers: [provider], qualityEstimator: 'self-check' })
    const result = await router.route(makeRequest())

    expect(result.model.model).toBe('confident')
  })

  it('custom quality estimator function', async () => {
    const provider = makeProvider('test', [
      { model: 'cheap', tier: 'cheap', inputCost: 0.1, outputCost: 0.3, responseQuality: 'good' },
      { model: 'expensive', tier: 'premium', inputCost: 15, outputCost: 75, responseQuality: 'good' },
    ])

    // Custom estimator that always rejects cheap models
    const router = new CascadeRouter({
      providers: [provider],
      qualityEstimator: (_req, _resp, model) => model.tier === 'premium' ? 0.95 : 0.3,
    })

    const result = await router.route(makeRequest())
    expect(result.model.model).toBe('expensive')
  })
})

describe('CascadeRouter: Budget enforcement', () => {
  it('stops escalating when budget is exhausted', async () => {
    const provider = makeProvider('test', [
      { model: 'cheap', tier: 'cheap', inputCost: 0.1, outputCost: 0.3, responseQuality: 'bad' },
      { model: 'expensive', tier: 'premium', inputCost: 15, outputCost: 75, responseQuality: 'good' },
    ])

    const router = new CascadeRouter({
      providers: [provider],
      budget: { maxCostCents: 0.05 }, // Can only afford cheap model
    })

    const result = await router.route(makeRequest())
    // Should return cheap model's bad response since we can't afford expensive
    expect(result.model.model).toBe('cheap')
    expect(result.modelsTriedNames.length).toBe(1)
  })
})

describe('CascadeRouter: Bandit learning', () => {
  it('learns model preferences over time', async () => {
    const provider = makeProvider('test', [
      { model: 'cheap', tier: 'cheap', inputCost: 0.1, outputCost: 0.3, responseQuality: 'good' },
      { model: 'expensive', tier: 'premium', inputCost: 15, outputCost: 75, responseQuality: 'good' },
    ])

    const router = new CascadeRouter({
      providers: [provider],
      explorationRate: 0, // No exploration — pure exploitation
    })

    // Run several queries to build history
    for (let i = 0; i < 10; i++) {
      await router.route(makeRequest('Explain TypeScript generics'))
    }

    // Stats should show cheap model with high success rate
    const stats = router.getStats()
    const cheapStat = stats.modelStats.find((m) => m.model === 'cheap')
    expect(cheapStat).toBeDefined()
    expect(cheapStat!.successRate).toBeGreaterThan(0.5)
    expect(cheapStat!.totalCalls).toBeGreaterThan(0)
  })

  it('tracks cost savings', async () => {
    const provider = makeProvider('test', [
      { model: 'cheap', tier: 'cheap', inputCost: 0.1, outputCost: 0.3, responseQuality: 'good' },
      { model: 'expensive', tier: 'premium', inputCost: 15, outputCost: 75, responseQuality: 'good' },
    ])

    const router = new CascadeRouter({ providers: [provider], explorationRate: 0 })

    for (let i = 0; i < 5; i++) {
      await router.route(makeRequest())
    }

    const stats = router.getStats()
    // Should show savings since cheap model handled everything
    expect(stats.costSavingsEstimate).toBeGreaterThanOrEqual(0)
  })

  it('exports and imports state', async () => {
    const provider = makeProvider('test', [
      { model: 'cheap', tier: 'cheap', inputCost: 0.1, outputCost: 0.3, responseQuality: 'good' },
    ])

    const router1 = new CascadeRouter({ providers: [provider] })
    for (let i = 0; i < 5; i++) {
      await router1.route(makeRequest())
    }

    const state = router1.exportState()
    expect(state.size).toBeGreaterThan(0)

    const router2 = new CascadeRouter({ providers: [provider] })
    router2.importState(state)

    const stats = router2.getStats()
    expect(stats.modelStats.some((m) => m.totalCalls > 0)).toBe(true)
  })
})

describe('CascadeRouter: Multi-provider ladder', () => {
  it('routes across providers based on cost', async () => {
    const anthropic = makeProvider('anthropic', [
      { model: 'haiku', tier: 'cheap', inputCost: 0.8, outputCost: 4, responseQuality: 'bad' },
      { model: 'sonnet', tier: 'standard', inputCost: 3, outputCost: 15, responseQuality: 'good' },
      { model: 'opus', tier: 'premium', inputCost: 15, outputCost: 75, responseQuality: 'good' },
    ])
    const openai = makeProvider('openai', [
      { model: 'gpt-4o-mini', tier: 'cheap', inputCost: 0.15, outputCost: 0.6, responseQuality: 'bad' },
      { model: 'gpt-4o', tier: 'standard', inputCost: 2.5, outputCost: 10, responseQuality: 'good' },
    ])

    const router = new CascadeRouter({ providers: [anthropic, openai], maxEscalations: 5 })
    const ladder = router.getLadder()

    // Verify cross-provider ordering
    expect(ladder.rungs[0]!.model.model).toBe('gpt-4o-mini') // Cheapest
    expect(ladder.rungs[0]!.provider.name).toBe('openai')

    const result = await router.route(makeRequest())

    // Should skip the two cheap models (both bad) and land on a standard tier
    expect(['sonnet', 'gpt-4o']).toContain(result.model.model)
    expect(result.escalations).toBeGreaterThanOrEqual(1)
    expect(result.trace.length).toBeGreaterThanOrEqual(2)
  })
})

describe('CascadeRouter: Direct routing', () => {
  it('returns cheapest model by default', () => {
    const provider = makeProvider('test', [
      { model: 'cheap', tier: 'cheap', inputCost: 0.1, outputCost: 0.3 },
      { model: 'expensive', tier: 'premium', inputCost: 15, outputCost: 75 },
    ])

    const router = new CascadeRouter({ providers: [provider] })
    const rung = router.routeDirect()

    expect(rung?.model.model).toBe('cheap')
  })
})
