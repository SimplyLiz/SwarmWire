/**
 * Budget — first-class cost constraint.
 * Every operation has a budget. Hard enforcement, not advisory.
 */

import type { ModelTier } from './provider.js'

export interface Budget {
  /** Hard cap on total tokens across all agents */
  maxTokens?: number
  /** Hard cap on total cost in cents */
  maxCostCents?: number
  /** Wall-clock deadline in milliseconds */
  maxLatencyMs?: number
  /** Max concurrent agents */
  maxAgents?: number
  /** Fraction (0-1) at which to fire warning event */
  warningAt?: number
  /** Model preferences per tier */
  modelPreferences?: ModelPreference[]
}

export interface ModelPreference {
  tier: ModelTier
  models: string[]
  maxCostPer1kTokens?: number
}

export interface BudgetEstimate {
  estimatedTokens: number
  estimatedCostCents: number
  estimatedLatencyMs: number
  estimatedAgents: number
  confidence: number
}

export interface BudgetUsage {
  tokens: { used: number; limit?: number; fraction: number }
  cost: { usedCents: number; limitCents?: number; fraction: number }
  latency: { elapsedMs: number; limitMs?: number; fraction: number }
  agents: { active: number; limit?: number }
  exhausted: boolean
  warning: boolean
}

export interface CostEvent {
  timestamp: number
  agentId: string
  agentName: string
  stepId?: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  costCents: number
  durationMs: number
}

export interface CostSummary {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  totalCostCents: number
  totalLatencyMs: number
  budgetUsed: number
  perAgent: Map<string, AgentCostSummary>
  perProvider: Map<string, ProviderCostSummary>
  savings: CostSavings
}

export interface AgentCostSummary {
  tokens: number
  costCents: number
  calls: number
}

export interface ProviderCostSummary {
  tokens: number
  costCents: number
  cacheHits: number
}

export interface CostSavings {
  promptCachingCents: number
  tierRoutingCents: number
  earlyStopCents: number
}

export function emptyBudgetUsage(): BudgetUsage {
  return {
    tokens: { used: 0, fraction: 0 },
    cost: { usedCents: 0, fraction: 0 },
    latency: { elapsedMs: 0, fraction: 0 },
    agents: { active: 0 },
    exhausted: false,
    warning: false,
  }
}
