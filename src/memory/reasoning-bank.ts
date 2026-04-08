/**
 * ReasoningBank — RETRIEVE→JUDGE→DISTILL→CONSOLIDATE reasoning pipeline.
 * Stores agent trajectories, evaluates quality, retrieves via MMR, and distills patterns.
 */

export interface Trajectory {
  id: string
  task: string
  steps: string[]
  outcome: string
  success: boolean
  durationMs: number
  costCents: number
  agentId?: string
  createdAt: number
  qualityScore?: number
  embedding?: number[]
}

export interface Pattern {
  id: string
  strategy: string
  successRate: number
  keyLearnings: string[]
  sourceTrajectoryIds: string[]
  createdAt: number
}

export interface RetrievalResult {
  trajectory: Trajectory
  relevance: number
  diversityScore: number
  rank: number
}

export interface ReasoningBankConfig {
  maxSize?: number
  mmrLambda?: number
  dedupThreshold?: number
  maxAgeDays?: number
  embedFn?: (text: string) => number[]
}

// ---------------------------------------------------------------------------
// Default bag-of-words embedding — vocabulary built lazily across all calls
// ---------------------------------------------------------------------------

const vocabulary: Map<string, number> = new Map()
const MAX_VOCAB = 256

function updateVocab(words: string[]): void {
  for (const w of words) {
    if (!vocabulary.has(w) && vocabulary.size < MAX_VOCAB) {
      vocabulary.set(w, vocabulary.size)
    }
  }
}

function extractWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0)
}

