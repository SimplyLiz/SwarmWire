export { createAnthropicProvider } from './anthropic.js'
export { createOpenAIProvider } from './openai.js'
export { createGeminiProvider } from './gemini.js'
export { createOllamaProvider } from './ollama.js'
export { withCircuitBreaker, withFailover, CircuitOpenError } from './circuit-breaker.js'
export type { CircuitBreakerConfig } from './circuit-breaker.js'

import type { Provider, ProviderConfig } from '../types/provider.js'
import { createAnthropicProvider } from './anthropic.js'
import { createOpenAIProvider } from './openai.js'
import { createGeminiProvider } from './gemini.js'
import { createOllamaProvider } from './ollama.js'

export function createProvider(name: string, config: Omit<ProviderConfig, 'name'>): Provider {
  const fullConfig: ProviderConfig = { ...config, name }
  switch (name) {
    case 'anthropic':
      return createAnthropicProvider(fullConfig)
    case 'openai':
      return createOpenAIProvider(fullConfig)
    case 'gemini':
    case 'google':
      return createGeminiProvider(fullConfig)
    case 'ollama':
      return createOllamaProvider(fullConfig)
    default:
      // Generic OpenAI-compatible provider (works with LiteLLM, vLLM, etc.)
      return createOpenAIProvider(fullConfig)
  }
}
