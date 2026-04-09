import { describe, it, expect, vi } from 'vitest'
import { PromptOptimizer } from '../../src/optimizer/prompt-optimizer.js'
import { DistillationCollector } from '../../src/orchestrator/distillation.js'
import type { Provider, ModelConfig } from '../../src/types/provider.js'

function makeProvider(response = 'improved prompt---variant 2---variant 3'): Provider {
  return {
    name: 'mock',
    models: [],
    complete: vi.fn().mockResolvedValue({ content: response, inputTokens: 10, outputTokens: 20, cachedInputTokens: 0 }),
    countTokens: vi.fn().mockResolvedValue(10),
  }
}

const model: ModelConfig = { name: 'mock-model', provider: 'mock', tier: 'standard' }

describe('PromptOptimizer', () => {
  it('returns an OptimizationResult with originalPrompt preserved', async () => {
    const collector = new DistillationCollector()
    const provider = makeProvider()
    const optimizer = new PromptOptimizer({ collector, provider, model })

    const result = await optimizer.optimize('agent1', 'You are helpful.', (prompt, response) => {
      return response.length > 0 ? 1 : 0
    })

    expect(result.originalPrompt).toBe('You are helpful.')
    expect(result.iterations).toBeGreaterThan(0)
  })

  it('uses few-shot examples from collector when available', async () => {
    const collector = new DistillationCollector()
    // Add a high-quality training pair
    collector.collectTrainingPair(
      'What is 2+2?',
      { agentId: 'a1', agentName: 'a1', status: 'completed', output: '4', cost: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2, costCents: 0.001, calls: 1 }, durationMs: 10 },
      'agent1',
      'math',
      0.95,
    )

    const provider = makeProvider()
    const optimizer = new PromptOptimizer({ collector, provider, model, numFewShot: 1 })

    const result = await optimizer.optimize('agent1', 'Base prompt', () => 0.8)
    expect(result.fewShotExamples).toHaveLength(1)
    expect(result.fewShotExamples[0]!.input).toBe('What is 2+2?')
  })

  it('respects minExampleQuality filter', async () => {
    const collector = new DistillationCollector()
    collector.collectTrainingPair(
      'low quality',
      { agentId: 'a1', agentName: 'a1', status: 'completed', output: 'meh', cost: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2, costCents: 0.001, calls: 1 }, durationMs: 10 },
      'agent1', 'x', 0.3,
    )

    const provider = makeProvider()
    const optimizer = new PromptOptimizer({ collector, provider, model, minExampleQuality: 0.7 })
    const result = await optimizer.optimize('agent1', 'Base', () => 0.5)
    expect(result.fewShotExamples).toHaveLength(0)
  })
})
