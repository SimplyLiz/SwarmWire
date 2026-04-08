/**
 * Attention-based agent router — MoE gating, GraphRoPE, and multi-head attention.
 */

import type { Task } from '../types/task.js'
import type { Agent } from '../types/agent.js'

// ---------------------------------------------------------------------------
// Shared bag-of-words helper — max 64-dim, vocabulary built across all calls
// ---------------------------------------------------------------------------

const attnVocabulary: Map<string, number> = new Map()
const ATTN_MAX_DIM = 64

function bagOfWords(text: string, maxDim: number): number[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0)

  for (const w of words) {
    if (!attnVocabulary.has(w) && attnVocabulary.size < maxDim) {
      attnVocabulary.set(w, attnVocabulary.size)
    }
  }

  const vec = new Array<number>(maxDim).fill(0)
  for (const w of words) {
    const idx = attnVocabulary.get(w)
    if (idx !== undefined && idx < maxDim) {
      vec[idx]!++
    }
  }

  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
  if (norm === 0) return vec
  return vec.map((v) => v / norm)
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0
  let magA = 0
  let magB = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!
    magA += a[i]! * a[i]!
    magB += b[i]! * b[i]!
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AttentionRouterConfig {
  heads?: number      // Default 8
  topK?: number       // Default 2
  loadPenalty?: number // Default 0.1
}

export interface AgentRegistration {
  agent: Agent
  domain: string[]
  currentLoad: number  // 0-1
}

export type AttentionMechanism = 'moe' | 'graph-rope' | 'multi-head'

export interface AttentionResult {
  selected: Agent[]
  scores: Map<string, number>
  mechanism: AttentionMechanism
}

// ---------------------------------------------------------------------------
// AttentionRouter
// ---------------------------------------------------------------------------

export class AttentionRouter {
  private registrations: Map<string, AgentRegistration> = new Map()
  private adjacency: Map<string, Set<string>> = new Map()
  private config: Required<AttentionRouterConfig>

  constructor(config: Partial<AttentionRouterConfig> = {}) {
    this.config = {
      heads: config.heads ?? 8,
      topK: config.topK ?? 2,
      loadPenalty: config.loadPenalty ?? 0.1,
    }
  }

  addAgent(agent: Agent, domain: string[]): void {
    this.registrations.set(agent.id, {
      agent,
      domain,
      currentLoad: 0,
    })
    this.adjacency.set(agent.id, new Set())
  }

  removeAgent(agentId: string): void {
    this.registrations.delete(agentId)
    this.adjacency.delete(agentId)
    for (const set of this.adjacency.values()) {
      set.delete(agentId)
    }
  }

  connect(agentIdA: string, agentIdB: string): void {
    if (!this.adjacency.has(agentIdA)) this.adjacency.set(agentIdA, new Set())
    if (!this.adjacency.has(agentIdB)) this.adjacency.set(agentIdB, new Set())
    this.adjacency.get(agentIdA)!.add(agentIdB)
    this.adjacency.get(agentIdB)!.add(agentIdA)
  }

  setLoad(agentId: string, load: number): void {
    const reg = this.registrations.get(agentId)
    if (reg) reg.currentLoad = Math.max(0, Math.min(1, load))
  }

  route(task: Task, mechanism: AttentionMechanism = 'moe'): AttentionResult {
    const regs = [...this.registrations.values()]
    if (regs.length === 0) {
      return { selected: [], scores: new Map(), mechanism }
    }

    switch (mechanism) {
      case 'moe':
        return this.routeMoE(task, regs)
      case 'graph-rope':
        return this.routeGraphRoPE(task, regs)
      case 'multi-head':
        return this.routeMultiHead(task, regs)
      default:
        return this.routeMoE(task, regs)
    }
  }

  // -------------------------------------------------------------------------
  // MoE: cosine sim → load penalty → softmax → top-K
  // -------------------------------------------------------------------------

  private routeMoE(task: Task, regs: AgentRegistration[]): AttentionResult {
    const taskVec = this.taskToVector(task)
    const { topK, loadPenalty } = this.config

    const rawScores = regs.map((reg) => {
      const agentVec = this.agentToVector(reg)
      const rawScore = cosineSim(taskVec, agentVec)
      const score = rawScore * (1 - loadPenalty * reg.currentLoad)
      return { reg, score }
    })

    // Softmax
    const maxScore = Math.max(...rawScores.map((s) => s.score))
    const exps = rawScores.map((s) => ({ reg: s.reg, exp: Math.exp(s.score - maxScore) }))
    const sumExp = exps.reduce((s, e) => s + e.exp, 0)
    const softmaxed = exps.map((e) => ({ reg: e.reg, score: e.exp / sumExp }))

    // Top-K
    softmaxed.sort((a, b) => b.score - a.score)
    const selected = softmaxed.slice(0, topK)

    const scores = new Map<string, number>()
    for (const s of softmaxed) scores.set(s.reg.agent.id, s.score)

    return {
      selected: selected.map((s) => s.reg.agent),
      scores,
      mechanism: 'moe',
    }
  }

