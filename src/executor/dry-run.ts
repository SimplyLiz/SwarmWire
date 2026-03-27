/**
 * Dry-run — simulate execution without calling LLMs.
 * Estimates cost, duration, and token usage from the plan graph.
 */

import type { Plan, Step } from '../types/plan.js'
import type { Provider } from '../types/provider.js'
import { estimateTokens } from '../context/packer.js'

export interface DryRunResult {
  estimatedCost: { minCents: number; maxCents: number; likelyCents: number }
  estimatedDuration: { minMs: number; maxMs: number; likelyMs: number }
  tokenBudget: { inputTokens: number; outputTokens: number; totalTokens: number }
  stepBreakdown: StepEstimate[]
  totalSteps: number
  parallelSteps: number
  sequentialDepth: number
  willExceedBudget: boolean
}

export interface StepEstimate {
  stepId: string
  agentName: string
  estimatedInputTokens: number
  estimatedOutputTokens: number
  estimatedCostCents: { min: number; max: number; likely: number }
  estimatedDurationMs: { min: number; max: number; likely: number }
  tier: string
}

/**
 * Simulate plan execution and project costs.
 *
 * Key insight: input tokens can be estimated precisely (we know prompts + context).
 * Output tokens are estimated from model tier and task complexity.
 */
export function dryRun(plan: Plan, providers: Provider[]): DryRunResult {
  const steps = plan.steps
  const breakdown: StepEstimate[] = []

  let totalInputTokens = 0
  let totalOutputTokens = 0

  for (const step of steps) {
    const agentName = 'name' in step.agent ? step.agent.name : '?'
    const tier = 'modelTier' in step.agent ? (step.agent as { modelTier: string }).modelTier : 'standard'
    const model = 'model' in step.agent ? (step.agent as { model?: { model: string } }).model?.model : undefined

    // Estimate input tokens from step input
    const inputText = estimateInputText(step)
    const inputTokens = estimateTokens(inputText)

    // Estimate output tokens based on tier
    const outputMultiplier = tier === 'cheap' ? 0.3 : tier === 'premium' ? 1.5 : tier === 'reasoning' ? 2.0 : 0.8
    const outputTokens = Math.ceil(inputTokens * outputMultiplier)

    // Find provider cost
    const costPerToken = findCostPerToken(model, providers)
    const likelyCost = (inputTokens / 1000) * costPerToken.input + (outputTokens / 1000) * costPerToken.output
    const minCost = likelyCost * 0.5
    const maxCost = likelyCost * 2.0

    // Estimate latency (rough: 50ms/1k tokens for cheap, 100ms for standard, 200ms for premium)
    const latencyPer1k = tier === 'cheap' ? 50 : tier === 'premium' ? 200 : tier === 'reasoning' ? 300 : 100
    const likelyDuration = ((inputTokens + outputTokens) / 1000) * latencyPer1k
    const minDuration = likelyDuration * 0.5
    const maxDuration = likelyDuration * 2.0

    totalInputTokens += inputTokens
    totalOutputTokens += outputTokens

    breakdown.push({
      stepId: step.id,
      agentName,
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: outputTokens,
      estimatedCostCents: { min: round(minCost), max: round(maxCost), likely: round(likelyCost) },
      estimatedDurationMs: { min: round(minDuration), max: round(maxDuration), likely: round(likelyDuration) },
      tier,
    })
  }

  // Compute parallel depth for duration estimation
  const { parallelSteps, sequentialDepth } = computeParallelism(steps)

  const totalLikelyCost = breakdown.reduce((s, b) => s + b.estimatedCostCents.likely, 0)
  const totalLikelyDuration = breakdown.reduce((s, b) => s + b.estimatedDurationMs.likely, 0)
  // Parallel steps overlap — adjust duration by parallelism factor
  const parallelFactor = sequentialDepth / Math.max(1, steps.length)
  const adjustedDuration = totalLikelyDuration * parallelFactor

  const willExceedBudget = plan.task.budget.maxCostCents !== undefined
    ? totalLikelyCost > plan.task.budget.maxCostCents
    : false

  return {
    estimatedCost: {
      minCents: round(totalLikelyCost * 0.5),
      maxCents: round(totalLikelyCost * 2.0),
      likelyCents: round(totalLikelyCost),
    },
    estimatedDuration: {
      minMs: round(adjustedDuration * 0.5),
      maxMs: round(adjustedDuration * 2.0),
      likelyMs: round(adjustedDuration),
    },
    tokenBudget: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
    },
    stepBreakdown: breakdown,
    totalSteps: steps.length,
    parallelSteps,
    sequentialDepth,
    willExceedBudget,
  }
}

function estimateInputText(step: Step): string {
  if (step.input.type === 'literal') return JSON.stringify(step.input.value)
  if (step.input.type === 'task_input') return 'task input placeholder (~500 chars typical'
  return 'step reference (~1000 chars typical for merged context'
}

function findCostPerToken(model: string | undefined, providers: Provider[]): { input: number; output: number } {
  if (!model) return { input: 3.0, output: 15.0 } // Default: standard tier pricing
  for (const p of providers) {
    const info = p.models.find((m) => m.model === model)
    if (info) return { input: info.inputCostPer1kTokens, output: info.outputCostPer1kTokens }
  }
  return { input: 3.0, output: 15.0 }
}

function computeParallelism(steps: Step[]): { parallelSteps: number; sequentialDepth: number } {
  const depths = new Map<string, number>()
  let maxDepth = 0

  for (const step of steps) {
    const depth = step.dependencies.length === 0
      ? 0
      : Math.max(0, ...step.dependencies.map((d) => (depths.get(d) ?? 0) + 1))
    depths.set(step.id, depth)
    maxDepth = Math.max(maxDepth, depth)
  }

  const depthCounts = new Map<number, number>()
  for (const d of depths.values()) {
    depthCounts.set(d, (depthCounts.get(d) ?? 0) + 1)
  }

  const parallelSteps = Math.max(0, ...depthCounts.values())
  return { parallelSteps, sequentialDepth: maxDepth + 1 }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
