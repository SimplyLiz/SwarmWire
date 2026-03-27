/**
 * Model Cascade on Quality Failure — per-agent model fallback.
 * Different from circuit breaker (provider-level). This is agent-level:
 * "this specific task needs a smarter model."
 */

import type { Provider, LlmRequest, LlmResponse, ModelConfig } from '../types/provider.js'
import type { QualityEstimatorFn } from '../planner/cascade-router.js'

export interface FallbackModel {
  provider: string
  model: string
  /** When to escalate to this model */
  condition: 'error' | 'quality' | 'both'
}

export interface ModelCascadeConfig {
  /** Primary model config */
  primary: ModelConfig
  /** Fallback models in priority order */
  fallbacks: FallbackModel[]
  /** Quality threshold for escalation. Default 0.6 */
  qualityThreshold?: number
  /** Quality estimator function */
  qualityEstimator?: QualityEstimatorFn
}

export interface ModelCascadeResult {
  response: LlmResponse
  modelUsed: string
  providerUsed: string
  escalated: boolean
  escalationReason?: string
  modelsAttempted: string[]
}

/**
 * Execute an LLM request with automatic model cascade on failure.
 */
export async function chatWithCascade(
  request: LlmRequest,
  config: ModelCascadeConfig,
  providers: Map<string, Provider>,
): Promise<ModelCascadeResult> {
  const threshold = config.qualityThreshold ?? 0.6
  const modelsAttempted: string[] = []

  // Try primary model first
  const primaryProvider = providers.get(config.primary.provider)
  if (primaryProvider) {
    modelsAttempted.push(config.primary.model)
    try {
      const response = await primaryProvider.chat({ ...request, model: config.primary.model })

      // Check quality if estimator provided
      if (config.qualityEstimator) {
        const modelInfo = primaryProvider.models.find((m) => m.model === config.primary.model)
        if (modelInfo) {
          const quality = config.qualityEstimator(request, response, modelInfo)
          if (quality >= threshold) {
            return { response, modelUsed: config.primary.model, providerUsed: config.primary.provider, escalated: false, modelsAttempted }
          }
          // Quality too low — fall through to fallbacks
        }
      } else {
        return { response, modelUsed: config.primary.model, providerUsed: config.primary.provider, escalated: false, modelsAttempted }
      }
    } catch {
      // Primary failed — try fallbacks
    }
  }

  // Try fallback models
  for (const fallback of config.fallbacks) {
    const provider = providers.get(fallback.provider)
    if (!provider) continue

    modelsAttempted.push(fallback.model)
    try {
      const response = await provider.chat({ ...request, model: fallback.model })

      if (fallback.condition === 'quality' && config.qualityEstimator) {
        const modelInfo = provider.models.find((m) => m.model === fallback.model)
        if (modelInfo) {
          const quality = config.qualityEstimator(request, response, modelInfo)
          if (quality < threshold) continue // This fallback also too low quality
        }
      }

      return {
        response,
        modelUsed: fallback.model,
        providerUsed: fallback.provider,
        escalated: true,
        escalationReason: `Primary model ${config.primary.model} failed or produced low quality`,
        modelsAttempted,
      }
    } catch {
      // This fallback also failed — continue to next
    }
  }

  throw new Error(`Model cascade exhausted: all ${modelsAttempted.length} models failed (${modelsAttempted.join(', ')})`)
}
