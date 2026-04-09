/**
 * Procedural Memory — stores "how to" execution procedures with success tracking.
 * Implements MemoryBackend for seamless swarm integration.
 */

import type { MemoryBackend, StoreMeta, QueryOpts, MemoryItem } from '../types/memory.js'

export interface ProcedureStep {
  order: number
  action: string
  inputs?: string[]
  output?: string
}

export interface Procedure {
  id: string
  name: string
  goal: string
  steps: ProcedureStep[]
  successCount: number
  totalCount: number
  lastUsed: number
  createdAt: number
  tags: string[]
}

export interface ProceduralMemoryConfig {
  embedFn?: (text: string) => number[]
  maxProcedures?: number
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

export class ProceduralMemory implements MemoryBackend {
  private readonly procedures: Map<string, Procedure> = new Map()
  private readonly maxProcedures: number
  private readonly embedFn: (text: string) => number[]

  constructor(config: ProceduralMemoryConfig = {}) {
    this.maxProcedures = config.maxProcedures ?? 500
    this.embedFn = config.embedFn ?? defaultEmbedFn
  }

  async learn(
    procedure: Omit<Procedure, 'id' | 'successCount' | 'totalCount' | 'lastUsed' | 'createdAt'>,
  ): Promise<Procedure> {
    const id = `proc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const now = Date.now()
    const full: Procedure = { id, ...procedure, successCount: 0, totalCount: 0, lastUsed: now, createdAt: now }
    this.procedures.set(id, full)

    if (this.procedures.size > this.maxProcedures) {
      // Evict least recently used
      let lruId = ''
      let lruTime = Infinity
      for (const [pid, proc] of this.procedures) {
        if (proc.lastUsed < lruTime) { lruTime = proc.lastUsed; lruId = pid }
      }
      if (lruId) this.procedures.delete(lruId)
    }

    return full
  }

  async recallFor(goal: string, opts: { limit?: number } = {}): Promise<Procedure[]> {
    const queryVec = this.embedFn(goal)
    const scored = [...this.procedures.values()].map((p) => ({
      proc: p,
      score: cosineSim(queryVec, this.embedFn(`${p.goal} ${p.name}`)),
    }))
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, opts.limit ?? 5).map((s) => s.proc)
  }

  async recordOutcome(procedureId: string, success: boolean): Promise<void> {
    const proc = this.procedures.get(procedureId)
    if (!proc) return
    proc.totalCount++
    if (success) proc.successCount++
    proc.lastUsed = Date.now()
  }

  // ── MemoryBackend interface ──

  async store(key: string, value: unknown, meta: StoreMeta): Promise<void> {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    await this.learn({
      name: key,
      goal: text,
      steps: [{ order: 1, action: text }],
      tags: meta.tags ?? [],
    })
  }

  async query(query: string, opts?: QueryOpts): Promise<MemoryItem[]> {
    const procs = await this.recallFor(query, { limit: opts?.maxItems })
    return procs.map((p) => ({
      key: p.id,
      value: JSON.stringify({ goal: p.goal, steps: p.steps }),
      relevance: p.totalCount > 0 ? p.successCount / p.totalCount : 0.5,
      meta: { tags: p.tags },
      storedAt: p.createdAt,
    }))
  }

  async forget(key: string): Promise<void> {
    this.procedures.delete(key)
  }
}
