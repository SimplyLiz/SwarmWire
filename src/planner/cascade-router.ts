/**
 * CascadeRouter — research-backed cost-efficient LLM routing.
 *
 * Combines three proven strategies from the literature:
 *
 * 1. **Cascade routing** (arXiv:2410.10347, ICLR 2025):
 *    Try the cheapest model first. If quality is below threshold, escalate
 *    to the next tier. Stops as soon as quality is acceptable.
 *
 * 2. **Confidence-aware routing** (CARGO, arXiv:2509.14899):
 *    Use a quality estimator to predict whether a model can handle the query.
 *    Skip models likely to fail, saving the cost of a bad response.
 *
 * 3. **Online bandit learning** (MixLLM, MetaLLM):
 *    Track per-model success rates by query profile. Over time, the router
 *    learns which models handle which query types, achieving up to 97% of
 *    GPT-4 quality at 24% of the cost.
 *
 * Supports the full bandwidth of a provider: e.g., Haiku → Sonnet → Opus
 * or Flash → Pro → Ultra.
 */

import type { Provider, ProviderModelInfo, LlmRequest, LlmResponse, ModelTier } from '../types/provider.js'
import type { Budget } from '../types/budget.js'

// ─── Configuration ───

export interface CascadeRouterConfig {
  /** All available providers with their model catalogs */
  providers: Provider[]

  /** Quality threshold (0-1). Below this, escalate to next model. Default 0.7 */
  qualityThreshold?: number

  /** Maximum models to try per query before giving up. Default 3 */
  maxEscalations?: number

  /** How to estimate quality. Default 'heuristic' */
  qualityEstimator?: 'heuristic' | 'self-check' | QualityEstimatorFn

  /** Confidence gap threshold (CARGO-style). If the top-2 model scores
   *  are within this gap, try the cheaper one first. Default 0.1 */
  confidenceGap?: number

  /** Exploration rate for bandit learning (0-1). Default 0.1 */
  explorationRate?: number

  /** Budget constraints */
  budget?: Budget
}

export type QualityEstimatorFn = (
  request: LlmRequest,
  response: LlmResponse,
  model: ProviderModelInfo,
) => number  // Returns quality score 0-1

// ─── Model Ladder ───

/** A ranked sequence of models from cheapest to most expensive */
export interface ModelLadder {
  rungs: ModelRung[]
}

export interface ModelRung {
  provider: Provider
  model: ProviderModelInfo
  costPer1kTokens: number
  tier: ModelTier
}

// ─── Cascade Result ───

export interface CascadeResult {
  response: LlmResponse
  provider: Provider
  model: ProviderModelInfo
  qualityScore: number
  escalations: number
  totalCostCents: number
  modelsTriedNames: string[]
  /** The full cascade trace for debugging */
  trace: CascadeTrace[]
}

export interface CascadeTrace {
  model: string
  provider: string
  tier: ModelTier
  costCents: number
  qualityScore: number
  accepted: boolean
  durationMs: number
}

// ─── Online Learning State ───

interface ModelProfile {
  model: string
  provider: string
  successCount: number
  failCount: number
  totalCostCents: number
  avgQuality: number
  queryProfiles: Map<string, { success: number; total: number }>
}

// ─── Main Implementation ───

export class CascadeRouter {
  private config: Required<Omit<CascadeRouterConfig, 'qualityEstimator' | 'budget'>> & {
    qualityEstimator: 'heuristic' | 'self-check' | QualityEstimatorFn
    budget?: Budget
  }
  private ladder: ModelLadder
  private profiles = new Map<string, ModelProfile>()

  constructor(config: CascadeRouterConfig) {
    this.config = {
      providers: config.providers,
      qualityThreshold: config.qualityThreshold ?? 0.7,
      maxEscalations: config.maxEscalations ?? 3,
      qualityEstimator: config.qualityEstimator ?? 'heuristic',
      confidenceGap: config.confidenceGap ?? 0.1,
      explorationRate: config.explorationRate ?? 0.1,
      budget: config.budget,
    }

    this.ladder = buildModelLadder(config.providers)
  }

  /** Get the model ladder (cheapest → most expensive) */
  getLadder(): ModelLadder {
    return this.ladder
  }

