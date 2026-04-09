/**
 * Agent Discovery Catalog — runtime registry for discovering agents by capability, tag, or semantic query.
 */

import type { Agent } from '../types/agent.js'
import type { MemoryBackend } from '../types/memory.js'
import type { AgentCard } from '../a2a/types.js'

export interface CatalogEntry {
  id: string
  name: string
  description: string
  capabilities: string[]
  tags: string[]
  registeredAt: number
  lastSeenAt: number
  available: boolean
  agentCard?: AgentCard
  metadata: Record<string, unknown>
}

export interface CatalogConfig {
  storage?: MemoryBackend
  embedFn?: (text: string) => number[]
}

export interface DiscoveryQuery {
  capabilities?: string[]
  tags?: string[]
  semantic?: string
  available?: boolean
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
  for (const w of words) {
    vec[hashWord(w, dim)]! += 1
  }
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

export class AgentCatalog {
  private readonly entries: Map<string, CatalogEntry> = new Map()
  private readonly config: CatalogConfig

  constructor(config: CatalogConfig = {}) {
    this.config = config
  }

  register(agent: Agent, tags: string[] = [], metadata: Record<string, unknown> = {}): CatalogEntry {
    const now = Date.now()
    const entry: CatalogEntry = {
      id: agent.id,
      name: agent.name,
      description: agent.role,
      capabilities: agent.capabilities,
      tags,
      registeredAt: now,
      lastSeenAt: now,
      available: true,
      metadata,
    }
    this.entries.set(agent.id, entry)
    return entry
  }

  unregister(agentId: string): boolean {
    return this.entries.delete(agentId)
  }

  heartbeat(agentId: string): void {
    const entry = this.entries.get(agentId)
    if (entry) {
      entry.lastSeenAt = Date.now()
      entry.available = true
    }
  }

  discover(query: DiscoveryQuery): CatalogEntry[] {
    const checkAvailable = query.available !== false
    let candidates = [...this.entries.values()]

    if (checkAvailable) {
      candidates = candidates.filter((e) => e.available)
    }

    if (query.capabilities && query.capabilities.length > 0) {
      const required = query.capabilities
      candidates = candidates.filter((e) =>
        required.every((cap) => e.capabilities.includes(cap)),
      )
    }

    if (query.tags && query.tags.length > 0) {
      const filterTags = query.tags
      candidates = candidates.filter((e) =>
        filterTags.some((tag) => e.tags.includes(tag)),
      )
    }

    if (query.semantic && (this.config.embedFn ?? defaultEmbedFn)) {
      const embedFn = this.config.embedFn ?? defaultEmbedFn
      const queryVec = embedFn(query.semantic)
      const scored = candidates.map((e) => {
        const text = `${e.name} ${e.description} ${e.capabilities.join(' ')}`
        return { entry: e, score: cosineSim(queryVec, embedFn(text)) }
      })
      scored.sort((a, b) => b.score - a.score)
      return scored.map((s) => s.entry)
    }

    return candidates
  }

  resolve(agentIdOrName: string): CatalogEntry | undefined {
    return (
      this.entries.get(agentIdOrName) ??
      [...this.entries.values()].find((e) => e.name === agentIdOrName)
    )
  }

  list(filter: { available?: boolean; tags?: string[] } = {}): CatalogEntry[] {
    let all = [...this.entries.values()]
    if (filter.available !== undefined) {
      all = all.filter((e) => e.available === filter.available)
    }
    if (filter.tags && filter.tags.length > 0) {
      const filterTags = filter.tags
      all = all.filter((e) => filterTags.some((t) => e.tags.includes(t)))
    }
    return all
  }

  async flush(): Promise<void> {
    if (!this.config.storage) return
    for (const entry of this.entries.values()) {
      await this.config.storage.store(entry.id, JSON.stringify(entry), { tags: ['catalog'] })
    }
  }

  async hydrate(): Promise<void> {
    if (!this.config.storage) return
    const items = await this.config.storage.query('catalog', { tags: ['catalog'], maxItems: 5000 })
    for (const item of items) {
      try {
        const entry = JSON.parse(item.value as string) as CatalogEntry
        this.entries.set(entry.id, entry)
      } catch { /* skip */ }
    }
  }
}
