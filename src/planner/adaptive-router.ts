/**
 * Adaptive Router — learns from execution history which agents/models perform best.
 * Maintains a scoring table updated after each execution.
 */

import type { Agent } from '../types/agent.js'
import type { ModelTier } from '../types/provider.js'
import type { TaskScore } from '../types/task.js'

export interface ExecutionRecord {
  taskDomain: string[]
  taskDifficulty: string
  agentName: string
  model: string
  provider: string
  success: boolean
  costCents: number
  durationMs: number
  qualityScore: number
  timestamp: number
}

export interface AgentScore {
  agentName: string
  successRate: number
  avgCostCents: number
  avgDurationMs: number
  avgQuality: number
  totalExecutions: number
  score: number
}

/**
 * Adaptive router that learns from execution history.
 */
export class AdaptiveRouter {
  private history: ExecutionRecord[] = []
  private maxHistory: number

  constructor(maxHistory = 1000) {
    this.maxHistory = maxHistory
  }

  /** Record an execution result for learning. */
  record(entry: ExecutionRecord): void {
    this.history.push(entry)
    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }
  }

  /** Score agents for a given task profile. */
  scoreAgents(
    agents: Agent[],
    taskScore: TaskScore,
  ): AgentScore[] {
    return agents.map((agent) => {
      const relevant = this.history.filter((h) =>
        h.agentName === agent.name &&
        (h.taskDomain.some((d) => taskScore.domain.includes(d)) || taskScore.domain.includes('general'))
      )

      if (relevant.length === 0) {
        // No history — default score based on model tier
        return {
          agentName: agent.name,
          successRate: 0.5,
          avgCostCents: 0,
          avgDurationMs: 0,
          avgQuality: 0.5,
          totalExecutions: 0,
          score: tierBaseScore(agent.modelTier),
        }
      }

      const successRate = relevant.filter((r) => r.success).length / relevant.length
      const avgCostCents = relevant.reduce((s, r) => s + r.costCents, 0) / relevant.length
      const avgDurationMs = relevant.reduce((s, r) => s + r.durationMs, 0) / relevant.length
      const avgQuality = relevant.reduce((s, r) => s + r.qualityScore, 0) / relevant.length

      // Composite score: quality-weighted, cost-penalized, recency-boosted
      const recencyBoost = computeRecencyBoost(relevant)
      const score = (
        avgQuality * 0.4 +
        successRate * 0.3 +
        (1 - Math.min(1, avgCostCents / 100)) * 0.2 +
        recencyBoost * 0.1
      )

      return {
        agentName: agent.name,
        successRate,
        avgCostCents,
        avgDurationMs,
        avgQuality,
        totalExecutions: relevant.length,
        score,
      }
    }).sort((a, b) => b.score - a.score)
  }

  /** Pick the best agent for a task. */
  pickAgent(agents: Agent[], taskScore: TaskScore): Agent | null {
    if (agents.length === 0) return null
    const scores = this.scoreAgents(agents, taskScore)
    const bestName = scores[0]?.agentName
    return agents.find((a) => a.name === bestName) ?? agents[0] ?? null
  }

  /** Pick the best model tier based on historical cost/quality tradeoff. */
  recommendTier(taskScore: TaskScore): ModelTier {
    const relevant = this.history.filter((h) =>
      h.taskDifficulty === taskScore.difficulty
    )

    if (relevant.length < 5) return taskScore.modelTier

    // Group by rough tier (inferred from cost)
    const cheap = relevant.filter((r) => r.costCents < 5)
    const standard = relevant.filter((r) => r.costCents >= 5 && r.costCents < 50)
    const premium = relevant.filter((r) => r.costCents >= 50)

    const cheapQuality = avgQuality(cheap)
    const standardQuality = avgQuality(standard)
    const premiumQuality = avgQuality(premium)

    // If cheap tier achieves >80% of premium quality, recommend cheap
    if (cheapQuality > 0 && premiumQuality > 0 && cheapQuality / premiumQuality > 0.8) {
      return 'cheap'
    }
    if (standardQuality > 0 && premiumQuality > 0 && standardQuality / premiumQuality > 0.9) {
      return 'standard'
    }

    return taskScore.modelTier
  }

  /** Get execution history stats. */
  stats(): { totalRecords: number; domains: string[]; avgQuality: number; avgCostCents: number } {
    const domains = [...new Set(this.history.flatMap((h) => h.taskDomain))]
    return {
      totalRecords: this.history.length,
      domains,
      avgQuality: avgQuality(this.history),
      avgCostCents: this.history.length > 0
        ? this.history.reduce((s, r) => s + r.costCents, 0) / this.history.length
        : 0,
    }
  }
}

function tierBaseScore(tier: ModelTier): number {
  switch (tier) {
    case 'cheap': return 0.4
    case 'standard': return 0.6
    case 'premium': return 0.8
    case 'reasoning': return 0.9
  }
}

function computeRecencyBoost(records: ExecutionRecord[]): number {
  if (records.length === 0) return 0
  const latest = Math.max(...records.map((r) => r.timestamp))
  const hoursSinceLatest = (Date.now() - latest) / (1000 * 60 * 60)
  return Math.max(0, 1 - hoursSinceLatest / 168) // Decay over 1 week
}

function avgQuality(records: ExecutionRecord[]): number {
  if (records.length === 0) return 0
  return records.reduce((s, r) => s + r.qualityScore, 0) / records.length
}