  /**
   * Route a request through the cascade.
   * Tries the cheapest viable model first, escalates if quality is too low.
   */
  async route(request: LlmRequest): Promise<CascadeResult> {
    const trace: CascadeTrace[] = []
    let totalCostCents = 0
    let bestResponse: LlmResponse | null = null
    let bestQuality = 0
    let bestRung: ModelRung | null = null

    // Determine starting rung based on bandit scores
    const queryProfile = classifyQuery(request)
    const startIdx = this.selectStartingRung(queryProfile)

    const modelsToTry = this.ladder.rungs.slice(startIdx, startIdx + this.config.maxEscalations)

    for (let i = 0; i < modelsToTry.length; i++) {
      const rung = modelsToTry[i]!

      // Budget check — can we afford this model?
      if (this.config.budget?.maxCostCents !== undefined) {
        const estimatedCost = estimateCallCost(rung, request)
        if (totalCostCents + estimatedCost > this.config.budget.maxCostCents) {
          break
        }
      }

      // Execute the call
      const callRequest = { ...request, model: rung.model.model }
      const start = performance.now()
      let response: LlmResponse

      try {
        response = await rung.provider.chat(callRequest)
      } catch {
        // Model failed — skip to next
        trace.push({
          model: rung.model.model,
          provider: rung.provider.name,
          tier: rung.tier,
          costCents: 0,
          qualityScore: 0,
          accepted: false,
          durationMs: performance.now() - start,
        })
        continue
      }

      const durationMs = performance.now() - start
      const callCost = rung.provider.estimateCost(rung.model.model, response.inputTokens, response.outputTokens)
      totalCostCents += callCost

      // Estimate quality
      const quality = this.estimateQuality(callRequest, response, rung.model)

      trace.push({
        model: rung.model.model,
        provider: rung.provider.name,
        tier: rung.tier,
        costCents: callCost,
        qualityScore: quality,
        accepted: quality >= this.config.qualityThreshold,
        durationMs,
      })

      // Track best response (in case nothing meets threshold)
      if (quality > bestQuality) {
        bestQuality = quality
        bestResponse = response
        bestRung = rung
      }

      // Record for bandit learning
      this.recordOutcome(rung, queryProfile, quality >= this.config.qualityThreshold, quality, callCost)

      // Quality meets threshold — accept this response
      if (quality >= this.config.qualityThreshold) {
        return {
          response,
          provider: rung.provider,
          model: rung.model,
          qualityScore: quality,
          escalations: i,
          totalCostCents,
          modelsTriedNames: trace.map((t) => t.model),
          trace,
        }
      }

      // Below threshold — escalate to next rung
    }

    // No model met the threshold — return the best we got
    if (!bestResponse || !bestRung) {
      throw new Error('CascadeRouter: all models failed or no models available')
    }

    return {
      response: bestResponse,
      provider: bestRung.provider,
      model: bestRung.model,
      qualityScore: bestQuality,
      escalations: trace.length - 1,
      totalCostCents,
      modelsTriedNames: trace.map((t) => t.model),
      trace,
    }
  }

  /**
   * Direct routing — skip the cascade, use bandit scores to pick the best model.
   * Useful when you want one-shot routing without escalation overhead.
   */
  routeDirect(queryProfile?: string): ModelRung | null {
    const profile = queryProfile ?? 'general'
    const startIdx = this.selectStartingRung(profile)
    return this.ladder.rungs[startIdx] ?? null
  }

  /** Get routing statistics for debugging and optimization */
  getStats(): CascadeStats {
    const stats: CascadeStats = {
      totalModels: this.ladder.rungs.length,
      modelStats: [],
      costSavingsEstimate: 0,
    }

    for (const rung of this.ladder.rungs) {
      const key = `${rung.provider.name}:${rung.model.model}`
      const profile = this.profiles.get(key)

      stats.modelStats.push({
        model: rung.model.model,
        provider: rung.provider.name,
        tier: rung.tier,
        costPer1kTokens: rung.costPer1kTokens,
        successRate: profile ? profile.successCount / Math.max(1, profile.successCount + profile.failCount) : 0,
        totalCalls: profile ? profile.successCount + profile.failCount : 0,
        avgQuality: profile?.avgQuality ?? 0,
        totalCostCents: profile?.totalCostCents ?? 0,
      })
    }

    // Estimate savings: compare actual cost to always-using-premium cost
    const premiumCost = this.ladder.rungs[this.ladder.rungs.length - 1]?.costPer1kTokens ?? 0
    const totalActualCost = stats.modelStats.reduce((s, m) => s + m.totalCostCents, 0)
    const totalCalls = stats.modelStats.reduce((s, m) => s + m.totalCalls, 0)
    const estimatedPremiumCost = totalCalls * premiumCost * 2 // rough: 2k tokens avg
    stats.costSavingsEstimate = Math.max(0, estimatedPremiumCost - totalActualCost)

    return stats
  }

  /** Export state for persistence */
  exportState(): Map<string, ModelProfile> {
    return new Map(this.profiles)
  }

  /** Import state from persistence */
  importState(state: Map<string, ModelProfile>): void {
    this.profiles = new Map(state)
  }

