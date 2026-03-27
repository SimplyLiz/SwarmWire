/**
 * Speculative Cascade — parallel model execution for latency optimization.
 *
 * Based on "Faster Cascades via Speculative Decoding" (arXiv:2405.19261):
 * Instead of trying models sequentially (slow), run cheap + mid models in
 * parallel. Accept the cheap one if quality is good enough, otherwise use
 * the mid one that's already running.
 *
 * Trade-off: uses more tokens (both models run) but cuts latency in half
 * for queries that need escalation. Cheap queries cost the same as
 * sequential cascade (mid result is discarded).
 */

import type { Provider, LlmRequest, LlmResponse, ProviderModelInfo } from '../types/provider.js'
import type { ModelLadder, CascadeTrace, QualityEstimatorFn } from './cascade-router.js'

export interface SpeculativeCascadeConfig {
  /** The model ladder (cheapest → most expensive) */
  ladder: ModelLadder
  /** How many parallel models to run. Default 2 */
  parallelWidth?: number
  /** Quality threshold. Default 0.7 */
  qualityThreshold?: number
  /** Quality estimator function */
  qualityEstimator?: QualityEstimatorFn
}

export interface SpeculativeResult {
  response: LlmResponse
  provider: Provider
  model: ProviderModelInfo
  qualityScore: number
  /** Which parallel slot won (0 = cheapest) */
  winnerSlot: number
  /** Total cost (includes wasted parallel work) */
  totalCostCents: number
  /** Cost if we had done sequential cascade instead */
  sequentialCostCents: number
  /** Latency savings vs sequential (ms) */
  latencySavedMs: number
  trace: CascadeTrace[]
}

/**
 * Run models in parallel, accept cheapest that meets quality threshold.
 */
export async function speculativeCascade(
  request: LlmRequest,
  config: SpeculativeCascadeConfig,
): Promise<SpeculativeResult> {
  const { ladder, parallelWidth = 2, qualityThreshold = 0.7 } = config
  const estimator = config.qualityEstimator ?? defaultEstimator

  const rungs = ladder.rungs.slice(0, parallelWidth)
  if (rungs.length === 0) throw new Error('speculativeCascade: no models in ladder')

  // Launch all models in parallel
  const startTime = performance.now()
  const promises = rungs.map(async (rung) => {
    const callReq = { ...request, model: rung.model.model }
    const callStart = performance.now()
    try {
      const response = await rung.provider.chat(callReq)
      const durationMs = performance.now() - callStart
      const costCents = rung.provider.estimateCost(rung.model.model, response.inputTokens, response.outputTokens)
      const quality = estimator(callReq, response, rung.model)
      return { rung, response, quality, costCents, durationMs, error: null }
    } catch (err) {
      return { rung, response: null, quality: 0, costCents: 0, durationMs: performance.now() - callStart, error: err }
    }
  })

  const results = await Promise.all(promises)
  const totalDuration = performance.now() - startTime

  // Build trace
  const trace: CascadeTrace[] = results.map((r) => ({
    model: r.rung.model.model,
    provider: r.rung.provider.name,
    tier: r.rung.tier,
    costCents: r.costCents,
    qualityScore: r.quality,
    accepted: false,
    durationMs: r.durationMs,
  }))

  // Find cheapest acceptable result
  let winner: typeof results[number] | null = null
  let winnerSlot = -1

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!
    if (r.response && r.quality >= qualityThreshold) {
      winner = r
      winnerSlot = i
      trace[i]!.accepted = true
      break // Accept cheapest that passes
    }
  }

  // If no model met threshold, pick the highest quality
  if (!winner) {
    let bestQuality = -1
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!
      if (r.response && r.quality > bestQuality) {
        bestQuality = r.quality
        winner = r
        winnerSlot = i
      }
    }
    if (winner) trace[winnerSlot]!.accepted = true
  }

  if (!winner || !winner.response) {
    throw new Error('speculativeCascade: all models failed')
  }

  const totalCostCents = results.reduce((s, r) => s + r.costCents, 0)

  // Estimate what sequential cascade would have cost
  let sequentialCostCents = 0
  let sequentialDurationMs = 0
  for (let i = 0; i <= winnerSlot; i++) {
    const r = results[i]!
    sequentialCostCents += r.costCents
    sequentialDurationMs += r.durationMs
  }

  return {
    response: winner.response,
    provider: winner.rung.provider,
    model: winner.rung.model,
    qualityScore: winner.quality,
    winnerSlot,
    totalCostCents,
    sequentialCostCents,
    latencySavedMs: Math.max(0, sequentialDurationMs - totalDuration),
    trace,
  }
}

function defaultEstimator(_req: LlmRequest, response: LlmResponse, model: ProviderModelInfo): number {
  let score = 0
  const tierScores: Record<string, number> = { cheap: 0.05, standard: 0.15, premium: 0.22, reasoning: 0.25 }
  score += tierScores[model.tier] ?? 0.10
  if (response.finishReason === 'stop') score += 0.30
  else if (response.finishReason === 'max_tokens') score += 0.10
  if (response.content.length > 50) score += 0.25
  else if (response.content.length > 10) score += 0.15
  const ratio = response.outputTokens / Math.max(1, response.inputTokens)
  if (ratio > 0.1) score += Math.min(0.20, ratio * 0.5)
  return Math.min(1, Math.max(0, score))
}
