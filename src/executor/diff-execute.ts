/**
 * Differential Execution — only re-run steps whose inputs changed.
 * Turns expensive full re-runs into cheap incremental updates.
 */

import type { Plan, Step } from '../types/plan.js'
import type { ExecutionResult } from '../types/execution.js'
import { createHash } from 'node:crypto'

export interface DiffResult {
  /** Steps that need re-execution (inputs changed) */
  changedSteps: string[]
  /** Steps that can be reused from previous result */
  reusableSteps: string[]
  /** Steps that must re-run because a dependency changed */
  cascadeSteps: string[]
  /** Estimated savings (fraction of work avoided) */
  savingsFraction: number
}

/**
 * Diff two plans and determine which steps need re-execution.
 */
export function diffPlans(newPlan: Plan, previousResult: ExecutionResult): DiffResult {
  const prevSteps = previousResult.plan.steps
  const prevOutputs = new Map<string, unknown>()
  for (const step of prevSteps) {
    if (step.status === 'complete') prevOutputs.set(step.id, step.output)
  }

  const changedSteps: string[] = []
  const reusableSteps: string[] = []
  const cascadeSteps: string[] = []

  // Phase 1: identify directly changed steps
  for (const step of newPlan.steps) {
    const prevStep = prevSteps.find((s) => s.id === step.id)
    if (!prevStep) {
      changedSteps.push(step.id)
      continue
    }

    const inputHash = hashInput(step.input)
    const prevInputHash = hashInput(prevStep.input)

    if (inputHash !== prevInputHash) {
      changedSteps.push(step.id)
    } else if (prevStep.status === 'complete') {
      reusableSteps.push(step.id)
    } else {
      changedSteps.push(step.id)
    }
  }

  // Phase 2: cascade — if a dependency changed, dependents must re-run
  const allChanged = new Set(changedSteps)
  let cascadePass = true
  while (cascadePass) {
    cascadePass = false
    for (const step of newPlan.steps) {
      if (allChanged.has(step.id)) continue
      if (step.dependencies.some((d) => allChanged.has(d))) {
        allChanged.add(step.id)
        cascadeSteps.push(step.id)
        // Remove from reusable
        const idx = reusableSteps.indexOf(step.id)
        if (idx >= 0) reusableSteps.splice(idx, 1)
        cascadePass = true
      }
    }
  }

  const totalSteps = newPlan.steps.length
  const savingsFraction = totalSteps > 0 ? reusableSteps.length / totalSteps : 0

  return { changedSteps, reusableSteps, cascadeSteps, savingsFraction }
}

/**
 * Apply previous results to a new plan — mark reusable steps as complete.
 */
export function applyPreviousResults(plan: Plan, previousResult: ExecutionResult, diff: DiffResult): void {
  for (const stepId of diff.reusableSteps) {
    const step = plan.steps.find((s) => s.id === stepId)
    const prevStep = previousResult.plan.steps.find((s) => s.id === stepId)
    if (step && prevStep && prevStep.status === 'complete') {
      step.status = 'complete'
      step.output = prevStep.output
      step.cost = prevStep.cost
    }
  }
}

function hashInput(input: unknown): string {
  const str = JSON.stringify(input)
  return createHash('sha256').update(str).digest('hex').slice(0, 16)
}
