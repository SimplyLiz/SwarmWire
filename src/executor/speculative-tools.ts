/**
 * Speculative Tool Execution (PASTE-inspired) — prefetch likely tool calls
 * in parallel while the LLM is still generating, reducing end-to-end latency.
 *
 * Reference: https://arxiv.org/pdf/2512.15834
 */

import type { Tool } from '../types/tool.js'

export interface SpeculativeToolConfig {
  /** Tools available to the agent */
  tools: Tool[]
  /** Max speculative executions in flight at once. Default 3 */
  maxSpeculative?: number
  /** Min confidence (0-1) to speculatively execute. Default 0.6 */
  minConfidence?: number
  /** Cache TTL in ms. Default 30_000 */
  cacheTtlMs?: number
}

export interface SpeculativePrediction {
  toolName: string
  input: unknown
  confidence: number
}

export type SpeculativePredictor = (context: string) => SpeculativePrediction[]

export interface PrefetchResult {
  toolName: string
  input: unknown
  output: unknown
  resolvedAt: number
  cacheHit: boolean
}

export interface SpeculativeStats {
  prefetched: number
  hits: number
  misses: number
  avgLatencySavedMs: number
}

interface CacheEntry {
  output: unknown
  expiresAt: number
}

export class SpeculativeToolExecutor {
  private readonly tools: Map<string, Tool>
  private readonly maxSpeculative: number
  private readonly minConfidence: number
  private readonly cacheTtlMs: number
  private readonly cache: Map<string, CacheEntry> = new Map()
  private readonly inflight: Map<string, Promise<unknown>> = new Map()
  private stats: SpeculativeStats = { prefetched: 0, hits: 0, misses: 0, avgLatencySavedMs: 0 }

  constructor(config: SpeculativeToolConfig) {
    this.tools = new Map(config.tools.map((t) => [t.name, t]))
    this.maxSpeculative = config.maxSpeculative ?? 3
    this.minConfidence = config.minConfidence ?? 0.6
    this.cacheTtlMs = config.cacheTtlMs ?? 30_000
  }

  /**
   * Speculatively prefetch tool results based on predicted calls.
   * Call this while the LLM is still generating.
   */
  prefetch(predictions: SpeculativePrediction[]): void {
    const qualified = predictions
      .filter((p) => p.confidence >= this.minConfidence)
      .slice(0, this.maxSpeculative)

    for (const pred of qualified) {
      const tool = this.tools.get(pred.toolName)
      if (!tool) continue

      const key = this.cacheKey(pred.toolName, pred.input)
      if (this.cache.has(key) || this.inflight.has(key)) continue

      const promise = tool.execute(pred.input).then((result) => {
        this.cache.set(key, { output: result, expiresAt: Date.now() + this.cacheTtlMs })
        this.inflight.delete(key)
        this.stats.prefetched++
        return result
      }).catch(() => {
        this.inflight.delete(key)
      })

      this.inflight.set(key, promise)
    }
  }

  /**
   * Execute a tool — returns cached/prefetched result if available, else executes fresh.
   */
  async execute(toolName: string, input: unknown): Promise<PrefetchResult> {
    const key = this.cacheKey(toolName, input)
    const cached = this.cache.get(key)

    if (cached && cached.expiresAt > Date.now()) {
      this.cache.delete(key)
      this.stats.hits++
      return { toolName, input, output: cached.output, resolvedAt: Date.now(), cacheHit: true }
    }

    // Wait for in-flight if available
    const inflight = this.inflight.get(key)
    if (inflight) {
      const start = Date.now()
      const output = await inflight
      const latency = Date.now() - start
      this.stats.hits++
      this.stats.avgLatencySavedMs = (this.stats.avgLatencySavedMs * (this.stats.hits - 1) + latency) / this.stats.hits
      return { toolName, input, output, resolvedAt: Date.now(), cacheHit: true }
    }

    // Cache miss — execute normally
    const tool = this.tools.get(toolName)
    if (!tool) throw new Error(`Tool not found: ${toolName}`)

    const output = await tool.execute(input)
    this.stats.misses++
    return { toolName, input, output, resolvedAt: Date.now(), cacheHit: false }
  }

  getStats(): SpeculativeStats {
    return { ...this.stats }
  }

  clearCache(): void {
    this.cache.clear()
  }

  private cacheKey(toolName: string, input: unknown): string {
    return `${toolName}:${JSON.stringify(input)}`
  }
}

/**
 * Simple heuristic predictor: returns predictions based on keyword matching in context.
 */
export function createKeywordPredictor(
  toolHints: Array<{ toolName: string; keywords: string[]; defaultInput: unknown }>,
): SpeculativePredictor {
  return (context: string): SpeculativePrediction[] => {
    const lower = context.toLowerCase()
    return toolHints
      .map((hint) => {
        const matched = hint.keywords.filter((kw) => lower.includes(kw.toLowerCase())).length
        const confidence = matched / Math.max(1, hint.keywords.length)
        return { toolName: hint.toolName, input: hint.defaultInput, confidence }
      })
      .filter((p) => p.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence)
  }
}
