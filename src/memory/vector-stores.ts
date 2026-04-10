/**
 * External Vector Store Adapters — drop-in MemoryBackend implementations
 * backed by production vector databases.
 *
 * Supported (all via lazy peer-dep imports):
 *   - Redis (redis + @redis/search)
 *   - Pinecone (@pinecone-database/pinecone)
 *   - Qdrant (@qdrant/js-client-rest)
 *   - In-process (flat cosine search — always available, no deps)
 *
 * Each adapter returns a MemoryBackend so they plug directly into any
 * SwarmWire component that accepts a memory backend.
 */

import type { MemoryBackend, StoreMeta, QueryOpts, MemoryItem } from '../types/memory.js'

// ─── Internal ───

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => unknown

// ─── Shared types ───

export interface VectorStoreConfig {
  /** Dimension of vectors produced by your embedFn. Required. */
  dimension: number
  /** Embed function: text → number[]. Required. */
  embedFn: (text: string) => Promise<number[]> | number[]
  /** Namespace / index prefix to isolate multiple stores in the same backend. Default 'swarmwire' */
  namespace?: string
}

// ─── In-process flat store (no external deps) ───

interface FlatEntry {
  key: string
  vector: number[]
  value: unknown
  meta: StoreMeta
  storedAt: number
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

export function createFlatVectorStore(
  config: VectorStoreConfig,
): MemoryBackend {
  const store = new Map<string, FlatEntry>()

  return {
    async store(key: string, value: unknown, meta: StoreMeta): Promise<void> {
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      const vector = await Promise.resolve(config.embedFn(text))
      store.set(key, { key, vector, value, meta, storedAt: Date.now() })
    },

    async query(query: string, opts?: QueryOpts): Promise<MemoryItem[]> {
      const qvec = await Promise.resolve(config.embedFn(query))
      const scored = [...store.values()].map((e) => ({
        entry: e,
        score: cosineSim(qvec, e.vector),
      }))
      scored.sort((a, b) => b.score - a.score)

      let results = scored
      if (opts?.minRelevance !== undefined) results = results.filter((r) => r.score >= opts.minRelevance!)
      if (opts?.maxItems !== undefined) results = results.slice(0, opts.maxItems)

      return results.map(({ entry, score }) => ({
        key: entry.key,
        value: entry.value,
        relevance: Math.min(1, score),
        meta: entry.meta,
        storedAt: entry.storedAt,
      }))
    },

    async forget(key: string): Promise<void> {
      store.delete(key)
    },
  }
}

// ─── Pinecone adapter ───

export interface PineconeConfig extends VectorStoreConfig {
  apiKey: string
  indexName: string
  /** Pinecone environment (older API). Leave empty for serverless indexes. */
  environment?: string
}

export function createPineconeStore(config: PineconeConfig): MemoryBackend {
  const ns = config.namespace ?? 'swarmwire'
  let clientPromise: Promise<unknown> | null = null

  async function getIndex(): Promise<{ upsert: AnyFn; query: AnyFn; deleteOne: AnyFn }> {
    if (!clientPromise) {
      clientPromise = (async () => {
        // Lazy import — only requires peer dep if actually used
        const { Pinecone } = await import('@pinecone-database/pinecone' as string)
        const pc = new (Pinecone as { new(opts: { apiKey: string }): unknown })({ apiKey: config.apiKey })
        return (pc as { index: (name: string) => unknown }).index(config.indexName)
      })()
    }
    return clientPromise as Promise<{ upsert: AnyFn; query: AnyFn; deleteOne: AnyFn }>
  }

  return {
    async store(key: string, value: unknown, meta: StoreMeta): Promise<void> {
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      const vector = await Promise.resolve(config.embedFn(text))
      const index = await getIndex()
      await index.upsert([{
        id: `${ns}:${key}`,
        values: vector,
        metadata: { key, value: text, tags: (meta.tags ?? []).join(','), storedAt: Date.now() },
      }])
    },

    async query(query: string, opts?: QueryOpts): Promise<MemoryItem[]> {
      const qvec = await Promise.resolve(config.embedFn(query))
      const index = await getIndex()
      const topK = opts?.maxItems ?? 10
      const result = await index.query({
        vector: qvec,
        topK,
        filter: { id: { $startsWith: `${ns}:` } },
        includeMetadata: true,
      }) as { matches: Array<{ id: string; score: number; metadata: Record<string, unknown> }> }

      return (result.matches ?? [])
        .filter((m) => opts?.minRelevance === undefined || m.score >= opts.minRelevance)
        .map((m) => ({
          key: String(m.metadata['key'] ?? m.id),
          value: m.metadata['value'],
          relevance: m.score,
          meta: { tags: String(m.metadata['tags'] ?? '').split(',').filter(Boolean) },
          storedAt: Number(m.metadata['storedAt'] ?? 0),
        }))
    },

    async forget(key: string): Promise<void> {
      const index = await getIndex()
      await index.deleteOne(`${ns}:${key}`)
    },
  }
}

// ─── Qdrant adapter ───

export interface QdrantConfig extends VectorStoreConfig {
  url: string
  collectionName: string
  apiKey?: string
}

export function createQdrantStore(config: QdrantConfig): MemoryBackend {
  const ns = config.namespace ?? 'swarmwire'
  let clientPromise: Promise<unknown> | null = null

  async function getClient(): Promise<{ upsert: AnyFn; search: AnyFn; delete: AnyFn }> {
    if (!clientPromise) {
      clientPromise = (async () => {
        const { QdrantClient } = await import('@qdrant/js-client-rest' as string)
        return new (QdrantClient as { new(opts: unknown): unknown })({
          url: config.url,
          apiKey: config.apiKey,
        })
      })()
    }
    return clientPromise as Promise<{ upsert: AnyFn; search: AnyFn; delete: AnyFn }>
  }

  return {
    async store(key: string, value: unknown, meta: StoreMeta): Promise<void> {
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      const vector = await Promise.resolve(config.embedFn(text))
      const client = await getClient()
      await client.upsert(config.collectionName, {
        points: [{
          id: `${ns}:${key}`,
          vector,
          payload: { key, value: text, tags: meta.tags ?? [], storedAt: Date.now() },
        }],
      })
    },

    async query(query: string, opts?: QueryOpts): Promise<MemoryItem[]> {
      const qvec = await Promise.resolve(config.embedFn(query))
      const client = await getClient()
      const results = await client.search(config.collectionName, {
        vector: qvec,
        limit: opts?.maxItems ?? 10,
        score_threshold: opts?.minRelevance,
        with_payload: true,
      }) as Array<{ id: string; score: number; payload: Record<string, unknown> }>

      return results.map((r) => ({
        key: String(r.payload['key'] ?? r.id),
        value: r.payload['value'],
        relevance: r.score,
        meta: { tags: (r.payload['tags'] as string[] | undefined) ?? [] },
        storedAt: Number(r.payload['storedAt'] ?? 0),
      }))
    },

    async forget(key: string): Promise<void> {
      const client = await getClient()
      await client.delete(config.collectionName, {
        points: [`${ns}:${key}`],
      })
    },
  }
}

// ─── Redis vector store adapter ───

export interface RedisVectorConfig extends VectorStoreConfig {
  /** Redis connection URL. Default 'redis://localhost:6379' */
  url?: string
  /** Index name. Default 'swarmwire_idx' */
  indexName?: string
}

export function createRedisVectorStore(config: RedisVectorConfig): MemoryBackend {
  const ns = config.namespace ?? 'swarmwire'
  const indexName = config.indexName ?? 'swarmwire_idx'
  let clientPromise: Promise<unknown> | null = null

  async function getClient(): Promise<{ hSet: AnyFn; ft: { search: AnyFn; create?: AnyFn }; hDel: AnyFn; connect: AnyFn }> {
    if (!clientPromise) {
      clientPromise = (async () => {
        const { createClient } = await import('redis' as string)
        const client = (createClient as AnyFn)({ url: config.url ?? 'redis://localhost:6379' })
        await (client as { connect: AnyFn }).connect()
        return client
      })()
    }
    return clientPromise as Promise<{ hSet: AnyFn; ft: { search: AnyFn; create?: AnyFn }; hDel: AnyFn; connect: AnyFn }>
  }

  return {
    async store(key: string, value: unknown, meta: StoreMeta): Promise<void> {
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      const vector = await Promise.resolve(config.embedFn(text))
      const client = await getClient()
      // Store as hash with vector blob
      await client.hSet(`${ns}:${key}`, {
        key,
        value: text,
        tags: (meta.tags ?? []).join(','),
        storedAt: String(Date.now()),
        vector: Buffer.from(new Float32Array(vector).buffer).toString('base64'),
      })
    },

    async query(query: string, opts?: QueryOpts): Promise<MemoryItem[]> {
      const qvec = await Promise.resolve(config.embedFn(query))
      const client = await getClient()
      const buf = Buffer.from(new Float32Array(qvec).buffer)
      try {
        const results = await client.ft.search(
          indexName,
          `*=>[KNN ${opts?.maxItems ?? 10} @vector $BLOB AS score]`,
          { PARAMS: { BLOB: buf }, DIALECT: 2, RETURN: ['key', 'value', 'tags', 'storedAt', 'score'] },
        ) as { documents: Array<{ value: Record<string, string> }> }

        return (results.documents ?? [])
          .reduce<MemoryItem[]>((acc, doc) => {
            const score = 1 - parseFloat(doc.value['score'] ?? '1')
            if (opts?.minRelevance !== undefined && score < opts.minRelevance) return acc
            acc.push({
              key: doc.value['key'] ?? '',
              value: doc.value['value'] as unknown,
              relevance: score,
              meta: { tags: (doc.value['tags'] ?? '').split(',').filter(Boolean) },
              storedAt: Number(doc.value['storedAt'] ?? 0),
            })
            return acc
          }, [])
      } catch {
        return []
      }
    },

    async forget(key: string): Promise<void> {
      const client = await getClient()
      await client.hDel(`${ns}:${key}`)
    },
  }
}
