/**
 * A-MEM: Agentic Memory (Zettelkasten-inspired).
 *
 * On every write, generates structured attributes and cross-links to
 * existing memories. Memories form a living graph — not a static index.
 *
 * Reference: https://arxiv.org/abs/2502.12110
 */

import type { MemoryBackend, StoreMeta, QueryOpts, MemoryItem } from '../types/memory.js'

export interface AMemNote {
  id: string
  key: string
  value: unknown
  keywords: string[]
  context: string
  links: string[]           // ids of related notes
  backlinks: string[]       // ids of notes that link to this one
  meta: StoreMeta
  createdAt: number
  updatedAt: number
  accessCount: number
}

export interface AMemConfig {
  /** Embed function for semantic linking. Defaults to keyword-hash. */
  embedFn?: (text: string) => number[]
  /** Min cosine similarity to auto-link two notes. Default 0.4 */
  linkThreshold?: number
  /** Max links per note. Default 10 */
  maxLinks?: number
  /** Max notes to retain. Default 2000 (FIFO eviction) */
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

function extractKeywords(text: string, n = 8): string[] {
  const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
  const freq = new Map<string, number>()
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1)
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w)
}

export class AMem implements MemoryBackend {
  private readonly notes: Map<string, AMemNote> = new Map()
  private readonly chronological: string[] = []
  private readonly embedFn: (text: string) => number[]
  private readonly linkThreshold: number
  private readonly maxLinks: number
  private readonly maxNotes: number

  constructor(config: AMemConfig = {}) {
    this.embedFn = config.embedFn ?? embed
    this.linkThreshold = config.linkThreshold ?? 0.4
    this.maxLinks = config.maxLinks ?? 10
    this.maxNotes = config.maxNotes ?? 2000
  }

  async store(key: string, value: unknown, meta: StoreMeta): Promise<void> {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    const keywords = extractKeywords(`${key} ${text}`)
    const noteVec = this.embedFn(`${key} ${text}`)

    // Find and establish links to existing notes
    const links: string[] = []
    for (const existing of this.notes.values()) {
      if (links.length >= this.maxLinks) break
      const existingVec = this.embedFn(`${existing.key} ${JSON.stringify(existing.value)}`)
      const sim = cosineSim(noteVec, existingVec)
      if (sim >= this.linkThreshold) {
        links.push(existing.id)
        // Add backlink
        existing.backlinks.push(key)
        existing.updatedAt = Date.now()
      }
    }

    const id = `amem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`
    const note: AMemNote = {
      id,
      key,
      value,
      keywords,
      context: text.slice(0, 200),
      links,
      backlinks: [],
      meta,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      accessCount: 0,
    }

    this.notes.set(id, note)
    this.chronological.push(id)

    if (this.notes.size > this.maxNotes) {
      const oldest = this.chronological.shift()
      if (oldest) this.notes.delete(oldest)
    }
  }

  async query(query: string, opts?: QueryOpts): Promise<MemoryItem[]> {
    const queryVec = this.embedFn(query)
    const queryKeywords = extractKeywords(query)

    const scored = [...this.notes.values()].map((note) => {
      const noteVec = this.embedFn(`${note.key} ${JSON.stringify(note.value)}`)
      const semantic = cosineSim(queryVec, noteVec)
      const keywordOverlap = queryKeywords.filter((kw) => note.keywords.includes(kw)).length / Math.max(1, queryKeywords.length)
      // Spreading activation: boost notes with many links
      const activationBoost = Math.min(0.1, note.links.length * 0.01 + note.backlinks.length * 0.01)
      const score = semantic * 0.6 + keywordOverlap * 0.3 + activationBoost

      return { note, score }
    })

    scored.sort((a, b) => b.score - a.score)

    let results = scored
    if (opts?.minRelevance !== undefined) results = results.filter((r) => r.score >= opts.minRelevance!)
    if (opts?.maxItems !== undefined) results = results.slice(0, opts.maxItems)

    // Update access counts
    for (const { note } of results) {
      note.accessCount++
      note.updatedAt = Date.now()
    }

    return results.map(({ note, score }) => ({
      key: note.id,
      value: note.value,
      relevance: Math.min(1, score),
      meta: { ...note.meta, tags: [...(note.meta.tags ?? []), ...note.keywords] },
      storedAt: note.createdAt,
    }))
  }

  async forget(key: string): Promise<void> {
    const note = this.notes.get(key)
    if (!note) return

    // Clean up backlinks in linked notes
    for (const linkedId of note.links) {
      const linked = this.notes.get(linkedId)
      if (linked) linked.backlinks = linked.backlinks.filter((b) => b !== key)
    }
    for (const backlinkedId of note.backlinks) {
      const bl = this.notes.get(backlinkedId)
      if (bl) bl.links = bl.links.filter((l) => l !== key)
    }

    this.notes.delete(key)
    const idx = this.chronological.indexOf(key)
    if (idx !== -1) this.chronological.splice(idx, 1)
  }

  /** Get all notes linked to a given note ID (for graph traversal). */
  getLinked(noteId: string): AMemNote[] {
    const note = this.notes.get(noteId)
    if (!note) return []
    return [...note.links, ...note.backlinks]
      .map((id) => this.notes.get(id))
      .filter((n): n is AMemNote => n !== undefined)
  }

  /** Get the full note graph as adjacency list. */
  getGraph(): Map<string, string[]> {
    const graph = new Map<string, string[]>()
    for (const [id, note] of this.notes) {
      graph.set(id, [...note.links, ...note.backlinks])
    }
    return graph
  }

  stats(): { noteCount: number; totalLinks: number; avgLinksPerNote: number } {
    const notes = [...this.notes.values()]
    const totalLinks = notes.reduce((s, n) => s + n.links.length, 0)
    return {
      noteCount: notes.length,
      totalLinks,
      avgLinksPerNote: notes.length > 0 ? totalLinks / notes.length : 0,
    }
  }
}
