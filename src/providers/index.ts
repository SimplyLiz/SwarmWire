export { createAnthropicProvider } from './anthropic.js'
export { createOpenAIProvider } from './openai.js'
export { withCircuitBreaker, withFailover, CircuitOpenError } from './circuit-breaker.js'
export type { CircuitBreakerConfig } from './circuit-breaker.js'

import type { Provider, ProviderConfig } from '../types/provider.js'
import { createAnthropicProvider } from './anthropic.js'
import { createOpenAIProvider } from './openai.js'

export function createProvider(name: string, config: Omit<ProviderConfig, 'name'>): Provider {
  const fullConfig: ProviderConfig = { ...config, name }
  switch (name) {
    case 'anthropic':
      return createAnthropicProvider(fullConfig)
    case 'openai':
      return createOpenAIProvider(fullConfig)
    default:
      // Generic OpenAI-compatible provider
      return createOpenAIProvider(fullConfig)
  }
}
