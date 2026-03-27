/**
 * BudgetLedger — tracks and enforces cost constraints.
 * Hard limits. Not advisory.
 */

import type { Budget, BudgetUsage, CostEvent, CostSummary, CostSavings, AgentCostSummary, ProviderCostSummary } from '../types/budget.js'
import type { SwarmEvent } from '../types/pattern.js'

export class BudgetLedger {
  private events: CostEvent[] = []
  private startedAt: number
  private warningFired = false
  private exhaustedFired = false

  constructor(
    private readonly budget: Budget,
    private readonly emitEvent?: (event: SwarmEvent) => void,
  ) {
    this.startedAt = performance.now()
  }

  /** Record a cost event from an agent call. Returns false if budget is exhausted. */
  record(event: CostEvent): boolean {
    this.events.push(event)
    const usage = this.usage()

    if (!this.warningFired && usage.warning) {
      this.warningFired = true
      this.emitEvent?.({ type: 'budget:warning', usage: usage.cost.fraction || usage.tokens.fraction })
    }

    if (!this.exhaustedFired && usage.exhausted) {
      this.exhaustedFired = true
      this.emitEvent?.({ type: 'budget:exhausted' })
    }

    return !usage.exhausted
  }

  /** Check if a proposed operation would exceed the budget. */
  canAfford(estimatedTokens: number, estimatedCostCents: number): boolean {
    const usage = this.usage()
    if (usage.exhausted) return false

    if (this.budget.maxTokens !== undefined) {
      if (usage.tokens.used + estimatedTokens > this.budget.maxTokens) return false
    }
    if (this.budget.maxCostCents !== undefined) {
      if (usage.cost.usedCents + estimatedCostCents > this.budget.maxCostCents) return false
    }
    if (this.budget.maxLatencyMs !== undefined) {
      if (this.elapsedMs() > this.budget.maxLatencyMs) return false
    }
    return true
  }

  /** Get current budget usage snapshot. */
  usage(): BudgetUsage {
    const totalTokens = this.events.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0)
    const totalCostCents = this.events.reduce((s, e) => s + e.costCents, 0)
    const elapsedMs = this.elapsedMs()

    const tokenFraction = this.budget.maxTokens !== undefined
      ? (this.budget.maxTokens === 0 ? Infinity : totalTokens / this.budget.maxTokens) : 0
    const costFraction = this.budget.maxCostCents !== undefined
      ? (this.budget.maxCostCents === 0 ? Infinity : totalCostCents / this.budget.maxCostCents) : 0
    const latencyFraction = this.budget.maxLatencyMs !== undefined
      ? (this.budget.maxLatencyMs === 0 ? Infinity : elapsedMs / this.budget.maxLatencyMs) : 0

    const maxFraction = Math.max(tokenFraction, costFraction, latencyFraction)
    const warningAt = this.budget.warningAt ?? 0.8

    return {
      tokens: { used: totalTokens, limit: this.budget.maxTokens, fraction: tokenFraction },
      cost: { usedCents: totalCostCents, limitCents: this.budget.maxCostCents, fraction: costFraction },
      latency: { elapsedMs, limitMs: this.budget.maxLatencyMs, fraction: latencyFraction },
      agents: { active: 0, limit: this.budget.maxAgents },
      exhausted: tokenFraction >= 1 || costFraction >= 1 || latencyFraction >= 1,
      warning: maxFraction >= warningAt,
    }
  }

  /** Get remaining budget for a sub-allocation. */
  remaining(): Budget {
    const usage = this.usage()
    return {
      maxTokens: this.budget.maxTokens !== undefined
        ? Math.max(0, this.budget.maxTokens - usage.tokens.used)
        : undefined,
      maxCostCents: this.budget.maxCostCents !== undefined
        ? Math.max(0, this.budget.maxCostCents - usage.cost.usedCents)
        : undefined,
      maxLatencyMs: this.budget.maxLatencyMs !== undefined
        ? Math.max(0, this.budget.maxLatencyMs - usage.latency.elapsedMs)
        : undefined,
      maxAgents: this.budget.maxAgents,
      modelPreferences: this.budget.modelPreferences,
    }
  }

  /** Build the final cost summary. */
  summarize(): CostSummary {
    const perAgent = new Map<string, AgentCostSummary>()
    const perProvider = new Map<string, ProviderCostSummary>()

    let totalTokens = 0
    let inputTokens = 0
    let outputTokens = 0
    let cachedInputTokens = 0
    let totalCostCents = 0

    for (const e of this.events) {
      totalTokens += e.inputTokens + e.outputTokens
      inputTokens += e.inputTokens
      outputTokens += e.outputTokens
      cachedInputTokens += e.cachedInputTokens
      totalCostCents += e.costCents

      // Per agent
      const agentKey = e.agentName
      const existing = perAgent.get(agentKey)
      if (existing) {
        existing.tokens += e.inputTokens + e.outputTokens
        existing.costCents += e.costCents
        existing.calls++
      } else {
        perAgent.set(agentKey, {
          tokens: e.inputTokens + e.outputTokens,
          costCents: e.costCents,
          calls: 1,
        })
      }

      // Per provider
      const provKey = e.provider
      const existingProv = perProvider.get(provKey)
      if (existingProv) {
        existingProv.tokens += e.inputTokens + e.outputTokens
        existingProv.costCents += e.costCents
        if (e.cachedInputTokens > 0) existingProv.cacheHits++
      } else {
        perProvider.set(provKey, {
          tokens: e.inputTokens + e.outputTokens,
          costCents: e.costCents,
          cacheHits: e.cachedInputTokens > 0 ? 1 : 0,
        })
      }
    }

    const budgetUsed = this.budget.maxCostCents
      ? totalCostCents / this.budget.maxCostCents
      : this.budget.maxTokens
        ? totalTokens / this.budget.maxTokens
        : 0

    const savings: CostSavings = {
      promptCachingCents: 0,
      tierRoutingCents: 0,
      earlyStopCents: 0,
    }

    return {
      totalTokens,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      totalCostCents,
      totalLatencyMs: this.elapsedMs(),
      budgetUsed,
      perAgent,
      perProvider,
      savings,
    }
  }

  private elapsedMs(): number {
    return performance.now() - this.startedAt
  }
}
