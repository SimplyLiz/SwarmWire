/**
 * Hierarchical Agent Authority pattern.
 * Formal authority levels with quality-threshold escalation.
 */

import type { Agent } from '../types/agent.js'
import type { Task } from '../types/task.js'
import type { ExecutionResult } from '../types/execution.js'
import type { Provider } from '../types/provider.js'
import type { Budget } from '../types/budget.js'
import type { SwarmEvent } from '../types/pattern.js'
import { buildPlan } from '../planner/planner.js'
import { executePlan } from '../executor/executor.js'
import type { MessageBoard } from '../core/messageboard.js'

export interface AuthorityLevel {
  name: string
  /** 1 = highest authority (CEO), N = lowest (worker) */
  authority: number
  agents: Agent[]
  canOverride?: boolean
}

export interface HierarchyConfig {
  levels: AuthorityLevel[]
  /** Max escalations before returning best-effort. Default 2 */
  maxEscalations?: number
  /** Confidence below this triggers escalation. Default 0.6 */
  escalationThreshold?: number
}

export interface AuthorityDecision {
  agentName: string
  authorityLevel: number
  output: unknown
  confidence: number
  overriddenBy?: string
}

export async function runHierarchy<T = unknown>(
  task: Task,
  config: HierarchyConfig,
  providers: Provider[],
  budget: Budget,
  emitEvent?: (event: SwarmEvent) => void,
  board?: MessageBoard,
): Promise<ExecutionResult<T>> {
  const { maxEscalations = 2, escalationThreshold = 0.6 } = config

  // Sort levels by authority — lowest authority number = highest power
  const levels = [...config.levels].sort((a, b) => b.authority - a.authority)
  // Start with highest authority number (workers)

  let currentResult: ExecutionResult<T> | undefined
  let escalations = 0

  for (let i = levels.length - 1; i >= 0 && escalations <= maxEscalations; i--) {
    const level = levels[i]!
    const agents = level.agents
    if (agents.length === 0) continue

    const plan = buildPlan(task, { agents })
    const result = await executePlan<T>(plan, {
      providers,
      budget,
      emitEvent,
      board,
    })

    currentResult = result

    // Check confidence — if above threshold, accept
    if (result.confidence >= escalationThreshold) {
      break
    }

    escalations++
    emitEvent?.({
      type: 'step:start',
      stepId: `escalation_${escalations}`,
      agentName: `hierarchy:${level.name}`,
    })
  }

  return currentResult ?? buildEmptyResult<T>(task)
}

function buildEmptyResult<T>(task: Task): ExecutionResult<T> {
  return {
    output: undefined as unknown as T,
    confidence: 0,
    evidence: [],
    agentOutputs: [],
    allResults: [],
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
    trace: { id: task.id, startedAt: 0, completedAt: 0, spans: [] },
    plan: {
      id: task.id,
      task,
      steps: [],
      mode: 'deep',
      estimatedCost: { estimatedTokens: 0, estimatedCostCents: 0, estimatedLatencyMs: 0, estimatedAgents: 0, confidence: 0 },
      status: 'failed',
    },
    partial: true,
    events: [],
    messages: [],
  }
}
