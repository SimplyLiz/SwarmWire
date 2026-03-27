/**
 * Google Gemini provider adapter.
 * Uses the OpenAI-compatible API endpoint that Gemini exposes.
 */

import type { Provider, ProviderConfig, ProviderModelInfo, LlmRequest, LlmResponse, ModelTier } from '../types/provider.js'
import { createOpenAIProvider } from './openai.js'

const GEMINI_MODELS: ProviderModelInfo[] = [
  {
    model: 'gemini-2.0-flash',
    tier: 'cheap' as ModelTier,
    inputCostPer1kTokens: 0.10,
    outputCostPer1kTokens: 0.40,
    contextWindow: 1_000_000,
  },
  {
    model: 'gemini-2.5-pro',
    tier: 'standard' as ModelTier,
    inputCostPer1kTokens: 1.25,
    outputCostPer1kTokens: 10.00,
    contextWindow: 1_000_000,
  },
  {
    model: 'gemini-2.5-flash',
    tier: 'cheap' as ModelTier,
    inputCostPer1kTokens: 0.15,
    outputCostPer1kTokens: 0.60,
    cachedInputCostPer1kTokens: 0.0375,
    contextWindow: 1_000_000,
  },
]

/**
 * Create a Gemini provider using Google's OpenAI-compatible endpoint.
 */
export function createGeminiProvider(config: ProviderConfig): Provider {
  const baseUrl = config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta/openai'

  const openaiProvider = createOpenAIProvider({
    ...config,
    name: 'gemini',
    baseUrl,
    models: config.models ?? GEMINI_MODELS,
  })

  return {
    ...openaiProvider,
    name: 'gemini',
    models: config.models ?? GEMINI_MODELS,
  }
}
