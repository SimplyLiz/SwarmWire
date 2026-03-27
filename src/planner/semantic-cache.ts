/**
 * Semantic Response Cache — avoid redundant LLM calls for similar queries.
 *
 * Based on GPT Semantic Cache (arXiv:2411.05276):
 * - Embeds queries as vectors
 * - Uses cosine similarity to find cache hits
 * - 61-68% hit rate, 97%+ accuracy on hits
 * - Up to 68% API cost reduction
 *
 * Uses a simple in-memory store. For production, plug in Redis/ANCS via
 * the CacheBackend interface.
 */

import type { LlmRequest, LlmResponse } from '../types/provider.js'

// ─── Configuration ───

export interface SemanticCacheConfig {
  /** Cosine similarity threshold for cache hits. Default 0.85 (conservative) */
  similarityThreshold?: number
  /** Maximum cache entries. Default 10_000 */
  maxEntries?: number
  /** TTL in milliseconds. Default 3_600_000 (1 hour) */
  ttlMs?: number
  /** Custom embedding function. If not provided, uses character trigram hashing. */
  embedFn?: (text: string) => Promise<number[]> | number[]
  /** Custom cache backend. If not provided, uses in-memory Map. */
  backend?: CacheBackend
}

export interface CacheBackend {
  get(embedding: number[], threshold: number): Promise<CacheEntry | null>
  set(embedding: number[], entry: CacheEntry): Promise<void>
  clear(): Promise<void>
  size(): Promise<number>
}

export interface CacheEntry {
  queryText: string
  embedding: number[]
  response: LlmResponse
  model: string
  createdAt: number
  hitCount: number
}

export interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  entries: number
  estimatedSavingsCents: number
}

// ─── Main Implementation ───

export class SemanticCache {
  private config: Required<Omit<SemanticCacheConfig, 'embedFn' | 'backend'>> & {
    embedFn?: (text: string) => Promise<number[]> | number[]
  }
  private backend: CacheBackend
  private hits = 0
  private misses = 0
  private savedCostCents = 0

  constructor(config: SemanticCacheConfig = {}) {
    this.config = {
      similarityThreshold: config.similarityThreshold ?? 0.85,
      maxEntries: config.maxEntries ?? 10_000,
      ttlMs: config.ttlMs ?? 3_600_000,
      embedFn: config.embedFn,
    }
    this.backend = config.backend ?? new InMemoryCacheBackend(this.config.maxEntries, this.config.ttlMs)
  }

  /**
   * Check cache for a similar query.
   * Returns cached response if found, null otherwise.
   */
  async lookup(request: LlmRequest): Promise<LlmResponse | null> {
    const queryText = requestToText(request)
    const embedding = await this.embed(queryText)

    const entry = await this.backend.get(embedding, this.config.similarityThreshold)
    if (entry) {
      this.hits++
      entry.hitCount++
      // Return cached response with updated metadata
      return {
        ...entry.response,
        // Mark as cached so cost tracking knows not to count this
        cachedInputTokens: entry.response.inputTokens,
      }
    }

    this.misses++
    return null
  }

  /**
   * Store a response in the cache.
   */
  async store(request: LlmRequest, response: LlmResponse, estimatedCostCents: number): Promise<void> {
    const queryText = requestToText(request)
    const embedding = await this.embed(queryText)

    await this.backend.set(embedding, {
      queryText,
      embedding,
      response,
      model: response.model,
      createdAt: Date.now(),
      hitCount: 0,
    })

    // Track savings for future hits
    this.savedCostCents += estimatedCostCents
  }

  /**
   * Wrap a provider chat call with caching.
   * Returns cached response if available, otherwise calls provider and caches result.
   */
  async cachedChat(
    request: LlmRequest,
    chatFn: (req: LlmRequest) => Promise<LlmResponse>,
    estimateCostFn: (model: string, inp: number, out: number) => number,
  ): Promise<LlmResponse & { cacheHit: boolean }> {
    const cached = await this.lookup(request)
    if (cached) {
      return { ...cached, cacheHit: true }
    }

    const response = await chatFn(request)
    const cost = estimateCostFn(request.model, response.inputTokens, response.outputTokens)
    await this.store(request, response, cost)

    return { ...response, cacheHit: false }
  }

