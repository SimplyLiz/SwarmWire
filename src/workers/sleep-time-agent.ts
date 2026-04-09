/**
 * Sleep-Time Compute Agent — runs LLM-driven background consolidation
 * between active swarm sessions (when the agent is "sleeping").
 *
 * Inspired by Letta's sleep-time compute and human memory consolidation:
 * during idle periods, the agent reflects on recent episodes, extracts
 * durable knowledge, and compresses working memory.
 *
 * Unlike background-workers.ts (heuristic loops), this agent uses an actual
 * LLM call to synthesize insights from recent memory.
 */

import type { MemoryBackend, MemoryItem } from '../types/memory.js'
import type { Provider, ModelConfig } from '../types/provider.js'

export interface ConsolidationResult {
  itemsReviewed: number
  insightsExtracted: number
  itemsForgotten: number
  insights: string[]
  durationMs: number
}

export interface SleepTimeAgentConfig {
  /** Memory backend to consolidate */
  memory: MemoryBackend
  /** Provider to use for LLM-driven synthesis */
  provider: Provider
  /** Model to use (cheap model recommended — this runs frequently) */
  model: ModelConfig
  /** How many recent memories to review per consolidation pass. Default 20 */
  reviewWindow?: number
  /** Target insight memory key prefix. Default 'insight:' */
  insightPrefix?: string
  /** Min relevance score to include memories in review context. Default 0.1 */
  minRelevance?: number
  /** If true, also call memory.forget() on memories below evictionRelevance. Default false */
  evictWeak?: boolean
  /** Relevance threshold below which to evict (if evictWeak=true). Default 0.05 */
  evictionThreshold?: number
}

export class SleepTimeAgent {
  private readonly config: Required<SleepTimeAgentConfig>
  private running = false
  private intervalHandle?: ReturnType<typeof setInterval>

  constructor(config: SleepTimeAgentConfig) {
    this.config = {
      reviewWindow: 20,
      insightPrefix: 'insight:',
      minRelevance: 0.1,
      evictWeak: false,
      evictionThreshold: 0.05,
      ...config,
    }
  }

  /**
   * Run a single consolidation pass.
   * Call this manually or use start() for periodic background execution.
   */
  async consolidate(contextHint = 'recent agent activity'): Promise<ConsolidationResult> {
    const start = Date.now()

    // Retrieve recent memories for review
    const items: MemoryItem[] = await this.config.memory.query(contextHint, {
      maxItems: this.config.reviewWindow,
      minRelevance: this.config.minRelevance,
    })

    if (items.length === 0) {
      return { itemsReviewed: 0, insightsExtracted: 0, itemsForgotten: 0, insights: [], durationMs: Date.now() - start }
    }

    // Build review context for LLM
    const reviewContext = items
      .map((item, i) => `[${i + 1}] ${typeof item.value === 'string' ? item.value : JSON.stringify(item.value)}`)
      .join('\n')

    const prompt = `You are consolidating agent memory. Review these recent items and extract durable insights.

Recent memory items:
${reviewContext}

Extract 2-5 concise, durable insights from these items. Each insight should be a single sentence capturing a pattern, fact, or useful lesson. Format as a JSON array of strings.`

    let insights: string[] = []
    try {
      const response = await this.config.provider.chat({
        messages: [{ role: 'user', content: prompt }],
        model: this.config.model.model,
        maxTokens: 500,
      })

      const text = response.content
      const match = text.match(/\[[\s\S]*?\]/)
      if (match) {
        insights = JSON.parse(match[0]) as string[]
      }
    } catch {
      // If LLM fails, skip insight extraction but don't crash
      insights = []
    }

    // Store extracted insights back to memory
    for (let i = 0; i < insights.length; i++) {
      const key = `${this.config.insightPrefix}${Date.now()}_${i}`
      await this.config.memory.store(key, insights[i]!, {
        tags: ['insight', 'consolidated'],
      })
    }

    // Optionally evict weak memories
    let forgotten = 0
    if (this.config.evictWeak) {
      const weak = items.filter((item) => (item.relevance ?? 1) < this.config.evictionThreshold)
      for (const item of weak) {
        await this.config.memory.forget(item.key)
        forgotten++
      }
    }

    return {
      itemsReviewed: items.length,
      insightsExtracted: insights.length,
      itemsForgotten: forgotten,
      insights,
      durationMs: Date.now() - start,
    }
  }

  /**
   * Start periodic consolidation in the background.
   * @param intervalMs How often to consolidate. Default 60_000 (1 min).
   * @param contextHint Memory query context for each pass.
   */
  start(intervalMs = 60_000, contextHint = 'recent agent activity'): void {
    if (this.running) return
    this.running = true
    this.intervalHandle = setInterval(() => {
      void this.consolidate(contextHint)
    }, intervalMs)
  }

  /** Stop periodic consolidation. */
  stop(): void {
    this.running = false
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = undefined
    }
  }

  get isRunning(): boolean {
    return this.running
  }
}
