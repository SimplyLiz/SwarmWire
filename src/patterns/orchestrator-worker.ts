/**
 * Orchestrator-Worker pattern.
 * Central orchestrator decomposes task, delegates to workers, merges results.
 * ~70% of production MAS deployments use this.
 */

import type { Agent } from '../types/agent.js'
import type { Task } from '../types/task.js'
import type { ExecutionResult } from '../types/execution.js'
import type { OrchestratorWorkerConfig, PatternRuntime, MergeStrategy } from '../types/pattern.js'
import type { Plan } from '../types/plan.js'
import { buildPlan } from '../planner/planner.js'
import { executePlan } from '../executor/executor.js'
import type { Provider } from '../types/provider.js'
import type { Budget } from '../types/budget.js'

export async function runOrchestratorWorker<T = unknown>(
  task: Task,
  config: OrchestratorWorkerConfig,
  providers: Provider[],
  budget: Budget,
  emitEvent?: (event: import('../types/pattern.js').SwarmEvent) => void,
): Promise<ExecutionResult<T>> {
  const agents = config.agents
  if (agents.length === 0) throw new Error('orchestrator-worker requires at least one agent')

  const plan = buildPlan(task, { agents, pattern: config })

  return executePlan<T>(plan, { providers, budget, emitEvent })
}
