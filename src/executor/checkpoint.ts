/**
 * Checkpoint — serialize/restore plan execution state.
 * Enables resume after failure or interruption.
 */

import type { Plan, Step, StepStatus } from '../types/plan.js'
import type { CostEvent } from '../types/budget.js'

export interface Checkpoint {
  id: string
  planId: string
  createdAt: number
  stepStates: StepSnapshot[]
  stepOutputs: Map<string, unknown>
  costEvents: CostEvent[]
}

export interface StepSnapshot {
  stepId: string
  status: StepStatus
  output?: unknown
  error?: string
  cost?: CostEvent
}

/**
 * Create a checkpoint from the current plan state.
 */
export function createCheckpoint(
  plan: Plan,
  stepOutputs: Map<string, unknown>,
  costEvents: CostEvent[],
): Checkpoint {
  return {
    id: `ckpt_${Date.now().toString(36)}`,
    planId: plan.id,
    createdAt: Date.now(),
    stepStates: plan.steps.map((step) => ({
      stepId: step.id,
      status: step.status,
      output: step.output,
      error: step.error,
      cost: step.cost,
    })),
    stepOutputs: new Map(stepOutputs),
    costEvents: [...costEvents],
  }
}

/**
 * Restore a plan to a checkpointed state.
 * Completed steps are preserved; pending/running steps are reset to pending.
 */
export function restoreFromCheckpoint(plan: Plan, checkpoint: Checkpoint): {
  plan: Plan
  stepOutputs: Map<string, unknown>
  costEvents: CostEvent[]
} {
  for (const snap of checkpoint.stepStates) {
    const step = plan.steps.find((s) => s.id === snap.stepId)
    if (!step) continue

    if (snap.status === 'complete') {
      step.status = 'complete'
      step.output = snap.output
      step.cost = snap.cost
    } else if (snap.status === 'failed' || snap.status === 'skipped') {
      // Reset failed/skipped to pending for retry
      step.status = 'pending'
      step.output = undefined
      step.error = undefined
    } else {
      step.status = 'pending'
    }
  }

  return {
    plan,
    stepOutputs: new Map(checkpoint.stepOutputs),
    costEvents: [...checkpoint.costEvents],
  }
}

/**
 * Serialize a checkpoint to JSON-compatible format.
 */
export function serializeCheckpoint(checkpoint: Checkpoint): string {
  return JSON.stringify({
    ...checkpoint,
    stepOutputs: Object.fromEntries(checkpoint.stepOutputs),
  })
}

/**
 * Deserialize a checkpoint from JSON string.
 */
export function deserializeCheckpoint(json: string): Checkpoint {
  const data = JSON.parse(json)
  return {
    ...data,
    stepOutputs: new Map(Object.entries(data.stepOutputs)),
  }
}
