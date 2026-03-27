/**
 * Rate limiter — per-provider request throttling with sliding window and backoff.
 */

import type { Provider, LlmRequest, LlmResponse } from '../types/provider.js'

export interface RateLimiterConfig {
  /** Max requests per minute. Default 60 */
  requestsPerMinute?: number
  /** Max tokens per minute. Default 100_000 */
  tokensPerMinute?: number
  /** Backoff multiplier on 429. Default 2 */
  backoffMultiplier?: number
  /** Max backoff (ms). Default 60_000 */
  maxBackoffMs?: number
}

interface Window {
  timestamps: number[]
  tokens: number[]
}

/**
 * Wrap a provider with rate limiting.
 */
export function withRateLimit(provider: Provider, config: RateLimiterConfig = {}): Provider {
  const rpm = config.requestsPerMinute ?? 60
  const tpm = config.tokensPerMinute ?? 100_000
  const backoffMult = config.backoffMultiplier ?? 2
  const maxBackoff = config.maxBackoffMs ?? 60_000

  const window: Window = { timestamps: [], tokens: [] }
  let backoffMs = 0
  let backoffUntil = 0

  function pruneWindow(): void {
    const cutoff = Date.now() - 60_000
    while (window.timestamps.length > 0 && window.timestamps[0]! < cutoff) {
      window.timestamps.shift()
      window.tokens.shift()
    }
  }

  function getWindowUsage(): { requests: number; tokens: number } {
    pruneWindow()
    return {
      requests: window.timestamps.length,
      tokens: window.tokens.reduce((s, t) => s + t, 0),
    }
  }

  async function waitForCapacity(): Promise<void> {
    // Wait for backoff if active
    if (Date.now() < backoffUntil) {
      await sleep(backoffUntil - Date.now())
    }

    // Wait for rate limit window
    while (true) {
      const usage = getWindowUsage()
      if (usage.requests < rpm && usage.tokens < tpm) break

      // Calculate wait time — until oldest request exits the window
      const oldestTimestamp = window.timestamps[0] ?? Date.now()
      const waitMs = Math.max(1, (oldestTimestamp + 60_000) - Date.now())
      await sleep(Math.min(waitMs, 5_000))
    }
  }

  function recordRequest(tokens: number): void {
    window.timestamps.push(Date.now())
    window.tokens.push(tokens)
  }

  function handleBackoff(): void {
    backoffMs = backoffMs === 0 ? 1_000 : Math.min(backoffMs * backoffMult, maxBackoff)
    backoffUntil = Date.now() + backoffMs
  }

  function resetBackoff(): void {
    backoffMs = 0
    backoffUntil = 0
  }

  return {
    name: provider.name,
    models: provider.models,

    async chat(request: LlmRequest): Promise<LlmResponse> {
      await waitForCapacity()

      try {
        const response = await provider.chat(request)
        const totalTokens = response.inputTokens + response.outputTokens
        recordRequest(totalTokens)
        resetBackoff()
        return response
      } catch (err) {
        const isRateLimit = err instanceof Error && (
          err.message.includes('429') ||
          err.message.includes('rate_limit') ||
          err.message.includes('Rate limit')
        )

        if (isRateLimit) {
          handleBackoff()
          // Retry once after backoff
          await sleep(backoffMs)
          const response = await provider.chat(request)
          const totalTokens = response.inputTokens + response.outputTokens
          recordRequest(totalTokens)
          return response
        }

        throw err
      }
    },

    estimateCost: provider.estimateCost.bind(provider),
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
