/**
 * Time-Travel Debugging — rewind plan execution to any step and fork from there.
 */

import type { Plan, Step } from '../types/plan.js'
import type { ExecutionResult } from '../types/execution.js'
import type { ExecutorConfig } from './executor.js'
import { createCheckpoint, restoreFromCheckpoint, type Checkpoint } from './checkpoint.js'
import { executePlan } from './executor.js'
import type { CostEvent } from '../types/budget.js'

export interface TimelineEntry {
  stepId: string
  stepName: string
  checkpoint: Checkpoint
  capturedAt: number
}

export interface ForkOptions {
  fromStepId: string
  /** Override specific steps before re-executing from the fork point. */
  modifications?: Partial<Step>[]
}

export interface ForkResult<T> {
  execution: ExecutionResult<T>
  forkedFromStep: string
  divergedAt: number
}

export class TimeTravelStore {
  private readonly timelines: Map<string, TimelineEntry[]> = new Map()
  private readonly maxHistory: number

  constructor(maxHistory = 100) {
    this.maxHistory = maxHistory
  }

  record(
    planId: string,
    stepId: string,
    stepName: string,
    plan: Plan,
    outputs: Map<string, unknown>,
    costEvents: CostEvent[],
  ): void {
    const checkpoint = createCheckpoint(plan, outputs, costEvents)
    const entry: TimelineEntry = { stepId, stepName, checkpoint, capturedAt: Date.now() }

    const timeline = this.timelines.get(planId) ?? []
    timeline.push(entry)

    // Cap to maxHistory
    if (timeline.length > this.maxHistory) {
      timeline.shift()
    }

    this.timelines.set(planId, timeline)
  }

  getTimeline(planId: string): TimelineEntry[] {
    return this.timelines.get(planId) ?? []
  }

  rewindTo(planId: string, stepId: string): Checkpoint | null {
    const timeline = this.timelines.get(planId) ?? []
    // Find the last entry recorded at or before the requested step
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (timeline[i]!.stepId === stepId) {
        return timeline[i]!.checkpoint
      }
    }
    return null
  }

  async fork<T = unknown>(
    planId: string,
    options: ForkOptions,
    plan: Plan,
    config: ExecutorConfig,
  ): Promise<ForkResult<T>> {
    const checkpoint = this.rewindTo(planId, options.fromStepId)
    if (!checkpoint) {
      throw new Error(`No checkpoint found for step "${options.fromStepId}" in plan "${planId}"`)
    }

    // Deep-clone the plan
    const cloned = deepClonePlan(plan)

    // Apply any step modifications
    if (options.modifications) {
      for (const mod of options.modifications) {
        if (!mod.id) continue
        const step = cloned.steps.find((s) => s.id === mod.id)
        if (step) Object.assign(step, mod)
      }
    }

    // Restore completed steps from checkpoint
    restoreFromCheckpoint(cloned, checkpoint)

    // Re-execute from fork point
    const execution = await executePlan<T>(cloned, config)

    return {
      execution,
      forkedFromStep: options.fromStepId,
      divergedAt: Date.now(),
    }
  }

  clear(planId: string): void {
    this.timelines.delete(planId)
  }

  export(): Record<string, TimelineEntry[]> {
    return Object.fromEntries(this.timelines)
  }

  import(data: Record<string, TimelineEntry[]>): void {
    for (const [planId, entries] of Object.entries(data)) {
      this.timelines.set(planId, entries)
    }
  }
}

function deepClonePlan(plan: Plan): Plan {
  return JSON.parse(JSON.stringify(plan)) as Plan
}
