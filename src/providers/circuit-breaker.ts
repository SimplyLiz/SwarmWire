/**
 * Circuit breaker for LLM providers.
 * Tracks failure rates, trips at threshold, fails fast, auto-recovers.
 */

import type { Provider, LlmRequest, LlmResponse } from '../types/provider.js'

export interface CircuitBreakerConfig {
  /** Failure rate threshold to trip (0-1). Default 0.4 */
  failureThreshold?: number
  /** Time window for tracking failures (ms). Default 60_000 */
  windowMs?: number
  /** Time to wait before half-open probe (ms). Default 30_000 */
  resetTimeoutMs?: number
  /** Number of probe requests in half-open state. Default 3 */
  halfOpenRequests?: number
}

type CircuitState = 'closed' | 'open' | 'half-open'

interface RequestRecord {
  timestamp: number
  success: boolean
}

/**
 * Wrap a provider with circuit breaker logic.
 */
export function withCircuitBreaker(provider: Provider, config: CircuitBreakerConfig = {}): Provider & { getState(): CircuitState } {
  const failureThreshold = config.failureThreshold ?? 0.4
  const windowMs = config.windowMs ?? 60_000
  const resetTimeoutMs = config.resetTimeoutMs ?? 30_000
  const halfOpenMax = config.halfOpenRequests ?? 3

  let state: CircuitState = 'closed'
  let lastTrippedAt = 0
  let halfOpenAttempts = 0
  const records: RequestRecord[] = []

  function pruneRecords(): void {
    const cutoff = Date.now() - windowMs
    while (records.length > 0 && records[0]!.timestamp < cutoff) {
      records.shift()
    }
  }

  function getFailureRate(): number {
    pruneRecords()
    if (records.length === 0) return 0
    const failures = records.filter((r) => !r.success).length
    return failures / records.length
  }

  function checkState(): void {
    if (state === 'open' && Date.now() - lastTrippedAt > resetTimeoutMs) {
      state = 'half-open'
      halfOpenAttempts = 0
    }
  }

  function recordSuccess(): void {
    records.push({ timestamp: Date.now(), success: true })
    if (state === 'half-open') {
      halfOpenAttempts++
      if (halfOpenAttempts >= halfOpenMax) {
        state = 'closed'
      }
    }
  }

  function recordFailure(): void {
    records.push({ timestamp: Date.now(), success: false })
    if (state === 'closed' && getFailureRate() >= failureThreshold) {
      state = 'open'
      lastTrippedAt = Date.now()
    }
    if (state === 'half-open') {
      state = 'open'
      lastTrippedAt = Date.now()
    }
  }

  return {
    name: provider.name,
    models: provider.models,

    async chat(request: LlmRequest): Promise<LlmResponse> {
      checkState()

      if (state === 'open') {
        throw new CircuitOpenError(provider.name, resetTimeoutMs - (Date.now() - lastTrippedAt))
      }

      try {
        const response = await provider.chat(request)
        recordSuccess()
        return response
      } catch (err) {
        recordFailure()
        throw err
      }
    },

    estimateCost: provider.estimateCost.bind(provider),

    getState(): CircuitState {
      checkState()
      return state
    },
  }
}

export class CircuitOpenError extends Error {
  constructor(
    public readonly providerName: string,
    public readonly retryAfterMs: number,
  ) {
    super(`Circuit breaker open for provider ${providerName}. Retry in ${Math.ceil(retryAfterMs / 1000)}s`)
    this.name = 'CircuitOpenError'
  }
}

/**
 * Wrap multiple providers with failover.
 * Falls through to backup providers when primary circuit is open.
 */
export function withFailover(
  providers: Array<Provider & { getState?: () => CircuitState }>,
): Provider {
  if (providers.length === 0) throw new Error('withFailover requires at least one provider')

  return {
    name: providers.map((p) => p.name).join('+'),
    models: providers.flatMap((p) => p.models),

    async chat(request: LlmRequest): Promise<LlmResponse> {
      const errors: Error[] = []

      for (const provider of providers) {
        // Skip providers with open circuits
        if (provider.getState?.() === 'open') continue

        // Check if this provider has the requested model
        const hasModel = provider.models.some((m) => m.model === request.model)
        if (!hasModel) continue

        try {
          return await provider.chat(request)
        } catch (err) {
          errors.push(err instanceof Error ? err : new Error(String(err)))
        }
      }

      // If all providers with the specific model failed, try any provider
      for (const provider of providers) {
        if (provider.getState?.() === 'open') continue
        try {
          return await provider.chat(request)
        } catch (err) {
          errors.push(err instanceof Error ? err : new Error(String(err)))
        }
      }

      throw new Error(`All providers failed: ${errors.map((e) => e.message).join('; ')}`)
    },

    estimateCost(model: string, inputTokens: number, outputTokens: number): number {
      for (const provider of providers) {
        const cost = provider.estimateCost(model, inputTokens, outputTokens)
        if (cost > 0) return cost
      }
      return 0
    },
  }
}
