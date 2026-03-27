/**
 * Fan-Out pattern — same input, N agents, all parallel, collect results.
 * Promise.allSettled for agents, with budget tracking.
 */

import type { Agent } from '../types/agent.js'
import type { Task } from '../types/task.js'
import type { ExecutionResult } from '../types/execution.js'
import type { SwarmEvent } from '../types/pattern.js'
import type { Provider } from '../types/provider.js'
import type { Budget } from '../types/budget.js'
import type { Step } from '../types/plan.js'
import { executePlan } from '../executor/executor.js'

export interface FanOutConfig {
  /** Agents to run in parallel */
  agents: Agent[]
  /** Input for all agents. If not set, uses task.input */
  input?: unknown
  /** If true, individual agent failures don't fail the batch. Default true */
  optional?: boolean
  budget?: Budget
}

export async function runFanOut<T = unknown>(
  task: Task,
  config: FanOutConfig,
  providers: Provider[],
  budget: Budget,
  emitEvent?: (event: SwarmEvent) => void,
  board?: import('../core/messageboard.js').MessageBoard,
): Promise<ExecutionResult<T[]>> {
  const { agents, optional = true } = config
  if (agents.length === 0) throw new Error('fan-out requires at least one agent')

  const inputValue = config.input ?? task.input

  const steps: Step[] = agents.map((agent, i) => ({
    id: `fanout_${i}`,
    agent,
    input: { type: 'literal' as const, value: inputValue },
    dependencies: [],
    optional,
    status: 'pending' as const,
  }))

  const plan = {
    id: `plan_fanout_${Date.now().toString(36)}`,
    task,
    steps,
    mode: 'swarm' as const,
    estimatedCost: {
      estimatedTokens: agents.length * 5000,
      estimatedCostCents: 0,
      estimatedLatencyMs: 3000,
      estimatedAgents: agents.length,
      confidence: 0.5,
    },
    status: 'draft' as const,
  }

  const result = await executePlan<T[]>(plan, {
    providers, board,
    budget: { ...budget, ...config.budget },
    emitEvent,
  })

  // Override output: collect all successful agent outputs as array
  const outputs = result.agentOutputs.map((o) => o.output as T)
  return { ...result, output: outputs }
}
