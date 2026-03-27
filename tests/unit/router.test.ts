import { describe, it, expect } from 'vitest'
import { routeModel, matchAgent } from '../../src/planner/router.js'
import { createAgent } from '../../src/core/agent-factory.js'
import type { Provider, ProviderModelInfo } from '../../src/types/provider.js'
import type { TaskScore } from '../../src/types/task.js'

function makeProvider(name: string, models: ProviderModelInfo[]): Provider {
  return {
    name,
    models,
    chat: async () => ({ content: '', model: '', inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, finishReason: 'stop', durationMs: 0 }),
    estimateCost: () => 0,
  }
}

function makeScore(tier: 'cheap' | 'standard' | 'premium' | 'reasoning'): TaskScore {
  return {
    difficulty: 'medium',
    risk: 'low',
    domain: ['general'],
    freshnessNeed: 'relaxed',
    recommendedMode: 'deep',
    estimatedAgents: 1,
    estimatedTokens: 5000,
    modelTier: tier,
    factors: { inputComplexity: 0.3, domainSpecificity: 0.2, reasoningDepth: 0.3, outputStructure: 0.2, contextRequired: 0.2 },
  }
}

describe('Router', () => {
  it('selects cheapest model at target tier', () => {
    const provider = makeProvider('test', [
      { model: 'expensive', tier: 'standard', inputCostPer1kTokens: 10, outputCostPer1kTokens: 30, contextWindow: 128000 },
      { model: 'cheap', tier: 'standard', inputCostPer1kTokens: 2, outputCostPer1kTokens: 8, contextWindow: 128000 },
    ])

    const result = routeModel(makeScore('standard'), [provider])
    expect(result?.model).toBe('cheap')
  })

  it('falls back to higher tier if target unavailable', () => {
    const provider = makeProvider('test', [
      { model: 'premium-model', tier: 'premium', inputCostPer1kTokens: 15, outputCostPer1kTokens: 75, contextWindow: 200000 },
    ])

    const result = routeModel(makeScore('standard'), [provider])
    expect(result?.model).toBe('premium-model')
  })

  it('respects model preferences', () => {
    const provider = makeProvider('test', [
      { model: 'model-a', tier: 'standard', inputCostPer1kTokens: 2, outputCostPer1kTokens: 8, contextWindow: 128000 },
      { model: 'model-b', tier: 'standard', inputCostPer1kTokens: 3, outputCostPer1kTokens: 12, contextWindow: 128000 },
    ])

    const result = routeModel(makeScore('standard'), [provider], {
      modelPreferences: [{ tier: 'standard', models: ['model-b'] }],
    })
    expect(result?.model).toBe('model-b')
  })

  it('returns null for empty providers', () => {
    const result = routeModel(makeScore('standard'), [])
    expect(result).toBeNull()
  })
})

describe('matchAgent', () => {
  it('matches agent with most capability overlap', () => {
    const agents = [
      createAgent({ name: 'a', role: 'a', capabilities: ['code', 'review'] }),
      createAgent({ name: 'b', role: 'b', capabilities: ['research', 'web'] }),
      createAgent({ name: 'c', role: 'c', capabilities: ['code', 'test', 'review'] }),
    ]

    const result = matchAgent(['code', 'review', 'test'], agents)
    expect(result?.name).toBe('c')
  })

  it('returns first agent when no capabilities required', () => {
    const agents = [createAgent({ name: 'a', role: 'a' })]
    const result = matchAgent([], agents)
    expect(result?.name).toBe('a')
  })
})