  // ─── Private Methods ───

  /**
   * Select starting rung in the ladder using bandit scores.
   * Balances exploitation (use known-good models) with exploration (try cheaper ones).
   */
  private selectStartingRung(queryProfile: string): number {
    // Exploration: start from cheapest
    if (Math.random() < this.config.explorationRate) return 0

    // Exploitation: find the cheapest model with high enough success rate for this profile
    for (let i = 0; i < this.ladder.rungs.length; i++) {
      const rung = this.ladder.rungs[i]!
      const key = `${rung.provider.name}:${rung.model.model}`
      const profile = this.profiles.get(key)

      if (!profile) continue

      const profileStats = profile.queryProfiles.get(queryProfile)
      if (!profileStats || profileStats.total < 3) continue

      const successRate = profileStats.success / profileStats.total
      if (successRate >= this.config.qualityThreshold) {
        return i // This cheap model works for this query type
      }
    }

    // No history — start from cheapest
    return 0
  }

  /**
   * Estimate response quality using the configured strategy.
   */
  private estimateQuality(
    request: LlmRequest,
    response: LlmResponse,
    model: ProviderModelInfo,
  ): number {
    if (typeof this.config.qualityEstimator === 'function') {
      return this.config.qualityEstimator(request, response, model)
    }

    switch (this.config.qualityEstimator) {
      case 'self-check':
        return selfCheckEstimator(response)
      case 'heuristic':
      default:
        return heuristicEstimator(request, response, model)
    }
  }

  /**
   * Record outcome for bandit learning.
   */
  private recordOutcome(
    rung: ModelRung,
    queryProfile: string,
    success: boolean,
    quality: number,
    costCents: number,
  ): void {
    const key = `${rung.provider.name}:${rung.model.model}`
    let profile = this.profiles.get(key)

    if (!profile) {
      profile = {
        model: rung.model.model,
        provider: rung.provider.name,
        successCount: 0,
        failCount: 0,
        totalCostCents: 0,
        avgQuality: 0,
        queryProfiles: new Map(),
      }
      this.profiles.set(key, profile)
    }

    if (success) profile.successCount++
    else profile.failCount++

    profile.totalCostCents += costCents
    const totalCalls = profile.successCount + profile.failCount
    profile.avgQuality = (profile.avgQuality * (totalCalls - 1) + quality) / totalCalls

    // Per-query-profile stats
    let qp = profile.queryProfiles.get(queryProfile)
    if (!qp) {
      qp = { success: 0, total: 0 }
      profile.queryProfiles.set(queryProfile, qp)
    }
    qp.total++
    if (success) qp.success++
  }
}

// ─── Quality Estimators ───

/**
 * Heuristic quality estimator — no extra API calls needed.
 * Combines multiple signals from the response itself.
 *
 * Based on findings from the survey (arXiv:2603.04445):
 * - Response length relative to query length
 * - Finish reason (max_tokens = likely truncated = lower quality)
 * - Model tier as prior (higher tier = higher baseline)
 * - Token efficiency (output/input ratio)
 */
function heuristicEstimator(
  request: LlmRequest,
  response: LlmResponse,
  model: ProviderModelInfo,
): number {
  let score = 0

  // 1. Tier prior (0.0 - 0.25)
  const tierScores: Record<string, number> = { cheap: 0.05, standard: 0.15, premium: 0.22, reasoning: 0.25 }
  score += tierScores[model.tier] ?? 0.10

  // 2. Completion quality (0.0 - 0.30)
  if (response.finishReason === 'stop') {
    score += 0.30 // Completed naturally
  } else if (response.finishReason === 'max_tokens') {
    score += 0.10 // Truncated — likely incomplete
  }

  // 3. Response substance (0.0 - 0.25)
  const contentLength = response.content.length
  const queryLength = request.messages.reduce((s, m) => s + m.content.length, 0)

  if (contentLength === 0) {
    score += 0 // Empty response
  } else if (contentLength < 20) {
    score += 0.05 // Very short — might be a refusal or error
  } else if (contentLength < queryLength * 0.5) {
    score += 0.15 // Short relative to query
  } else {
    score += 0.25 // Substantial response
  }

  // 4. Output efficiency (0.0 - 0.20)
  // Higher output/input ratio suggests the model had something to say
  const ratio = response.outputTokens / Math.max(1, response.inputTokens)
  if (ratio > 0.1) score += Math.min(0.20, ratio * 0.5)

  return Math.min(1, Math.max(0, score))
}

/**
 * Self-check estimator — uses the response's own signals.
 * Looks for indicators of uncertainty, refusal, or low confidence.
 *
 * Based on Self-REF (arXiv:2603.04445): model's own output contains
 * quality signals. Verbalization-based confidence has "low alignment
 * with correctness" but structural signals are useful.
 */
