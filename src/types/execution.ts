/**
 * Execution — results, traces, and conflicts from running a plan.
 */

import type { AgentOutput } from './agent.js'
import type { CostSummary } from './budget.js'
import type { Plan } from './plan.js'

export interface ExecutionResult<T = unknown> {
  output: T
  confidence: number
  evidence: EvidenceRef[]
  /** Successful agent outputs only (backwards compatible) */
  agentOutputs: AgentOutput[]
  /** All agent results including failures and skips */
  allResults: AgentOutput[]
  conflicts?: Conflict[]
  cost: CostSummary
  trace: ExecutionTrace
  plan: Plan
  partial: boolean
  /** All events emitted during execution (for post-execution replay) */
  events: import('../types/pattern.js').SwarmEvent[]
}

export interface EvidenceRef {
  source: string
  agentId: string
  stepId: string
  content: string
  relevance: number
}

export interface Conflict {
  id: string
  type: 'contradiction' | 'disagreement' | 'ambiguity'
  agentIds: string[]
  stepIds: string[]
  description: string
  outputs: unknown[]
  resolution?: ConflictResolution
}

export interface ConflictResolution {
  method: 'vote' | 'evidence_weight' | 'escalate' | 'manual'
  winner?: string
  reasoning?: string
  confidence: number
}

export interface ExecutionTrace {
  id: string
  startedAt: number
  completedAt: number
  spans: TraceSpan[]
}

export interface TraceSpan {
  id: string
  parentId?: string
  name: string
  type: 'plan' | 'step' | 'llm_call' | 'tool_call' | 'merge' | 'conflict'
  startedAt: number
  completedAt: number
  durationMs: number
  attributes: Record<string, unknown>
  costCents?: number
  tokens?: number
  status: 'ok' | 'error'
  error?: string
}
