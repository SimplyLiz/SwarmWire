/**
 * Ollama provider adapter — local LLM execution.
 * Uses Ollama's OpenAI-compatible API.
 */

import type { Provider, ProviderConfig, ProviderModelInfo, LlmRequest, LlmResponse, ModelTier } from '../types/provider.js'
import { createOpenAIProvider } from './openai.js'

const OLLAMA_DEFAULTS: ProviderModelInfo[] = [
  {
    model: 'llama3.3',
    tier: 'standard' as ModelTier,
    inputCostPer1kTokens: 0,
    outputCostPer1kTokens: 0,
    contextWindow: 128_000,
  },
  {
    model: 'qwen3',
    tier: 'cheap' as ModelTier,
    inputCostPer1kTokens: 0,
    outputCostPer1kTokens: 0,
    contextWindow: 128_000,
  },
  {
    model: 'deepseek-r1',
    tier: 'reasoning' as ModelTier,
    inputCostPer1kTokens: 0,
    outputCostPer1kTokens: 0,
    contextWindow: 128_000,
  },
]

/**
 * Create an Ollama provider for local LLM execution.
 * Cost is always $0 since models run locally.
 */
export function createOllamaProvider(config?: Partial<ProviderConfig>): Provider {
  const baseUrl = config?.baseUrl ?? 'http://localhost:11434/v1'

  const openaiProvider = createOpenAIProvider({
    name: 'ollama',
    baseUrl,
    models: config?.models ?? OLLAMA_DEFAULTS,
    ...config,
  })

  return {
    ...openaiProvider,
    name: 'ollama',
    models: config?.models ?? OLLAMA_DEFAULTS,
    estimateCost: () => 0, // Local execution is free
  }
}
