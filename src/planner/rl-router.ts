/**
 * RL Router — Double DQN (tabular) + PPO (simplified tabular actor-critic) for model selection.
 */

import type { Task } from '../types/task.js'
import { analyzeTaskComplexity, calculateComplexityScore, defaultModelRoutingConfig } from './model-router.js'

export type RLAction = 'cheap' | 'standard' | 'premium' | 'reasoning'
const ALL_ACTIONS: RLAction[] = ['cheap', 'standard', 'premium', 'reasoning']

export interface RLState {
  complexity: number  // 0-1
  domain: number      // 0-7
  length: number      // 0 | 1 | 2
}

export interface Experience {
  state: RLState
  action: RLAction
  reward: number
  nextState: RLState
  done: boolean
}

export interface RLRouterConfig {
  alpha?: number             // Learning rate. Default 0.1
  gamma?: number             // Discount factor. Default 0.9
  epsilon?: number           // Initial exploration rate. Default 1.0
  epsilonMin?: number        // Minimum epsilon. Default 0.05
  epsilonDecay?: number      // Decay per step. Default 0.01
  targetSyncSteps?: number   // Steps between target network syncs. Default 10
  replayBufferSize?: number  // Max replay buffer size. Default 500
}

export interface RLRouterStats {
  stateCount: number
  epsilon: number
  updateCount: number
  avgReward: number
}

function stateKey(s: RLState): string {
  return `${s.complexity.toFixed(1)}:${s.domain}:${s.length}`
}

function domainHash(task: Task): number {
  const desc = task.description.toLowerCase()
  const domains = ['code', 'data', 'text', 'math', 'security', 'design', 'test', 'ops']
  for (let i = 0; i < domains.length; i++) {
    if (desc.includes(domains[i]!)) return i
  }
  // Hash first word to 0-7
  const first = desc.split(/\s+/)[0] ?? ''
  let h = 0
  for (const c of first) h = (h * 31 + c.charCodeAt(0)) & 0xff
  return h % 8
}

export class RLRouter {
  private qTable: Map<string, Map<RLAction, number>> = new Map()
  private targetTable: Map<string, Map<RLAction, number>> = new Map()
  private replayBuffer: Experience[] = []
  private config: Required<RLRouterConfig>
  private epsilon: number
  private updateCount = 0
  private totalReward = 0

  constructor(config: Partial<RLRouterConfig> = {}) {
    this.config = {
      alpha: config.alpha ?? 0.1,
      gamma: config.gamma ?? 0.9,
      epsilon: config.epsilon ?? 1.0,
      epsilonMin: config.epsilonMin ?? 0.05,
      epsilonDecay: config.epsilonDecay ?? 0.01,
      targetSyncSteps: config.targetSyncSteps ?? 10,
      replayBufferSize: config.replayBufferSize ?? 500,
    }
    this.epsilon = this.config.epsilon
  }

  private getQ(table: Map<string, Map<RLAction, number>>, key: string): Map<RLAction, number> {
    if (!table.has(key)) {
      table.set(key, new Map(ALL_ACTIONS.map((a) => [a, 0])))
    }
    return table.get(key)!
  }

  selectAction(state: RLState): RLAction {
    const key = stateKey(state)
    let action: RLAction

    if (Math.random() < this.epsilon) {
      // Explore
      action = ALL_ACTIONS[Math.floor(Math.random() * ALL_ACTIONS.length)]!
    } else {
      // Exploit — greedy from online Q-table
      const qRow = this.getQ(this.qTable, key)
      let bestAction = ALL_ACTIONS[0]!
      let bestQ = -Infinity
      for (const [a, q] of qRow.entries()) {
        if (q > bestQ) { bestQ = q; bestAction = a }
      }
      action = bestAction
    }

    // Decay epsilon
    this.epsilon = Math.max(this.config.epsilonMin, this.epsilon - this.config.epsilonDecay)

    return action
  }

  update(experience: Experience): void {
    this.replayBuffer.push(experience)
    if (this.replayBuffer.length >= this.config.replayBufferSize) {
      this.replayBuffer.shift()
    }

    const { state, action, reward, nextState } = experience
    const key = stateKey(state)
    const nextKey = stateKey(nextState)

    // Double DQN TD update:
    // argmax_a' Q_online(s', a')
    const nextQOnline = this.getQ(this.qTable, nextKey)
    let bestNextAction = ALL_ACTIONS[0]!
    let bestNextQ = -Infinity
    for (const [a, q] of nextQOnline.entries()) {
      if (q > bestNextQ) { bestNextQ = q; bestNextAction = a }
    }

    // Q_target(s', best_a')
    const nextQTarget = this.getQ(this.targetTable, nextKey)
    const targetQ = nextQTarget.get(bestNextAction) ?? 0

    const currentQRow = this.getQ(this.qTable, key)
    const currentQ = currentQRow.get(action) ?? 0
    const newQ = currentQ + this.config.alpha * (reward + this.config.gamma * targetQ - currentQ)
    currentQRow.set(action, newQ)

    this.totalReward += reward
    this.updateCount++

    // Sync target network periodically
    if (this.updateCount % this.config.targetSyncSteps === 0) {
      this.syncTargetNetwork()
    }
  }

