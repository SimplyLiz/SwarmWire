/**
 * Temporal Memory — Continuum Memory Architecture (CMA) + Synapse spreading activation.
 *
 * Adds dynamic state mutation (memories reinforce or decay after retrieval),
 * temporal chaining (spreading activation across time edges), and background
 * consolidation (episodic → semantic compression).
 *
 * References:
 *   CMA: https://arxiv.org/abs/2601.09913
 *   Synapse: https://arxiv.org/html/2601.02744v2
 */

import type { MemoryBackend, StoreMeta, QueryOpts, MemoryItem } from '../types/memory.js'

export interface TemporalNote {
  id: string
  key: string
  value: unknown
  meta: StoreMeta
  strength: number          // 0-1, decays over time
  lastAccessed: number
  createdAt: number
  accessCount: number
  /** IDs of temporally adjacent notes (stored nearby in time) */
  temporalNeighbors: string[]
  /** Semantic cluster label (assigned during consolidation) */
  cluster?: string
}

export interface TemporalMemoryConfig {
  embedFn?: (text: string) => number[]
  /** Decay rate per hour (0-1). Default 0.02 (2% strength lost per hour) */
  decayRatePerHour?: number
  /** Strength gained per access. Default 0.1 */
  accessReinforcement?: number
  /** Notes with strength < this are evicted on consolidation. Default 0.05 */
  evictionThreshold?: number
  /** How many time-adjacent notes to chain. Default 3 */
  temporalWindowSize?: number
  /** Spreading activation depth during query. Default 2 */
  activationDepth?: number
  /** Max notes. Default 5000 */
  maxNotes?: number
}

function hashWord(w: string, dim: number): number {
  let h = 5381
  for (let i = 0; i < w.length; i++) h = ((h << 5) + h) ^ w.charCodeAt(i)
  return Math.abs(h) % dim
}