  // -------------------------------------------------------------------------
  // GraphRoPE: BFS distances + rotary positional encoding → cosine sim
  // -------------------------------------------------------------------------

  private routeGraphRoPE(task: Task, regs: AgentRegistration[]): AttentionResult {
    const taskVec = this.taskToVector(task)
    const { topK } = this.config

    // Pick root: prefer 'root' id, else first registration
    const allIds = regs.map((r) => r.agent.id)
    const rootId = allIds.find((id) => id === 'root') ?? allIds[0]!

    // BFS distances from root
    const distances = new Map<string, number>()
    const queue: string[] = [rootId]
    distances.set(rootId, 0)
    while (queue.length > 0) {
      const curr = queue.shift()!
      const dist = distances.get(curr)!
      for (const neighbor of (this.adjacency.get(curr) ?? [])) {
        if (!distances.has(neighbor)) {
          distances.set(neighbor, dist + 1)
          queue.push(neighbor)
        }
      }
    }

    const ropedScores = regs.map((reg) => {
      const agentVec = this.agentToVector(reg)
      const pos = distances.get(reg.agent.id) ?? regs.length
      const rotated = applyRotaryEncoding(agentVec, pos)
      const score = cosineSim(taskVec, rotated)
      return { reg, score }
    })

    ropedScores.sort((a, b) => b.score - a.score)
    const selected = ropedScores.slice(0, topK)

    const scores = new Map<string, number>()
    for (const s of ropedScores) scores.set(s.reg.agent.id, s.score)

    return {
      selected: selected.map((s) => s.reg.agent),
      scores,
      mechanism: 'graph-rope',
    }
  }

  // -------------------------------------------------------------------------
  // Multi-head: split vectors into heads, per-head cosine sim, average
  // -------------------------------------------------------------------------

  private routeMultiHead(task: Task, regs: AgentRegistration[]): AttentionResult {
    const taskVec = this.taskToVector(task)
    const { heads, topK } = this.config

    const chunkSize = Math.ceil(ATTN_MAX_DIM / heads)

    const multiHeadScores = regs.map((reg) => {
      const agentVec = this.agentToVector(reg)
      let totalSim = 0
      for (let h = 0; h < heads; h++) {
        const start = h * chunkSize
        const end = Math.min(start + chunkSize, ATTN_MAX_DIM)
        const taskChunk = taskVec.slice(start, end)
        const agentChunk = agentVec.slice(start, end)
        totalSim += cosineSim(taskChunk, agentChunk)
      }
      const avgSim = totalSim / heads
      return { reg, score: avgSim }
    })

    multiHeadScores.sort((a, b) => b.score - a.score)
    const selected = multiHeadScores.slice(0, topK)

    const scores = new Map<string, number>()
    for (const s of multiHeadScores) scores.set(s.reg.agent.id, s.score)

    return {
      selected: selected.map((s) => s.reg.agent),
      scores,
      mechanism: 'multi-head',
    }
  }

  // -------------------------------------------------------------------------
  // Vector helpers
  // -------------------------------------------------------------------------

  private taskToVector(task: Task): number[] {
    const text = task.description + ' ' + (task.domain?.join(' ') ?? '')
    return bagOfWords(text, ATTN_MAX_DIM)
  }

  private agentToVector(reg: AgentRegistration): number[] {
    const text = reg.domain.join(' ') + ' ' + reg.agent.capabilities.join(' ')
    return bagOfWords(text, ATTN_MAX_DIM)
  }
}

// ---------------------------------------------------------------------------
// Rotary positional encoding
// θ_i = pos / 10000^(2i/dim)
// (cos θ * v[2i] - sin θ * v[2i+1], sin θ * v[2i] + cos θ * v[2i+1])
// ---------------------------------------------------------------------------

function applyRotaryEncoding(vec: number[], pos: number): number[] {
  const result = [...vec]
  const dim = vec.length

  for (let i = 0; i + 1 < dim; i += 2) {
    const theta = pos / Math.pow(10000, (i / dim))
    const cosT = Math.cos(theta)
    const sinT = Math.sin(theta)
    const v0 = vec[i]!
    const v1 = vec[i + 1]!
    result[i] = cosT * v0 - sinT * v1
    result[i + 1] = sinT * v0 + cosT * v1
  }

  return result
}