  private syncTargetNetwork(): void {
    for (const [k, v] of this.qTable) {
      this.targetTable.set(k, new Map(v))
    }
  }

  static computeReward(quality: number, costCents: number): number {
    // High quality, low cost = good reward
    return quality - costCents * 0.01
  }

  static stateFromTask(task: Task): RLState {
    const indicators = analyzeTaskComplexity(task, defaultModelRoutingConfig)
    const complexity = calculateComplexityScore(indicators, defaultModelRoutingConfig)
    const domain = domainHash(task)
    const len = task.description.length
    const length = len < 200 ? 0 : len < 600 ? 1 : 2

    return { complexity, domain, length }
  }

  stats(): RLRouterStats {
    return {
      stateCount: this.qTable.size,
      epsilon: this.epsilon,
      updateCount: this.updateCount,
      avgReward: this.updateCount > 0 ? this.totalReward / this.updateCount : 0,
    }
  }

  exportState(): Record<string, Record<RLAction, number>> {
    const out: Record<string, Record<RLAction, number>> = {}
    for (const [k, v] of this.qTable.entries()) {
      out[k] = Object.fromEntries(v) as Record<RLAction, number>
    }
    return out
  }

  importState(state: Record<string, Record<RLAction, number>>): void {
    this.qTable.clear()
    for (const [k, row] of Object.entries(state)) {
      this.qTable.set(k, new Map(Object.entries(row) as [RLAction, number][]))
    }
    this.syncTargetNetwork()
  }
}

// ---------------------------------------------------------------------------
// PPO — simplified tabular actor-critic
// ---------------------------------------------------------------------------

export class RLRouterPPO {
  private policy: Map<string, Map<RLAction, number>> = new Map() // logits
  private valueBaseline: Map<string, { mean: number; count: number }> = new Map()
  private config: Required<Pick<RLRouterConfig, 'alpha' | 'gamma'>> & { lam?: number }

  constructor(config: Partial<RLRouterConfig & { lam?: number }> = {}) {
    this.config = {
      alpha: config.alpha ?? 0.05,
      gamma: config.gamma ?? 0.9,
      lam: config.lam ?? 0.95,
    }
  }

  private getLogits(key: string): Map<RLAction, number> {
    if (!this.policy.has(key)) {
      this.policy.set(key, new Map(ALL_ACTIONS.map((a) => [a, 0])))
    }
    return this.policy.get(key)!
  }

  private softmax(logits: Map<RLAction, number>): Map<RLAction, number> {
    const vals = [...logits.values()]
    const maxVal = Math.max(...vals)
    const exps = new Map<RLAction, number>()
    let sum = 0
    for (const [a, l] of logits.entries()) {
      const e = Math.exp(l - maxVal)
      exps.set(a, e)
      sum += e
    }
    const probs = new Map<RLAction, number>()
    for (const [a, e] of exps.entries()) {
      probs.set(a, e / sum)
    }
    return probs
  }

  selectAction(state: RLState): RLAction {
    const key = stateKey(state)
    const logits = this.getLogits(key)
    const probs = this.softmax(logits)

    // Sample from distribution
    const r = Math.random()
    let cumulative = 0
    for (const [action, prob] of probs.entries()) {
      cumulative += prob
      if (r <= cumulative) return action
    }
    return ALL_ACTIONS[ALL_ACTIONS.length - 1]!
  }

  private getValue(key: string): number {
    return this.valueBaseline.get(key)?.mean ?? 0
  }

  private updateValue(key: string, target: number): void {
    const entry = this.valueBaseline.get(key) ?? { mean: 0, count: 0 }
    entry.count++
    entry.mean += (target - entry.mean) / entry.count
    this.valueBaseline.set(key, entry)
  }

  update(trajectory: Experience[]): void {
    if (trajectory.length === 0) return
    const γ = this.config.gamma
    const λ = this.config.lam ?? 0.95
    const α = this.config.alpha

    // Compute GAE advantages
    const advantages: number[] = new Array(trajectory.length).fill(0)
    let gae = 0

    for (let t = trajectory.length - 1; t >= 0; t--) {
      const exp = trajectory[t]!
      const key = stateKey(exp.state)
      const nextKey = stateKey(exp.nextState)

      const vt = this.getValue(key)
      const vt1 = exp.done ? 0 : this.getValue(nextKey)

      const delta = exp.reward + γ * vt1 - vt
      gae = delta + γ * λ * gae
      advantages[t] = gae
    }

    // Policy gradient update + value update
    for (let t = 0; t < trajectory.length; t++) {
      const exp = trajectory[t]!
      const key = stateKey(exp.state)
      const adv = advantages[t]!

      // Update logit for taken action
      const logits = this.getLogits(key)
      const currentLogit = logits.get(exp.action) ?? 0
      logits.set(exp.action, currentLogit + α * adv)

      // Update value baseline (running mean)
      const returnEst = exp.reward + γ * (exp.done ? 0 : this.getValue(stateKey(exp.nextState)))
      this.updateValue(key, returnEst)
    }
  }

  stats(): { stateCount: number; avgBaseline: number } {
    const values = [...this.valueBaseline.values()]
    const avgBaseline = values.length > 0
      ? values.reduce((s, v) => s + v.mean, 0) / values.length
      : 0
    return { stateCount: this.policy.size, avgBaseline }
  }
}
