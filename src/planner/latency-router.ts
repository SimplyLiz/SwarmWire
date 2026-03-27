/**
 * Latency-Aware Router — pick the fastest model that meets quality requirements.
 *
 * When multiple models can handle a query at acceptable quality, this router
 * picks the one with the lowest observed latency. Tracks latency history
 * per model and uses exponential moving average.
 *
 * Based on SCORE (Harvard): formulates routing as constrained optimization
 * over quality, cost, AND latency jointly.
 */

import type { ModelTier } from '../types/provider.js'
import type { ModelLadder, ModelRung } from './cascade-router.js'

export interface LatencyRouterConfig {
  /** The model ladder */
  ladder: ModelLadder
  /** Maximum acceptable latency (ms). Default: no limit */
  maxLatencyMs?: number
  /** Minimum quality tier. Default: 'cheap' */
  minTier?: ModelTier
  /** Optimize for: 'latency' (fastest), 'cost' (cheapest), 'balanced'. Default 'balanced' */
  optimizeFor?: 'latency' | 'cost' | 'balanced'
  /** EMA smoothing factor for latency tracking (0-1). Default 0.3 */
  emaSmoothing?: number
}

interface LatencyRecord {
  model: string
  provider: string
  emaLatencyMs: number
  p95LatencyMs: number
  samples: number
  recentLatencies: number[]
}

export class LatencyRouter {
  private config: Required<Omit<LatencyRouterConfig, 'maxLatencyMs'>> & { maxLatencyMs?: number }
  private records = new Map<string, LatencyRecord>()

  constructor(config: LatencyRouterConfig) {
    this.config = {
      ladder: config.ladder,
      maxLatencyMs: config.maxLatencyMs,
      minTier: config.minTier ?? 'cheap',
      optimizeFor: config.optimizeFor ?? 'balanced',
      emaSmoothing: config.emaSmoothing ?? 0.3,
    }
  }

  /**
   * Pick the best model based on latency + cost + quality constraints.
   */
  pick(): ModelRung | null {
    const tierOrder: ModelTier[] = ['cheap', 'standard', 'premium', 'reasoning']
    const minTierIdx = tierOrder.indexOf(this.config.minTier)

    // Filter to eligible tiers
    const eligible = this.config.ladder.rungs.filter(
      (r) => tierOrder.indexOf(r.tier) >= minTierIdx
    )

    if (eligible.length === 0) return this.config.ladder.rungs[0] ?? null

    // Score each model
    const scored = eligible.map((rung) => {
      const key = `${rung.provider.name}:${rung.model.model}`
      const record = this.records.get(key)

      const latencyScore = record
        ? 1 - Math.min(1, record.emaLatencyMs / 10_000) // Normalize to 10s
        : 0.5 // Unknown latency = neutral

      const costScore = 1 - Math.min(1, rung.costPer1kTokens / 100) // Normalize to $0.10/1k

      const tierScore = tierOrder.indexOf(rung.tier) / (tierOrder.length - 1) // 0-1

      let combinedScore: number
      switch (this.config.optimizeFor) {
        case 'latency':
          combinedScore = latencyScore * 0.7 + costScore * 0.1 + tierScore * 0.2
          break
        case 'cost':
          combinedScore = latencyScore * 0.1 + costScore * 0.7 + tierScore * 0.2
          break
        case 'balanced':
        default:
          combinedScore = latencyScore * 0.35 + costScore * 0.35 + tierScore * 0.3
          break
      }

      // Apply latency constraint
      if (this.config.maxLatencyMs && record && record.emaLatencyMs > this.config.maxLatencyMs) {
        combinedScore *= 0.1 // Heavily penalize models over latency budget
      }

      return { rung, score: combinedScore, latencyMs: record?.emaLatencyMs ?? null }
    })

    scored.sort((a, b) => b.score - a.score)
    return scored[0]?.rung ?? null
  }

  /**
   * Record a latency observation for a model.
   */
  recordLatency(provider: string, model: string, latencyMs: number): void {
    const key = `${provider}:${model}`
    let record = this.records.get(key)

    if (!record) {
      record = {
        model,
        provider,
        emaLatencyMs: latencyMs,
        p95LatencyMs: latencyMs,
        samples: 0,
        recentLatencies: [],
      }
      this.records.set(key, record)
    }

    // Update EMA
    const alpha = this.config.emaSmoothing
    record.emaLatencyMs = alpha * latencyMs + (1 - alpha) * record.emaLatencyMs
    record.samples++

    // Track recent for P95
    record.recentLatencies.push(latencyMs)
    if (record.recentLatencies.length > 100) record.recentLatencies.shift()

    // Update P95
    const sorted = [...record.recentLatencies].sort((a, b) => a - b)
    const p95Idx = Math.floor(sorted.length * 0.95)
    record.p95LatencyMs = sorted[p95Idx] ?? latencyMs
  }

  /**
   * Get latency stats for all tracked models.
   */
  getStats(): Array<{
    model: string
    provider: string
    emaLatencyMs: number
    p95LatencyMs: number
    samples: number
  }> {
    return [...this.records.values()].map((r) => ({
      model: r.model,
      provider: r.provider,
      emaLatencyMs: Math.round(r.emaLatencyMs),
      p95LatencyMs: Math.round(r.p95LatencyMs),
      samples: r.samples,
    }))
  }

  /** Export state for persistence */
  exportState(): Map<string, LatencyRecord> {
    return new Map(this.records)
  }

  /** Import state from persistence */
  importState(state: Map<string, LatencyRecord>): void {
    this.records = new Map(state)
  }
}
