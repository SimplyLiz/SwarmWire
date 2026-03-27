/**
 * Router — maps tasks to agents and selects model tiers.
 * Picks the cheapest model that can handle the task.
 */

import type { Agent } from '../types/agent.js'
import type { ModelTier, Provider, ProviderModelInfo } from '../types/provider.js'
import type { ModelPreference, Budget } from '../types/budget.js'
import type { TaskScore } from '../types/task.js'

export interface RouteResult {
  provider: Provider
  model: string
  tier: ModelTier
  costPer1kTokens: number
}

/**
 * Select the best model for a given task score and budget.
 * Strategy: cheapest model at or above the recommended tier.
 */
export function routeModel(
  score: TaskScore,
  providers: Provider[],
  budget?: Budget,
): RouteResult | null {
  const targetTier = score.modelTier
  const preferences = budget?.modelPreferences

  // Collect all available models across providers
  const candidates: Array<{ provider: Provider; model: ProviderModelInfo }> = []
  for (const provider of providers) {
    for (const model of provider.models) {
      candidates.push({ provider, model })
    }
  }

  if (candidates.length === 0) return null

  // Filter by tier: accept target tier or higher
  const tierOrder: ModelTier[] = ['cheap', 'standard', 'premium', 'reasoning']
  const targetIdx = tierOrder.indexOf(targetTier)

  let eligible = candidates.filter((c) => tierOrder.indexOf(c.model.tier) >= targetIdx)

  // If preferences specify models for the target tier, prefer those
  if (preferences) {
    const pref = preferences.find((p) => p.tier === targetTier)
    if (pref) {
      const preferred = eligible.filter((c) => pref.models.includes(c.model.model))
      if (preferred.length > 0) eligible = preferred
    }
  }

  // If no eligible models at target tier, fall back to any available
  if (eligible.length === 0) eligible = candidates

  // Sort by cost (cheapest first)
  eligible.sort((a, b) => {
    const costA = a.model.inputCostPer1kTokens + a.model.outputCostPer1kTokens
    const costB = b.model.inputCostPer1kTokens + b.model.outputCostPer1kTokens
    return costA - costB
  })

  const best = eligible[0]!
  return {
    provider: best.provider,
    model: best.model.model,
    tier: best.model.tier,
    costPer1kTokens: best.model.inputCostPer1kTokens + best.model.outputCostPer1kTokens,
  }
}

/**
 * Match a task to the best available agent based on capabilities.
 */
export function matchAgent(
  requiredCapabilities: string[],
  agents: Agent[],
): Agent | null {
  if (agents.length === 0) return null
  if (requiredCapabilities.length === 0) return agents[0] ?? null

  // Score agents by capability overlap
  let bestAgent: Agent | null = null
  let bestScore = -1

  for (const agent of agents) {
    const overlap = requiredCapabilities.filter((c) => agent.capabilities.includes(c)).length
    const score = overlap / requiredCapabilities.length
    if (score > bestScore) {
      bestScore = score
      bestAgent = agent
    }
  }

  return bestAgent
}