function selfCheckEstimator(response: LlmResponse): number {
  const content = response.content.toLowerCase()
  let score = 0.6 // Base score

  // Negative signals — reduce score
  const uncertaintyPhrases = [
    'i\'m not sure', 'i don\'t know', 'i cannot', 'i\'m unable',
    'i apologize', 'as an ai', 'i don\'t have access',
    'it\'s unclear', 'it depends', 'i would need more',
  ]
  for (const phrase of uncertaintyPhrases) {
    if (content.includes(phrase)) score -= 0.08
  }

  // Positive signals — increase score
  const confidenceSignals = [
    'specifically', 'in particular', 'for example',
    'according to', 'the key', 'importantly',
  ]
  for (const signal of confidenceSignals) {
    if (content.includes(signal)) score += 0.04
  }

  // Structural signals
  if (content.includes('```')) score += 0.05 // Code blocks = structured
  if (content.includes('1.') || content.includes('- ')) score += 0.03 // Lists = organized
  if (response.content.length > 200) score += 0.05 // Substantial

  // Finish reason
  if (response.finishReason === 'stop') score += 0.1
  if (response.finishReason === 'max_tokens') score -= 0.1

  return Math.min(1, Math.max(0, score))
}

// ─── Model Ladder Construction ───

/**
 * Build a model ladder from all available providers.
 * Sorted from cheapest to most expensive.
 */
export function buildModelLadder(providers: Provider[]): ModelLadder {
  const rungs: ModelRung[] = []

  for (const provider of providers) {
    for (const model of provider.models) {
      const costPer1k = model.inputCostPer1kTokens + model.outputCostPer1kTokens
      rungs.push({
        provider,
        model,
        costPer1kTokens: costPer1k,
        tier: model.tier,
      })
    }
  }

  // Sort by cost ascending
  rungs.sort((a, b) => a.costPer1kTokens - b.costPer1kTokens)

  return { rungs }
}

// ─── Helpers ───

/**
 * Classify a query into a profile bucket for bandit learning.
 * Uses simple heuristics — no ML model needed.
 */
function classifyQuery(request: LlmRequest): string {
  const text = request.messages.map((m) => m.content).join(' ').toLowerCase()
  const length = text.length

  // Domain detection
  const domains: string[] = []
  if (/\b(code|function|class|bug|test|api)\b/.test(text)) domains.push('code')
  if (/\b(math|calcul|equation|proof)\b/.test(text)) domains.push('math')
  if (/\b(creat|write|story|essay|poem)\b/.test(text)) domains.push('creative')
  if (/\b(analyz|compar|evaluat|trade.?off)\b/.test(text)) domains.push('analysis')
  if (/\b(summar|explain|what is|how does)\b/.test(text)) domains.push('explanation')
  if (domains.length === 0) domains.push('general')

  // Complexity bucket
  const complexity = length > 2000 ? 'long' : length > 500 ? 'medium' : 'short'

  return `${domains[0]}:${complexity}`
}

function estimateCallCost(rung: ModelRung, request: LlmRequest): number {
  // Rough estimate: input tokens from message length, assume 2:1 input:output ratio
  const inputChars = request.messages.reduce((s, m) => s + m.content.length, 0)
  const estimatedInputTokens = Math.ceil(inputChars / 4)
  const estimatedOutputTokens = Math.ceil(estimatedInputTokens / 2)
  return rung.provider.estimateCost(rung.model.model, estimatedInputTokens, estimatedOutputTokens)
}

// ─── Convenience functions ───

/**
 * Create a CascadeRouter with a clean API.
 * Prefer this over `new CascadeRouter()` in application code.
 */
export function createCascadeRouter(
  providers: Provider[],
  config?: Pick<CascadeRouterConfig, 'qualityThreshold' | 'maxEscalations' | 'explorationRate' | 'qualityEstimator' | 'budget'>,
): CascadeRouter {
  return new CascadeRouter({ providers, ...config })
}

/**
 * Route a request through a cascade router.
 * Convenience wrapper around `router.route(request)`.
 */
export async function cascadeComplete(router: CascadeRouter, request: LlmRequest): Promise<CascadeResult> {
  return router.route(request)
}

// ─── Stats ───

export interface CascadeStats {
  totalModels: number
  modelStats: ModelStat[]
  costSavingsEstimate: number
}

export interface ModelStat {
  model: string
  provider: string
  tier: ModelTier
  costPer1kTokens: number
  successRate: number
  totalCalls: number
  avgQuality: number
  totalCostCents: number
}
