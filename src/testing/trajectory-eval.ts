/**
 * Trajectory Evaluation (TRACE-inspired) — assess multi-step agent trajectories
 * rather than just final outputs.
 *
 * Evaluates: step efficiency, tool use correctness, backtracking rate,
 * plan adherence, and outcome quality.
 *
 * Reference: TRACE framework for process-level LLM evaluation.
 */

import type { EvalResult, EvalContext } from './evals.js'

export interface TrajectoryStep {
  stepId: string
  stepName: string
  agentName: string
  input: unknown
  output: unknown
  toolCalls: Array<{ toolName: string; input: unknown; output: unknown; durationMs: number }>
  durationMs: number
  tokenCount: number
  error?: string
  retried?: boolean
}

export interface Trajectory {
  id: string
  goal: string
  steps: TrajectoryStep[]
  finalOutput: unknown
  success: boolean
  totalTokens: number
  totalDurationMs: number
}

export interface TrajectoryEvalResult extends EvalResult {
  breakdown: {
    stepEfficiency: number
    toolPrecision: number
    backtrackRate: number
    planAdherence: number
    outcomeQuality: number
  }
}

export interface TrajectoryEvalConfig {
  /**
   * Expected step names in order (if known). Used for plan-adherence scoring.
   * Leave empty to skip adherence check.
   */
  expectedSteps?: string[]
  /**
   * Known-good tool calls: { stepId → expected tool names }.
   * Used to score tool precision.
   */
  expectedToolCalls?: Record<string, string[]>
  /**
   * Outcome scorer — given final output, returns 0-1 quality score.
   * If absent, binary: 1 if trajectory.success, 0 otherwise.
   */
  outcomeScorer?: (output: unknown, context?: EvalContext) => number | Promise<number>
  /**
   * Max allowed steps. Steps beyond this reduce efficiency score.
   * Defaults to trajectory.steps.length (no penalty).
   */
  maxSteps?: number
  /**
   * Weights for each dimension. Default: equal.
   */
  weights?: {
    stepEfficiency?: number
    toolPrecision?: number
    backtrackRate?: number
    planAdherence?: number
    outcomeQuality?: number
  }
}

/**
 * Evaluate a single trajectory across five dimensions.
 */
export async function evalTrajectory(
  trajectory: Trajectory,
  config: TrajectoryEvalConfig = {},
  context?: EvalContext,
): Promise<TrajectoryEvalResult> {
  const weights = normalizeWeights(config.weights)

  // 1. Step efficiency: ratio of expected steps to actual steps
  const maxSteps = config.maxSteps ?? trajectory.steps.length
  const stepEfficiency = maxSteps === 0 ? 1 : Math.min(1, maxSteps / Math.max(1, trajectory.steps.length))

  // 2. Tool precision: fraction of tool calls that match expected
  const toolPrecision = scoreToolPrecision(trajectory, config.expectedToolCalls)

  // 3. Backtrack rate: fraction of steps that were retried (lower is better)
  const retriedCount = trajectory.steps.filter((s) => s.retried).length
  const backtrackRate = 1 - retriedCount / Math.max(1, trajectory.steps.length)

  // 4. Plan adherence: longest common subsequence of step names vs expected
  const planAdherence = scorePlanAdherence(trajectory.steps.map((s) => s.stepName), config.expectedSteps)

  // 5. Outcome quality
  let outcomeQuality: number
  if (config.outcomeScorer) {
    outcomeQuality = await Promise.resolve(config.outcomeScorer(trajectory.finalOutput, context))
  } else {
    outcomeQuality = trajectory.success ? 1 : 0
  }

  const breakdown = { stepEfficiency, toolPrecision, backtrackRate, planAdherence, outcomeQuality }

  const score =
    breakdown.stepEfficiency * weights.stepEfficiency +
    breakdown.toolPrecision * weights.toolPrecision +
    breakdown.backtrackRate * weights.backtrackRate +
    breakdown.planAdherence * weights.planAdherence +
    breakdown.outcomeQuality * weights.outcomeQuality

  return {
    evalName: 'trajectory',
    score: Math.min(1, Math.max(0, score)),
    passed: score >= 0.5,
    details: JSON.stringify(breakdown),
    breakdown,
  }
}

export interface TrajectoryCompareResult {
  better: 'a' | 'b' | 'tie'
  scoreA: number
  scoreB: number
  delta: number
  breakdown: {
    dimension: string
    scoreA: number
    scoreB: number
  }[]
}

/**
 * Compare two trajectories — useful for A/B evaluation of agent strategies.
 */
export async function compareTrajectories(
  a: Trajectory,
  b: Trajectory,
  config: TrajectoryEvalConfig = {},
): Promise<TrajectoryCompareResult> {
  const [evalA, evalB] = await Promise.all([
    evalTrajectory(a, config),
    evalTrajectory(b, config),
  ])

  const delta = evalA.score - evalB.score
  const better: 'a' | 'b' | 'tie' = Math.abs(delta) < 0.01 ? 'tie' : delta > 0 ? 'a' : 'b'

  const dims = Object.keys(evalA.breakdown) as Array<keyof typeof evalA.breakdown>

  return {
    better,
    scoreA: evalA.score,
    scoreB: evalB.score,
    delta,
    breakdown: dims.map((d) => ({
      dimension: d,
      scoreA: evalA.breakdown[d],
      scoreB: evalB.breakdown[d],
    })),
  }
}

// ─── Helpers ───

function scoreToolPrecision(
  trajectory: Trajectory,
  expectedToolCalls?: Record<string, string[]>,
): number {
  if (!expectedToolCalls || Object.keys(expectedToolCalls).length === 0) return 1

  let correct = 0
  let total = 0

  for (const [stepId, expectedTools] of Object.entries(expectedToolCalls)) {
    const step = trajectory.steps.find((s) => s.stepId === stepId)
    if (!step) continue

    const actualTools = step.toolCalls.map((tc) => tc.toolName)
    for (const expected of expectedTools) {
      total++
      if (actualTools.includes(expected)) correct++
    }
  }

  return total === 0 ? 1 : correct / total
}

function scorePlanAdherence(actual: string[], expected?: string[]): number {
  if (!expected || expected.length === 0) return 1

  // LCS length
  const m = actual.length
  const n = expected.length
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (actual[i - 1] === expected[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!)
      }
    }
  }

  const lcs = dp[m]![n]!
  return lcs / Math.max(1, expected.length)
}

type ResolvedWeights = {
  stepEfficiency: number
  toolPrecision: number
  backtrackRate: number
  planAdherence: number
  outcomeQuality: number
}

function normalizeWeights(w?: TrajectoryEvalConfig['weights']): ResolvedWeights {
  const raw = {
    stepEfficiency: w?.stepEfficiency ?? 1,
    toolPrecision: w?.toolPrecision ?? 1,
    backtrackRate: w?.backtrackRate ?? 1,
    planAdherence: w?.planAdherence ?? 1,
    outcomeQuality: w?.outcomeQuality ?? 1,
  }
  const sum = Object.values(raw).reduce((s, v) => s + v, 0)
  return {
    stepEfficiency: raw.stepEfficiency / sum,
    toolPrecision: raw.toolPrecision / sum,
    backtrackRate: raw.backtrackRate / sum,
    planAdherence: raw.planAdherence / sum,
    outcomeQuality: raw.outcomeQuality / sum,
  }
}
