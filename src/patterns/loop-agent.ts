/**
 * LoopAgent — iterative self-improving agent primitive (Google ADK inspired).
 *
 * Runs an agent repeatedly until a termination condition is met:
 * quality threshold, max iterations, or explicit "done" signal from the agent.
 *
 * Pattern: execute → evaluate → refine → execute → ...
 */

import type { Agent } from '../types/agent.js'
import type { Provider, ModelConfig } from '../types/provider.js'
import type { Budget } from '../types/budget.js'
import type { ExecutionResult } from '../types/execution.js'
import type { SwarmEvent } from '../types/pattern.js'
import type { MessageBoard } from '../core/messageboard.js'
import { BudgetLedger } from '../budget/ledger.js'
import { buildAgentContext } from '../core/agent-context.js'

export interface LoopAgentConfig {
  /** The agent to run iteratively */
  agent: Agent
  /** Provider for LLM calls */
  provider: Provider
  /** Model configuration */
  model: ModelConfig
  /** Budget constraint */
  budget?: Budget
  /** Max loop iterations. Default 5 */
  maxIterations?: number
  /**
   * Termination condition. Return true to stop looping.
   * Receives current output and iteration count.
   * Default: stop when output contains "DONE" or when maxIterations reached.
   */
  shouldStop?: (output: unknown, iteration: number, input: unknown) => boolean | Promise<boolean>
  /**
   * Transform the output for the next iteration's input.
   * Default: pass output directly as next input.
   */
  refine?: (output: unknown, iteration: number) => unknown | Promise<unknown>
  /** Called after each iteration */
  onIteration?: (iteration: number, output: unknown) => void
}

export interface LoopResult<T = unknown> {
  output: T
  iterations: number
  converged: boolean
  history: Array<{ iteration: number; input: unknown; output: T }>
}

/**
 * Run an agent in a loop until convergence or max iterations.
 */
export async function runLoop<T = unknown>(
  input: unknown,
  config: LoopAgentConfig,
  _emitEvent?: (event: SwarmEvent) => void,
  _board?: MessageBoard,
): Promise<LoopResult<T>> {
  const maxIterations = config.maxIterations ?? 5
  const budget: Budget = config.budget ?? { maxCostCents: 100 }
  const ledger = new BudgetLedger(budget)

  const history: Array<{ iteration: number; input: unknown; output: T }> = []
  let currentInput = input
  let lastOutput: T | undefined

  for (let i = 1; i <= maxIterations; i++) {
    const ctx = buildAgentContext({
      executionId: `loop_${i}`,
      stepId: `step_${i}`,
      agent: config.agent,
      providers: [config.provider],
      defaultModel: config.model,
      ledger,
      board: _board,
    })

    const output = await config.agent.execute(currentInput, ctx) as T
    lastOutput = output

    history.push({ iteration: i, input: currentInput, output })
    config.onIteration?.(i, output)

    // Check termination
    const stop = config.shouldStop
      ? await Promise.resolve(config.shouldStop(output, i, currentInput))
      : defaultShouldStop(output)

    if (stop) {
      return { output, iterations: i, converged: true, history }
    }

    // Prepare next iteration input
    if (i < maxIterations) {
      currentInput = config.refine
        ? await Promise.resolve(config.refine(output, i))
        : output
    }
  }

  return {
    output: lastOutput as T,
    iterations: maxIterations,
    converged: false,
    history,
  }
}

function defaultShouldStop(output: unknown): boolean {
  const text = typeof output === 'string' ? output : JSON.stringify(output)
  return text.includes('DONE') || text.includes('[COMPLETE]')
}

/**
 * Build an ExecutionResult wrapper around a LoopResult.
 * Useful for composing LoopAgent output with other patterns.
 */
export function loopResultToExecution<T>(
  result: LoopResult<T>,
): Omit<ExecutionResult<T>, 'plan' | 'trace'> {
  return {
    output: result.output,
    partial: !result.converged,
    confidence: result.converged ? 1 : 0.5,
    evidence: [],
    agentOutputs: [],
    allResults: [],
    events: [],
    messages: [],
    cost: {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      totalCostCents: 0,
      totalLatencyMs: 0,
      budgetUsed: 0,
      perAgent: new Map(),
      perProvider: new Map(),
      savings: { promptCachingCents: 0, tierRoutingCents: 0, earlyStopCents: 0 },
    },
  }
}
