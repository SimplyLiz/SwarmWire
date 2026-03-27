/**
 * MapReduce pattern.
 * Split input into chunks, process in parallel, reduce results.
 */

import type { Task } from '../types/task.js'
import type { ExecutionResult } from '../types/execution.js'
import type { MapReduceConfig, SwarmEvent } from '../types/pattern.js'
import type { Provider } from '../types/provider.js'
import type { Budget } from '../types/budget.js'
import type { Step } from '../types/plan.js'
import { executePlan } from '../executor/executor.js'

let stepCounter = 1000

export async function runMapReduce<T = unknown, TInput = unknown>(
  task: Task<TInput>,
  config: MapReduceConfig<TInput>,
  providers: Provider[],
  budget: Budget,
  emitEvent?: (event: SwarmEvent) => void,
  board?: import('../core/messageboard.js').MessageBoard,
): Promise<ExecutionResult<T>> {
  const chunks = config.mapper(task.input)
  const maxParallel = config.maxParallel ?? chunks.length

  // Build a plan with one step per chunk + a final reduce step
  const mapSteps: Step[] = chunks.map((chunk, _i) => ({
    id: `map_${++stepCounter}`,
    agent: config.worker,
    input: { type: 'literal' as const, value: chunk },
    dependencies: [],
    status: 'pending' as const,
  }))

  const reduceStep: Step = {
    id: `reduce_${++stepCounter}`,
    agent: config.reducer,
    input: {
      type: 'merged',
      sources: mapSteps.map((s) => ({ type: 'step_output' as const, stepId: s.id })),
    },
    dependencies: mapSteps.map((s) => s.id),
    status: 'pending',
  }

  const plan = {
    id: `plan_mr_${Date.now().toString(36)}`,
    task,
    steps: [...mapSteps, reduceStep],
    mode: 'swarm' as const,
    estimatedCost: {
      estimatedTokens: chunks.length * 5000 + 10000,
      estimatedCostCents: 0,
      estimatedLatencyMs: Math.ceil(chunks.length / maxParallel) * 3000,
      estimatedAgents: Math.min(chunks.length, maxParallel) + 1,
      confidence: 0.5,
    },
    status: 'draft' as const,
  }

  return executePlan<T>(plan, {
    providers, board,
    budget: { ...budget, maxAgents: maxParallel },
    emitEvent,
  })
}
