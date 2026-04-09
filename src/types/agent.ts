/**
 * Agent — the unit of work in a swarm.
 * Wraps an LLM call with a role, tools, and constraints.
 */

import type { Budget } from './budget.js'
import type { Tool } from './tool.js'
import type { ModelConfig, ModelTier, ResponseFormat } from './provider.js'
import type { GuardrailConfig } from '../core/guardrails.js'

export interface AgentContext<TDeps = Record<string, unknown>> {
  /** Unique execution ID */
  executionId: string
  /** Budget remaining for this agent's step */
  budgetRemaining: Budget
  /** Call an LLM with a prompt — returns string */
  llm(prompt: string, opts?: LlmCallOptions): Promise<string>
  /** Call an LLM with structured output — returns parsed T, tracked by budget ledger */
  llm<T>(prompt: string, opts: LlmCallOptions & { responseFormat: ResponseFormat }): Promise<T>
  /** Call a registered tool */
  tool<T = unknown>(name: string, input: unknown): Promise<T>
  /** Emit a trace event */
  trace(event: string, data?: unknown): void
  /** Access shared context from prior steps */
  getStepOutput<T = unknown>(stepId: string): T | undefined
  /** MessageBoard for inter-agent communication */
  board: AgentBoard
  /**
   * Typed dependency injection — services, repositories, or clients available
   * to this agent. Declared in AgentDefinition<TInput, TOutput, TDeps>.
   */
  deps: TDeps
}

/** Agent's view of the MessageBoard — scoped to their identity */
export interface AgentBoard {
  /** Post a message to other agents or broadcast */
  post(to: string | '*', content: string, options?: {
    channel?: string
    priority?: 'normal' | 'high' | 'urgent'
    type?: 'finding' | 'warning' | 'question' | 'answer' | 'coordination' | 'status' | 'custom'
    data?: unknown
  }): void
  /** Read messages addressed to this agent (marks as read) */
  read(filter?: { type?: string; from?: string; channel?: string; unreadOnly?: boolean }): Array<{
    id: string; from: string; content: string; type: string; data?: unknown; timestamp: number
  }>
  /** Get unread messages */
  inbox(): Array<{ id: string; from: string; content: string; type: string; data?: unknown; timestamp: number }>
  /** Get all findings from other agents */
  findings(): Array<{ from: string; content: string; data?: unknown }>
  /** Get all warnings from other agents */
  warnings(): Array<{ from: string; content: string; data?: unknown }>
  /** Reply to a question */
  reply(questionId: string, content: string, data?: unknown): void
}

export interface LlmCallOptions {
  model?: ModelConfig
  maxTokens?: number
  temperature?: number
  systemPrompt?: string
  /** Structured output — model must respond with JSON matching this schema. Returns parsed object. */
  responseFormat?: ResponseFormat
}

export interface AgentDefinition<TInput = unknown, TOutput = unknown, TDeps = Record<string, unknown>> {
  name: string
  role: string
  capabilities?: string[]
  tools?: Tool[]
  model?: ModelConfig
  modelTier?: ModelTier
  systemPrompt?: string
  maxTokens?: number
  maxCostCents?: number
  timeoutMs?: number
  guardrails?: GuardrailConfig
  /**
   * Typed dependencies injected into context.deps at execution time.
   * Declare the shape here; provide the values when constructing via createAgent().
   */
  deps?: TDeps
  execute?: (input: TInput, context: AgentContext<TDeps>) => Promise<TOutput>
}

export interface Agent<TInput = unknown, TOutput = unknown, TDeps = Record<string, unknown>> {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly capabilities: string[]
  readonly tools: Tool[]
  readonly model?: ModelConfig
  readonly modelTier: ModelTier
  readonly systemPrompt?: string
  readonly maxTokens?: number
  readonly maxCostCents?: number
  readonly timeoutMs?: number
  readonly guardrails?: GuardrailConfig
  readonly deps: TDeps
  execute(input: TInput, context: AgentContext<TDeps>): Promise<TOutput>
}

export type AgentResultStatus = 'completed' | 'failed' | 'skipped'

export interface AgentOutput<T = unknown> {
  agentId: string
  agentName: string
  status: AgentResultStatus
  output: T
  error?: string
  cost: AgentCost
  durationMs: number
}

export interface AgentCost {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  totalTokens: number
  costCents: number
  calls: number
}

export function emptyAgentCost(): AgentCost {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
    costCents: 0,
    calls: 0,
  }
}
