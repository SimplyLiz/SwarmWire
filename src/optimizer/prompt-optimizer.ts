/**
 * Prompt Optimizer — DSPy-style prompt improvement using training pairs.
 * Uses DistillationCollector for few-shot examples and iterative candidate scoring.
 */

import type { Provider, ModelConfig } from '../types/provider.js'
import type { DistillationCollector } from '../orchestrator/distillation.js'

export type OptimizationMetric = (prompt: string, response: string, expected?: unknown) => number

export interface FewShotExample {
  input: string
  output: string
  quality: number
}

export interface PromptCandidate {
  prompt: string
  score: number
  fewShotExamples: FewShotExample[]
}

export interface OptimizationResult {
  originalPrompt: string
  optimizedPrompt: string
  fewShotExamples: FewShotExample[]
  scoreImprovement: number
  iterations: number
}

export interface PromptOptimizerConfig {
  collector: DistillationCollector
  provider: Provider
  model: ModelConfig
  /** Number of prompt variants per iteration. Default 4 */
  numCandidates?: number
  /** Number of few-shot examples to include. Default 3 */
  numFewShot?: number
  /** Max optimization iterations. Default 3 */
  maxIterations?: number
  /** Min quality score to use as example. Default 0.7 */
  minExampleQuality?: number
}

export class PromptOptimizer {
  private readonly config: PromptOptimizerConfig

  constructor(config: PromptOptimizerConfig) {
    this.config = config
  }

  async optimize(
    agentId: string,
    basePrompt: string,
    metric: OptimizationMetric,
  ): Promise<OptimizationResult> {
    const {
      numCandidates = 4,
      maxIterations = 3,
    } = this.config

    const fewShot = this.bootstrapFewShot(agentId)
    let currentPrompt = basePrompt
    let bestScore = await this.scorePrompt(currentPrompt, agentId, metric)
    let iterations = 0

    for (let i = 0; i < maxIterations; i++) {
      const candidates = await this.generateCandidates(currentPrompt, fewShot, numCandidates)
      const scored = await this.scoreCandidates(candidates, agentId, metric)
      const best = scored.sort((a, b) => b.score - a.score)[0]
      if (best && best.score > bestScore) {
        bestScore = best.score
        currentPrompt = best.prompt
      }
      iterations++
    }

    const originalScore = await this.scorePrompt(basePrompt, agentId, metric)

    return {
      originalPrompt: basePrompt,
      optimizedPrompt: currentPrompt,
      fewShotExamples: fewShot,
      scoreImprovement: bestScore - originalScore,
      iterations,
    }
  }

  private bootstrapFewShot(_agentId: string): FewShotExample[] {
    const { numFewShot = 3, minExampleQuality = 0.7 } = this.config
    const pairs = this.config.collector.getPairsForDistillation()
    const filtered = pairs.filter((p) => p.quality >= minExampleQuality)
    filtered.sort((a, b) => b.quality - a.quality)
    return filtered.slice(0, numFewShot).map((p) => ({
      input: p.prompt,
      output: p.response,
      quality: p.quality,
    }))
  }

  private async generateCandidates(
    basePrompt: string,
    examples: FewShotExample[],
    n: number,
  ): Promise<string[]> {
    const examplesText = examples
      .map((e, i) => `Example ${i + 1}:\nInput: ${e.input}\nOutput: ${e.output}`)
      .join('\n\n')

    const metaPrompt = `You are a prompt engineer. Here is the current prompt:\n${basePrompt}\n\nHere are ${examples.length} successful examples:\n${examplesText}\n\nGenerate ${n} improved prompt variants that would produce similar high-quality outputs. Return one prompt per line, separated by "---".`

    try {
      const response = await this.config.provider.chat({
        messages: [{ role: 'user', content: metaPrompt }],
        model: this.config.model.model,
        maxTokens: 2000,
      })
      const text = response.content
      return text.split('---').map((s) => s.trim()).filter(Boolean).slice(0, n)
    } catch {
      return [basePrompt]
    }
  }

  private async scoreCandidates(
    candidates: string[],
    _agentId: string,
    metric: OptimizationMetric,
  ): Promise<PromptCandidate[]> {
    const results: PromptCandidate[] = []
    for (const prompt of candidates) {
      const score = await this.scorePrompt(prompt, '', metric)
      results.push({ prompt, score, fewShotExamples: [] })
    }
    return results
  }

  private async scorePrompt(prompt: string, _agentId: string, metric: OptimizationMetric): Promise<number> {
    const pairs = this.config.collector.getPairsForDistillation()
    if (pairs.length === 0) return 0.5

    const scores: number[] = []
    for (const pair of pairs.slice(0, 5)) {
      try {
        const response = await this.config.provider.chat({
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: pair.prompt },
          ],
          model: this.config.model.model,
          maxTokens: 500,
        })
        scores.push(metric(pair.prompt, response.content, pair.response))
      } catch {
        scores.push(0)
      }
    }

    return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
  }
}