function defaultEmbedFn(text: string): number[] {
  const words = extractWords(text)
  updateVocab(words)

  const vec = new Array<number>(MAX_VOCAB).fill(0)
  for (const w of words) {
    const idx = vocabulary.get(w)
    if (idx !== undefined) {
      vec[idx]!++
    }
  }

  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
  if (norm === 0) return vec
  return vec.map((v) => v / norm)
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

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
// ReasoningBank
// ---------------------------------------------------------------------------

let idCounter = 0
function nextId(): string {
  return `traj_${++idCounter}_${Date.now().toString(36)}`
}

let patternCounter = 0
function nextPatternId(): string {
  return `pat_${++patternCounter}_${Date.now().toString(36)}`
}

export class ReasoningBank {
  private trajectories: Trajectory[] = []
  private patterns: Pattern[] = []
  private embedFn: (text: string) => number[]
  private maxSize: number
  private mmrLambda: number
  private dedupThreshold: number
  private maxAgeDays: number

  constructor(config: Partial<ReasoningBankConfig> = {}) {
    this.embedFn = config.embedFn ?? defaultEmbedFn
    this.maxSize = config.maxSize ?? 1000
    this.mmrLambda = config.mmrLambda ?? 0.6
    this.dedupThreshold = config.dedupThreshold ?? 0.95
    this.maxAgeDays = config.maxAgeDays ?? 90
  }

  async store(
    t: Omit<Trajectory, 'id' | 'qualityScore' | 'embedding' | 'createdAt'>,
  ): Promise<Trajectory> {
    // JUDGE: compute quality score
    const nonEmptySteps = t.steps.filter((s) => s.trim().length > 0).length
    const coherenceScore = t.steps.length > 0 ? (nonEmptySteps / t.steps.length) * 0.3 : 0
    const lengthScore = Math.min(1, t.steps.length / 10) * 0.3
    const completionScore = t.success ? 0.4 : 0.1
    const qualityScore = lengthScore + coherenceScore + completionScore

    // Embed the task description
    const embedding = this.embedFn(t.task + ' ' + t.outcome)

    const traj: Trajectory = {
      ...t,
      id: nextId(),
      qualityScore,
      embedding,
      createdAt: Date.now(),
    }

    this.trajectories.push(traj)

    // Evict if over capacity
    if (this.trajectories.length > this.maxSize) {
      this.trajectories.sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))
      this.trajectories = this.trajectories.slice(0, this.maxSize)
    }

    return traj
  }

  /**
   * Retrieve top-k trajectories using Maximal Marginal Relevance (MMR).
   */
  async retrieve(query: string, k = 5): Promise<RetrievalResult[]> {
    if (this.trajectories.length === 0) return []

    const queryEmb = this.embedFn(query)
    const λ = this.mmrLambda

    // Compute cosine similarity to query for all trajectories
    const simToQuery = this.trajectories.map((t) => ({
      traj: t,
      sim: t.embedding ? cosineSim(queryEmb, t.embedding) : 0,
    }))

    const candidates = [...simToQuery]
    const selected: Array<{ traj: Trajectory; sim: number }> = []

    const actualK = Math.min(k, candidates.length)

    for (let rank = 0; rank < actualK; rank++) {
      let bestIdx = -1
      let bestScore = -Infinity

      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i]!

        // Max similarity to already-selected trajectories
        let maxSimToSelected = 0
        for (const sel of selected) {
          const s = cand.traj.embedding && sel.traj.embedding
            ? cosineSim(cand.traj.embedding, sel.traj.embedding)
            : 0
          if (s > maxSimToSelected) maxSimToSelected = s
        }

        const score = λ * cand.sim - (1 - λ) * maxSimToSelected

        if (score > bestScore) {
          bestScore = score
          bestIdx = i
        }
      }

      if (bestIdx === -1) break

      const chosen = candidates[bestIdx]!
      selected.push(chosen)
      candidates.splice(bestIdx, 1)
    }

    return selected.map((s, i) => ({
      trajectory: s.traj,
      relevance: s.sim,
      diversityScore: 1 - s.sim, // crude diversity approximation
      rank: i,
    }))
  }

  /**
   * Distill patterns from stored trajectories by grouping on task prefix.
   */
  distill(): Pattern[] {
    const groups = new Map<string, Trajectory[]>()

    for (const t of this.trajectories) {
      // Group by first 30 chars of task as a simple clustering key
      const key = t.task.slice(0, 30).trim().toLowerCase()
      const existing = groups.get(key) ?? []
      existing.push(t)
      groups.set(key, existing)
    }

    const newPatterns: Pattern[] = []

    for (const [key, trajs] of groups.entries()) {
      const successRate = trajs.filter((t) => t.success).length / trajs.length

      // Deduplicate steps across trajectories
      const allSteps = trajs.flatMap((t) => t.steps)
      const keyLearnings = [...new Set(allSteps)].filter((s) => s.trim().length > 0).slice(0, 10)

      const pattern: Pattern = {
        id: nextPatternId(),
        strategy: key,
        successRate,
        keyLearnings,
        sourceTrajectoryIds: trajs.map((t) => t.id),
        createdAt: Date.now(),
      }
      newPatterns.push(pattern)
    }

    this.patterns = newPatterns
    return newPatterns
  }

  /**
   * Consolidate trajectories: merge near-duplicates, prune old entries.
   */
  consolidate(): { merged: number; pruned: number } {
    let merged = 0
    let pruned = 0

    const maxAgeMs = this.maxAgeDays * 24 * 60 * 60 * 1000
    const now = Date.now()

    // Prune old entries
    const before = this.trajectories.length
    this.trajectories = this.trajectories.filter((t) => now - t.createdAt < maxAgeMs)
    pruned = before - this.trajectories.length

    // Pairwise dedup — O(n²), acceptable for small banks
    const toRemove = new Set<string>()

    for (let i = 0; i < this.trajectories.length; i++) {
      if (toRemove.has(this.trajectories[i]!.id)) continue
      for (let j = i + 1; j < this.trajectories.length; j++) {
        if (toRemove.has(this.trajectories[j]!.id)) continue

        const a = this.trajectories[i]!
        const b = this.trajectories[j]!

        if (a.embedding && b.embedding && cosineSim(a.embedding, b.embedding) >= this.dedupThreshold) {
          // Keep the higher quality one
          const toKeep = (a.qualityScore ?? 0) >= (b.qualityScore ?? 0) ? a : b
          const toDrop = toKeep.id === a.id ? b : a
          toRemove.add(toDrop.id)
          merged++
        }
      }
    }

    this.trajectories = this.trajectories.filter((t) => !toRemove.has(t.id))

    return { merged, pruned }
  }

  listPatterns(): Pattern[] {
    return [...this.patterns]
  }

  stats(): { trajectoryCount: number; patternCount: number; avgQuality: number } {
    const avgQuality =
      this.trajectories.length === 0
        ? 0
        : this.trajectories.reduce((s, t) => s + (t.qualityScore ?? 0), 0) / this.trajectories.length

    return {
      trajectoryCount: this.trajectories.length,
      patternCount: this.patterns.length,
      avgQuality,
    }
  }
}
