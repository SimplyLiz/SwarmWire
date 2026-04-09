/**
 * Episodic Memory — stores specific past interactions with temporal ordering.
 * Implements MemoryBackend for seamless swarm integration.
 */

import type { MemoryBackend, StoreMeta, QueryOpts, MemoryItem } from '../types/memory.js'

export interface EpisodicEntry {
  id: string
  sessionId?: string
  timestamp: number
  description: string
  input: unknown
  output: unknown
  success: boolean
  durationMs: number
  costCents: number
  tags: string[]
}

export interface EpisodicMemoryConfig {
  maxEntries?: number
  embedFn?: (text: string) => number[]
}

function hashWord(w: string, dim: number): number {
  let h = 5381
  for (let i = 0; i < w.length; i++) h = ((h << 5) + h) ^ w.charCodeAt(i)
  return Math.abs(h) % dim
}

function defaultEmbedFn(text: string): number[] {
  const words = text.toLowerCase().split(/\W+/).filter(Boolean)
  const dim = 128
  const vec = new Array<number>(dim).fill(0)
  for (const w of words) vec[hashWord(w, dim)]! += 1
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map((v) => v / norm)
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return (na === 0 || nb === 0) ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export class EpisodicMemory implements MemoryBackend {
  private readonly entries: Map<string, EpisodicEntry> = new Map()
  private readonly chronological: string[] = []
  private readonly maxEntries: number
  private readonly embedFn: (text: string) => number[]

  constructor(config: EpisodicMemoryConfig = {}) {
    this.maxEntries = config.maxEntries ?? 1000
    this.embedFn = config.embedFn ?? defaultEmbedFn
  }

  async record(entry: Omit<EpisodicEntry, 'id'>): Promise<EpisodicEntry> {
    const id = `ep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const full: EpisodicEntry = { id, ...entry }
    this.entries.set(id, full)
    this.chronological.push(id)

    if (this.entries.size > this.maxEntries) {
      const oldest = this.chronological.shift()
      if (oldest) this.entries.delete(oldest)
    }

    return full
  }

  async recall(
    context: string,
    opts: { limit?: number; sessionId?: string; tags?: string[] } = {},
  ): Promise<EpisodicEntry[]> {
    const queryVec = this.embedFn(context)
    let candidates = [...this.entries.values()]

    if (opts.sessionId) {
      candidates = candidates.filter((e) => e.sessionId === opts.sessionId)
    }
    if (opts.tags && opts.tags.length > 0) {
      const filterTags = opts.tags
      candidates = candidates.filter((e) => filterTags.some((t) => e.tags.includes(t)))
    }

    const scored = candidates.map((e) => {
      const text = `${e.description} ${JSON.stringify(e.input)}`
      const sim = cosineSim(queryVec, this.embedFn(text))
      return { entry: e, score: sim }
    })

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, opts.limit ?? 10).map((s) => s.entry)
  }

  // ── MemoryBackend interface ──

  async store(key: string, value: unknown, meta: StoreMeta): Promise<void> {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    await this.record({
      sessionId: meta.executionId,
      timestamp: Date.now(),
      description: key,
      input: text,
      output: text,
      success: true,
      durationMs: 0,
      costCents: 0,
      tags: meta.tags ?? [],
    })
  }

  async query(query: string, opts?: QueryOpts): Promise<MemoryItem[]> {
    const entries = await this.recall(query, {
      limit: opts?.maxItems,
      tags: opts?.tags,
    })
    return entries.map((e) => ({
      key: e.id,
      value: JSON.stringify({ input: e.input, output: e.output }),
      relevance: 1,
      meta: { tags: e.tags, executionId: e.sessionId },
      storedAt: e.timestamp,
    }))
  }

  async forget(key: string): Promise<void> {
    this.entries.delete(key)
    const idx = this.chronological.indexOf(key)
    if (idx !== -1) this.chronological.splice(idx, 1)
  }
}
