/**
 * Pipeline pattern.
 * Sequential stages — each agent's output feeds the next.
 */

import type { Task } from '../types/task.js'
import type { ExecutionResult } from '../types/execution.js'
import type { PipelineConfig } from '../types/pattern.js'
import type { Provider } from '../types/provider.js'
import type { Budget } from '../types/budget.js'
import type { SwarmEvent } from '../types/pattern.js'
import { buildPlan } from '../planner/planner.js'
import { executePlan } from '../executor/executor.js'

export async function runPipeline<T = unknown>(
  task: Task,
  config: PipelineConfig,
  providers: Provider[],
  budget: Budget,
  emitEvent?: (event: SwarmEvent) => void,
  board?: import('../core/messageboard.js').MessageBoard,
): Promise<ExecutionResult<T>> {
  const stages = config.stages
  if (stages.length === 0) throw new Error('pipeline requires at least one stage')

  const agents = stages.map((s) => s.agent)
  const plan = buildPlan(task, { agents, pattern: config })

  // Mark optional stages
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]!
    const step = plan.steps[i]
    if (step && stage.optional) {
      step.optional = true
    }
  }

  return executePlan<T>(plan, { providers, budget, emitEvent, board })
}
