/**
 * ANCS memory backend.
 * Connects to an ANCS instance via HTTP API for persistent cognitive memory.
 * Gives SwarmWire agents: semantic retrieval, truth tracking, entity graph, and importance decay.
 */

import type { MemoryBackend, MemoryItem, StoreMeta, QueryOpts } from '../types/memory.js'

export interface AncsMemoryConfig {
  /** ANCS API base URL (e.g. http://localhost:3000) */
  url: string
  /** Tenant ID for multi-tenancy */
  tenantId?: string
  /** API key if ANCS requires auth */
  apiKey?: string
}

export function ancsMemory(config: AncsMemoryConfig): MemoryBackend {
  const baseUrl = config.url.replace(/\/$/, '')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...init?.headers },
    })
    if (!res.ok) {
      throw new Error(`ANCS request failed: ${res.status} ${res.statusText}`)
    }
    return res.json()
  }

  return {
    async store(key: string, value: unknown, meta: StoreMeta): Promise<void> {
      const content = typeof value === 'string' ? value : JSON.stringify(value)

      await request('/api/v1/memory', {
        method: 'POST',
        body: JSON.stringify({
          content,
          sourceUri: `swarmwire://${meta.executionId ?? 'unknown'}/${key}`,
          tenantId: config.tenantId,
          metadata: {
            swarmwire: true,
            agentId: meta.agentId,
            executionId: meta.executionId,
            stepId: meta.stepId,
            tags: meta.tags,
          },
        }),
      })
    },

    async query(query: string, opts?: QueryOpts): Promise<MemoryItem[]> {
      const params = new URLSearchParams({ query })
      if (opts?.maxItems) params.set('maxItems', String(opts.maxItems))
      if (opts?.maxTokens) params.set('maxTokens', String(opts.maxTokens))
      if (config.tenantId) params.set('tenantId', config.tenantId)

      const result = await request(`/api/v1/memory/query?${params}`) as {
        items?: Array<{
          id: string
          content: string
          similarity?: number
          tier?: string
          truthState?: string
          createdAt?: string
        }>
      }

      return (result.items ?? []).map((item) => ({
        key: item.id,
        value: item.content,
        relevance: item.similarity ?? 0.5,
        meta: {
          tags: item.tier ? [item.tier] : undefined,
        },
        storedAt: item.createdAt ? new Date(item.createdAt).getTime() : Date.now(),
      }))
    },

    async forget(key: string): Promise<void> {
      await request(`/api/v1/memory/${key}`, {
        method: 'DELETE',
      })
    },
  }
}
