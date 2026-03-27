/**
 * Memory — pluggable storage backend.
 * Works without memory (ephemeral), with ANCS, Redis, or custom.
 */

export interface MemoryBackend {
  store(key: string, value: unknown, meta: StoreMeta): Promise<void>
  query(query: string, opts?: QueryOpts): Promise<MemoryItem[]>
  forget(key: string): Promise<void>
}

export interface StoreMeta {
  agentId?: string
  executionId?: string
  stepId?: string
  tags?: string[]
  ttlSeconds?: number
}

export interface QueryOpts {
  maxItems?: number
  maxTokens?: number
  tags?: string[]
  minRelevance?: number
}

export interface MemoryItem {
  key: string
  value: unknown
  relevance: number
  meta: StoreMeta
  storedAt: number
}
