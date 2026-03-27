/**
 * Pattern — composable orchestration patterns.
 */

import type { Agent } from './agent.js'
import type { Budget } from './budget.js'
import type { ExecutionResult } from './execution.js'
import type { Task } from './task.js'

export type PatternName =
  | 'orchestrator-worker'
  | 'pipeline'
  | 'map-reduce'
  | 'debate'
  | 'blackboard'
  | 'adaptive'

export type MergeStrategy = 'consensus' | 'weighted' | 'synthesizer_final' | MergeFn
export type ConflictStrategy = 'vote' | 'evidence_weight' | 'escalate'

export type MergeFn = (outputs: unknown[]) => Promise<unknown>

export interface PatternConfig {
  pattern: PatternName
  agents?: Agent[]
  budget?: Budget
  mergeStrategy?: MergeStrategy
  conflictResolution?: ConflictStrategy
}

export interface OrchestratorWorkerConfig extends PatternConfig {
  pattern: 'orchestrator-worker'
  agents: Agent[]
  mergeStrategy?: MergeStrategy
  conflictResolution?: ConflictStrategy
}

export interface PipelineConfig extends PatternConfig {
  pattern: 'pipeline'
  stages: PipelineStage[]
}

export interface PipelineStage {
  name: string
  agent: Agent
  optional?: boolean
}

export interface MapReduceConfig<TInput = unknown> extends PatternConfig {
  pattern: 'map-reduce'
  mapper: (input: TInput) => unknown[]
  worker: Agent
  reducer: Agent
  maxParallel?: number
}

export interface DebateConfig extends PatternConfig {
  pattern: 'debate'
  proponents: Agent[]
  judge: Agent
  rounds?: number
  convergenceThreshold?: number
}

export interface Pattern {
  readonly name: PatternName
  execute<T>(task: Task, config: PatternConfig, runtime: PatternRuntime): Promise<ExecutionResult<T>>
}

export interface PatternRuntime {
  runAgent<T>(agent: Agent, input: unknown, stepId: string): Promise<T>
  budget: Budget
  emitEvent(event: SwarmEvent): void
}

export type SwarmEvent =
  | { type: 'step:start'; stepId: string; agentName: string }
  | { type: 'step:complete'; stepId: string; agentName: string; durationMs: number; costCents: number }
  | { type: 'step:error'; stepId: string; agentName: string; error: string }
  | { type: 'budget:warning'; usage: number }
  | { type: 'budget:exhausted' }
  | { type: 'conflict:detected'; conflict: string }
  | { type: 'plan:created'; planId: string; steps: number }
  | { type: 'execution:complete'; durationMs: number; costCents: number }