  /** Get cache statistics. */
  stats(): CacheStats {
    const total = this.hits + this.misses
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      entries: 0, // Updated async below
      estimatedSavingsCents: this.savedCostCents * (total > 0 ? this.hits / total : 0),
    }
  }

  /** Clear the cache. */
  async clear(): Promise<void> {
    await this.backend.clear()
    this.hits = 0
    this.misses = 0
    this.savedCostCents = 0
  }

  private async embed(text: string): Promise<number[]> {
    if (this.config.embedFn) {
      return this.config.embedFn(text)
    }
    return trigramHash(text)
  }
}

// ─── In-Memory Cache Backend ───

class InMemoryCacheBackend implements CacheBackend {
  private entries: CacheEntry[] = []

  constructor(
    private maxEntries: number,
    private ttlMs: number,
  ) {}

  async get(embedding: number[], threshold: number): Promise<CacheEntry | null> {
    this.evictStale()

    let bestEntry: CacheEntry | null = null
    let bestSim = -1

    for (const entry of this.entries) {
      const sim = cosineSimilarity(embedding, entry.embedding)
      if (sim >= threshold && sim > bestSim) {
        bestSim = sim
        bestEntry = entry
      }
    }

    return bestEntry
  }

  async set(embedding: number[], entry: CacheEntry): Promise<void> {
    // Check if very similar entry already exists — update it
    for (let i = 0; i < this.entries.length; i++) {
      const sim = cosineSimilarity(embedding, this.entries[i]!.embedding)
      if (sim > 0.95) {
        this.entries[i] = entry
        return
      }
    }

    this.entries.push(entry)

    // Evict oldest if over limit
    if (this.entries.length > this.maxEntries) {
      // Remove least recently hit entries
      this.entries.sort((a, b) => b.hitCount - a.hitCount || b.createdAt - a.createdAt)
      this.entries = this.entries.slice(0, this.maxEntries)
    }
  }

  async clear(): Promise<void> {
    this.entries = []
  }

  async size(): Promise<number> {
    return this.entries.length
  }

  private evictStale(): void {
    const now = Date.now()
    this.entries = this.entries.filter((e) => now - e.createdAt < this.ttlMs)
  }
}

// ─── Embedding Utilities ───

/**
 * Lightweight trigram hash embedding — no ML model needed.
 * Produces a fixed-size vector from character trigrams.
 * Not as good as real embeddings, but zero-cost and fast.
 * Use `embedFn` config option for production-quality embeddings.
 */
function trigramHash(text: string, dimensions = 256): number[] {
  const vec = new Float64Array(dimensions)
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim()

  for (let i = 0; i < normalized.length - 2; i++) {
    const trigram = normalized.slice(i, i + 3)
    const hash = simpleHash(trigram)
    const idx = Math.abs(hash) % dimensions
    vec[idx] = (vec[idx] ?? 0) + 1
  }

  // L2 normalize
  let norm = 0
  for (let i = 0; i < dimensions; i++) norm += (vec[i] ?? 0) ** 2
  norm = Math.sqrt(norm)
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) vec[i] = (vec[i] ?? 0) / norm
  }

  return Array.from(vec)
}

function simpleHash(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + (str.charCodeAt(i) ?? 0)) | 0
  }
  return hash
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    dot += ai * bi
    normA += ai * ai
    normB += bi * bi
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

// ─── Helpers ───

function requestToText(request: LlmRequest): string {
  const parts: string[] = []
  if (request.systemPrompt) parts.push(request.systemPrompt)
  for (const msg of request.messages) parts.push(msg.content)
  return parts.join('\n')
}
