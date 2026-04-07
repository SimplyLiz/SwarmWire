/**
 * Feedback Weight Table for Dynamic Routing
 * Tracks per-model per-capability performance and adjusts routing scores
 * Ported from LLMRouter/FrugalRoute
 */

export interface RoutingWeight {
  modelId: string
  capability: string
  score: number
  successCount: number
  failureCount: number
  lastUpdated: number
  stale: boolean
  modelVersion?: string
}

export interface FeedbackConfig {
  failureThreshold: number
  failureWindowMs: number
  failurePenalty: number
  successBoost: number
  minWeight: number
  maxWeight: number
}

export const DEFAULT_FEEDBACK_CONFIG: FeedbackConfig = {
  failureThreshold: 3,
  failureWindowMs: 600000,
  failurePenalty: 0.05,
  successBoost: 0.01,
  minWeight: 0.1,
  maxWeight: 1.0,
}

export interface FeedbackEvent {
  modelId: string
  capability: string
  outcome: 'success' | 'failed' | 'escalated'
  timestamp: number
}

export class WeightTable {
  private weights = new Map<string, RoutingWeight>()
  private recentEvents: FeedbackEvent[] = []
  private config: FeedbackConfig

  constructor(config: FeedbackConfig = DEFAULT_FEEDBACK_CONFIG) {
    this.config = config
  }

  getWeight(modelId: string, capability: string): number {
    const key = weightKey(modelId, capability)
    const w = this.weights.get(key)
    if (!w) return 1.0
    if (w.stale) return 0.8
    return w.score
  }

  recordFeedback(event: FeedbackEvent): void {
    this.recentEvents.push(event)
    this.pruneOldEvents()

    const key = weightKey(event.modelId, event.capability)
    let w = this.weights.get(key)

    if (!w) {
      w = {
        modelId: event.modelId,
        capability: event.capability,
        score: 1.0,
        successCount: 0,
        failureCount: 0,
        lastUpdated: Date.now(),
        stale: false,
      }
      this.weights.set(key, w)
    }

    if (event.outcome === 'success') {
      w.successCount++
      w.score = Math.min(this.config.maxWeight, w.score + this.config.successBoost)
    } else if (event.outcome === 'failed' || event.outcome === 'escalated') {
      w.failureCount++
      w.score = Math.max(this.config.minWeight, w.score - this.config.failurePenalty)
    }

    w.lastUpdated = Date.now()
    w.stale = false
  }

  isDeprioritized(modelId: string, capability: string): boolean {
    const cutoff = Date.now() - this.config.failureWindowMs
    const failures = this.recentEvents.filter(
      e => e.modelId === modelId && e.capability === capability && 
           (e.outcome === 'failed' || e.outcome === 'escalated') &&
           e.timestamp > cutoff
    )
    return failures.length >= this.config.failureThreshold
  }

  markModelStale(modelId: string): void {
    for (const [, w] of this.weights) {
      if (w.modelId === modelId) {
        w.stale = true
      }
    }
  }

  markAllStale(): void {
    for (const [, w] of this.weights) {
      w.stale = true
    }
  }

  getFailurePatterns(): Array<{ modelId: string; capability: string; failureRate: number; totalEvents: number }> {
    const patterns: Array<{ modelId: string; capability: string; failureRate: number; totalEvents: number }> = []

    for (const [, w] of this.weights) {
      const total = w.successCount + w.failureCount
      if (total < 3) continue

      const failureRate = w.failureCount / total
      if (failureRate > 0.3) {
        patterns.push({
          modelId: w.modelId,
          capability: w.capability,
          failureRate,
          totalEvents: total,
        })
      }
    }

    return patterns.sort((a, b) => b.failureRate - a.failureRate)
  }

  getAllWeights(): RoutingWeight[] {
    return [...this.weights.values()]
  }

  reset(): void {
    this.weights.clear()
    this.recentEvents = []
  }

  private pruneOldEvents(): void {
    const cutoff = Date.now() - this.config.failureWindowMs * 10
    this.recentEvents = this.recentEvents.filter(e => e.timestamp > cutoff)
  }
}

function weightKey(modelId: string, capability: string): string {
  return `${modelId}:${capability}`
}

/**
 * Create a feedback event from execution result
 */
export function createFeedbackEvent(
  modelId: string,
  capability: string,
  success: boolean,
  escalated: boolean = false
): FeedbackEvent {
  return {
    modelId,
    capability,
    outcome: success ? 'success' : escalated ? 'escalated' : 'failed',
    timestamp: Date.now(),
  }
}