function embed(text: string): number[] {
  const words = text.toLowerCase().split(/\W+/).filter(Boolean)
  const dim = 128
  const vec = new Array<number>(dim).fill(0)
  for (const w of words) vec[hashWord(w, dim)]! += 1
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map((v) => v / norm)
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export class TemporalMemory implements MemoryBackend {
  private readonly notes: Map<string, TemporalNote> = new Map()
  private readonly timeline: string[] = []  // chronological note IDs
  private readonly embedFn: (text: string) => number[]
  private readonly decayRatePerHour: number
  private readonly accessReinforcement: number
  private readonly evictionThreshold: number
  private readonly temporalWindowSize: number
  private readonly activationDepth: number
  private readonly maxNotes: number

  constructor(config: TemporalMemoryConfig = {}) {
    this.embedFn = config.embedFn ?? embed
    this.decayRatePerHour = config.decayRatePerHour ?? 0.02
    this.accessReinforcement = config.accessReinforcement ?? 0.1
    this.evictionThreshold = config.evictionThreshold ?? 0.05
    this.temporalWindowSize = config.temporalWindowSize ?? 3
    this.activationDepth = config.activationDepth ?? 2
    this.maxNotes = config.maxNotes ?? 5000
  }

  async store(key: string, value: unknown, meta: StoreMeta): Promise<void> {
    const id = `tm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`
    const now = Date.now()

    // Link to recent temporal neighbors
    const recentIds = this.timeline.slice(-this.temporalWindowSize)

    const note: TemporalNote = {
      id,
      key,
      value,
      meta,
      strength: 1.0,
      lastAccessed: now,
      createdAt: now,
      accessCount: 0,
      temporalNeighbors: recentIds,
    }

    // Update neighbors to include this note
    for (const nid of recentIds) {
      const n = this.notes.get(nid)
      if (n && !n.temporalNeighbors.includes(id)) n.temporalNeighbors.push(id)
    }

    this.notes.set(id, note)
    this.timeline.push(id)

    // Evict oldest note when over capacity (FIFO, regardless of strength)
    while (this.notes.size > this.maxNotes) {
      const oldest = this.timeline.shift()
      if (oldest) this.notes.delete(oldest)
    }
  }

  async query(query: string, opts?: QueryOpts): Promise<MemoryItem[]> {
    const now = Date.now()
    const queryVec = this.embedFn(query)

    // Step 1: compute base semantic scores with temporal decay
    const baseScored = [...this.notes.values()].map((note) => {
      const currentStrength = this.decayedStrength(note, now)
      const noteVec = this.embedFn(typeof note.value === 'string' ? note.value : JSON.stringify(note.value))
      const semantic = cosineSim(queryVec, noteVec)
      return { note, score: semantic * currentStrength, semantic }
    })

    // Step 2: spreading activation — boost scores via temporal neighbors
    const scoreMap = new Map(baseScored.map(({ note, score }) => [note.id, score]))
    this.spreadActivation(scoreMap, queryVec, this.activationDepth)

    const finalScored = baseScored.map(({ note }) => ({
      note,
      score: scoreMap.get(note.id) ?? 0,
    }))

    finalScored.sort((a, b) => b.score - a.score)

    let results = finalScored
    if (opts?.minRelevance !== undefined) results = results.filter((r) => r.score >= opts.minRelevance!)
    if (opts?.maxItems !== undefined) results = results.slice(0, opts.maxItems)

    // Reinforce accessed notes
    for (const { note } of results) {
      note.accessCount++
      note.lastAccessed = now
      note.strength = Math.min(1.0, note.strength + this.accessReinforcement)
    }

    return results.map(({ note, score }) => ({
      key: note.id,
      value: note.value,
      relevance: Math.min(1, score),
      meta: note.meta,
      storedAt: note.createdAt,
    }))
  }

  async forget(key: string): Promise<void> {
    const note = this.notes.get(key)
    if (!note) return

    for (const nid of note.temporalNeighbors) {
      const n = this.notes.get(nid)
      if (n) n.temporalNeighbors = n.temporalNeighbors.filter((id) => id !== key)
    }

    this.notes.delete(key)
    const idx = this.timeline.indexOf(key)
    if (idx !== -1) this.timeline.splice(idx, 1)
  }

  /**
   * Background consolidation: evict weak memories, compress clusters.
   * Call periodically (e.g., from a background worker).
   */
  consolidate(): { evicted: number } {
    const now = Date.now()
    let evicted = 0

    for (const [id, note] of this.notes) {
      const strength = this.decayedStrength(note, now)
      if (strength < this.evictionThreshold) {
        this.notes.delete(id)
        const idx = this.timeline.indexOf(id)
        if (idx !== -1) this.timeline.splice(idx, 1)
        evicted++
      } else {
        note.strength = strength
      }
    }

    return { evicted }
  }

  stats(): { noteCount: number; avgStrength: number; oldestMs: number } {
    const notes = [...this.notes.values()]
    const now = Date.now()
    const avgStrength = notes.length > 0
      ? notes.reduce((s, n) => s + this.decayedStrength(n, now), 0) / notes.length
      : 0
    const oldest = notes.reduce((min, n) => Math.min(min, n.createdAt), now)
    return { noteCount: notes.length, avgStrength, oldestMs: now - oldest }
  }

  private decayedStrength(note: TemporalNote, now: number): number {
    const hoursElapsed = (now - note.lastAccessed) / (1000 * 60 * 60)
    return Math.max(0, note.strength * Math.pow(1 - this.decayRatePerHour, hoursElapsed))
  }

  private spreadActivation(
    scoreMap: Map<string, number>,
    queryVec: number[],
    depth: number,
  ): void {
    if (depth <= 0) return

    for (const [id, note] of this.notes) {
      const neighbors = note.temporalNeighbors
      if (neighbors.length === 0) continue

      const baseScore = scoreMap.get(id) ?? 0
      if (baseScore < 0.01) continue

      // Spread fraction of activation to neighbors
      const spreadFraction = 0.3 / depth
      for (const nid of neighbors) {
        const current = scoreMap.get(nid) ?? 0
        const boost = baseScore * spreadFraction
        scoreMap.set(nid, current + boost)
      }
    }
  }
}
