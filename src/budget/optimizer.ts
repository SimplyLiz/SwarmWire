/**
 * Cost Optimizer — analyzes execution history and suggests savings.
 */

import type { ExecutionResult } from '../types/execution.js'
import type { CostSummary } from '../types/budget.js'

export interface CostRecommendation {
  type: 'tier_downgrade' | 'caching' | 'early_stop' | 'agent_removal' | 'consolidation'
  description: string
  estimatedSavingsCents: number
  confidence: number
  agentName?: string
  currentTier?: string
  suggestedTier?: string
}

/**
 * Analyze an execution result and suggest cost optimizations.
 */
export function analyzeCosts(result: ExecutionResult): CostRecommendation[] {
  const recommendations: CostRecommendation[] = []

  recommendations.push(...findTierDowngrades(result))
  recommendations.push(...findLowValueAgents(result))
  recommendations.push(...findCachingOpportunities(result))
  recommendations.push(...findEarlyStopCandidates(result))

  return recommendations.sort((a, b) => b.estimatedSavingsCents - a.estimatedSavingsCents)
}

/**
 * Analyze multiple executions for patterns.
 */
export function analyzeHistory(results: ExecutionResult[]): CostRecommendation[] {
  if (results.length < 3) return []

  const recommendations: CostRecommendation[] = []

  // Find consistently expensive agents across runs
  const agentCosts = new Map<string, number[]>()
  for (const r of results) {
    for (const [name, cost] of r.cost.perAgent) {
      const existing = agentCosts.get(name) ?? []
      existing.push(cost.costCents)
      agentCosts.set(name, existing)
    }
  }

  for (const [name, costs] of agentCosts) {
    const avgCost = costs.reduce((s, c) => s + c, 0) / costs.length
    const totalCostAvg = results.reduce((s, r) => s + r.cost.totalCostCents, 0) / results.length

    // If one agent consistently takes >50% of budget
    if (avgCost > totalCostAvg * 0.5 && costs.length >= 3) {
      recommendations.push({
        type: 'consolidation',
        description: `Agent "${name}" consistently uses ${((avgCost / totalCostAvg) * 100).toFixed(0)}% of total budget. Consider splitting its workload or using a cheaper model.`,
        estimatedSavingsCents: avgCost * 0.3,
        confidence: 0.7,
        agentName: name,
      })
    }
  }

  return recommendations
}

function findTierDowngrades(result: ExecutionResult): CostRecommendation[] {
  const recs: CostRecommendation[] = []

  for (const output of result.agentOutputs) {
    // Heuristic: if agent completed successfully with low token usage, it might work with a cheaper model
    if (output.cost.totalTokens < 2000 && output.cost.costCents > 5) {
      recs.push({
        type: 'tier_downgrade',
        description: `Agent "${output.agentName}" used only ${output.cost.totalTokens} tokens but cost ${output.cost.costCents.toFixed(1)}¢. A cheaper model tier might suffice.`,
        estimatedSavingsCents: output.cost.costCents * 0.6,
        confidence: 0.6,
        agentName: output.agentName,
      })
    }
  }

  return recs
}

function findLowValueAgents(result: ExecutionResult): CostRecommendation[] {
  const recs: CostRecommendation[] = []

  // If an agent's output wasn't used by any downstream step (not the final step)
  const plan = result.plan
  if (plan.steps.length <= 1) return recs

  for (const step of plan.steps) {
    if (step.status !== 'complete') continue
    const agentName = 'name' in step.agent ? step.agent.name : '?'

    // Check if any other step depends on this one
    const isDepended = plan.steps.some((s) => s.dependencies.includes(step.id) && s.status === 'complete')
    const isLast = step === plan.steps[plan.steps.length - 1]

    if (!isDepended && !isLast && step.cost) {
      recs.push({
        type: 'agent_removal',
        description: `Agent "${agentName}" (step ${step.id}) completed but no downstream step used its output. Consider removing it.`,
        estimatedSavingsCents: step.cost.costCents,
        confidence: 0.5,
        agentName,
      })
    }
  }

  return recs
}

function findCachingOpportunities(result: ExecutionResult): CostRecommendation[] {
  const recs: CostRecommendation[] = []

  // Check for high cached input token ratio — suggests prompt caching is working
  const cachedRatio = result.cost.cachedInputTokens / Math.max(1, result.cost.inputTokens)
  if (cachedRatio < 0.1 && result.cost.inputTokens > 5000) {
    recs.push({
      type: 'caching',
      description: `Only ${(cachedRatio * 100).toFixed(0)}% of input tokens were cached. Using prompt caching could save up to ${(result.cost.totalCostCents * 0.3).toFixed(1)}¢.`,
      estimatedSavingsCents: result.cost.totalCostCents * 0.3,
      confidence: 0.5,
    })
  }

  return recs
}

function findEarlyStopCandidates(result: ExecutionResult): CostRecommendation[] {
  const recs: CostRecommendation[] = []

  // If multiple agents produced very similar outputs, could stop after the first
  if (result.agentOutputs.length >= 3) {
    const outputs = result.agentOutputs.map((o) => JSON.stringify(o.output))
    const unique = new Set(outputs)

    if (unique.size < outputs.length * 0.5) {
      const duplicateCost = result.cost.totalCostCents * (1 - unique.size / outputs.length)
      recs.push({
        type: 'early_stop',
        description: `${outputs.length - unique.size} agents produced duplicate outputs. Adding convergence detection could save ${duplicateCost.toFixed(1)}¢.`,
        estimatedSavingsCents: duplicateCost,
        confidence: 0.7,
      })
    }
  }

  return recs
}
