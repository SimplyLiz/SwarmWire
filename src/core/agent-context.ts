/**
 * Shared AgentContext builder — used by the executor AND all patterns.
 * Single source of truth for: llm (with structured output), tool, trace, board, guardrails.
 */

import type { Agent, AgentContext, LlmCallOptions } from '../types/agent.js'
import type { CostEvent } from '../types/budget.js'
import type { TraceSpan } from '../types/execution.js'
import type { StepCascadeConfig, CascadeTraceEntry } from '../types/plan.js'
import type { Provider, LlmRequest, ModelConfig } from '../types/provider.js'
import type { BudgetLedger } from '../budget/ledger.js'
import type { MessageBoard } from './messageboard.js'
import { CascadeRouter } from '../planner/cascade-router.js'
import { scopedBoard, stubBoard } from './stub-board.js'

export interface AgentContextConfig {
  executionId: string
  stepId: string
  agent: Agent
  ledger: BudgetLedger
  providers: Provider[]
  defaultModel?: ModelConfig
  stepResults?: Map<string, unknown>
  traceSpans?: TraceSpan[]
  board?: MessageBoard
  /** When set, llm() routes through CascadeRouter instead of direct provider call. */
  cascadeConfig?: StepCascadeConfig
  /** Mutable array — cascade trace entries are pushed here after each llm() call. */
  cascadeTraceRef?: CascadeTraceEntry[]
}

/**
 * Build a full AgentContext with all capabilities:
 * - llm() with responseFormat support
 * - tool() calls
 * - trace events
 * - board messaging
 * - step output access
 */
export function buildAgentContext(config: AgentContextConfig): AgentContext {
  const { executionId, stepId, agent, ledger, providers, defaultModel, traceSpans = [], board, cascadeConfig, cascadeTraceRef } = config
  const stepResults = config.stepResults ?? new Map()

  const agentBoard = board ? scopedBoard(agent.name, board) : stubBoard()

  return {
    executionId,
    budgetRemaining: ledger.remaining(),
    board: agentBoard,

    async llm(prompt: string, opts?: LlmCallOptions): Promise<string> {
      const modelConfig = opts?.model ?? agent.model ?? defaultModel
      if (!modelConfig) throw new Error(`No model configured for agent ${agent.name}`)

      const spanStart = performance.now()
      const request: LlmRequest = {
        model: modelConfig.model,
        systemPrompt: opts?.systemPrompt ?? agent.systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: opts?.maxTokens ?? agent.maxTokens ?? 4096,
        temperature: opts?.temperature ?? modelConfig.temperature,
        responseFormat: opts?.responseFormat,
      }

      // ── Cascade routing path ──
      if (cascadeConfig?.enabled) {
        const cascadeProviders = cascadeConfig.crossProvider
          ? providers
          : providers.filter((p) => p.name === modelConfig.provider)

        if (cascadeProviders.length > 0) {
          const router = new CascadeRouter({
            providers: cascadeProviders,
            qualityThreshold: cascadeConfig.threshold,
            maxEscalations: cascadeConfig.maxEscalations,
          })

          const cascadeResult = await router.route(request)

          const costEvent: CostEvent = {
            timestamp: Date.now(),
            agentId: agent.id,
            agentName: agent.name,
            stepId,
            provider: cascadeResult.provider.name,
            model: cascadeResult.model.model,
            inputTokens: cascadeResult.response.inputTokens,
            outputTokens: cascadeResult.response.outputTokens,
            cachedInputTokens: cascadeResult.response.cachedInputTokens,
            // Record total cost across all escalation attempts
            costCents: cascadeResult.totalCostCents,
            durationMs: cascadeResult.response.durationMs,
          }
          ledger.record(costEvent)

          if (cascadeTraceRef) cascadeTraceRef.push(...cascadeResult.trace)

          traceSpans.push({
            id: `${stepId}_llm_${Date.now()}`,
            parentId: stepId,
            name: `cascade:${cascadeResult.modelsTriedNames.join('→')}`,
            type: 'llm_call',
            startedAt: spanStart,
            completedAt: performance.now(),
            durationMs: cascadeResult.response.durationMs,
            attributes: {
              model: cascadeResult.model.model,
              provider: cascadeResult.provider.name,
              cascade: true,
              escalations: cascadeResult.escalations,
              qualityScore: cascadeResult.qualityScore,
              modelsTried: cascadeResult.modelsTriedNames,
              structured: !!opts?.responseFormat,
            },
            costCents: cascadeResult.totalCostCents,
            tokens: cascadeResult.response.inputTokens + cascadeResult.response.outputTokens,
            status: 'ok',
          })

          if (opts?.responseFormat && cascadeResult.response.parsed !== undefined) {
            return cascadeResult.response.parsed as never
          }
          if (opts?.responseFormat) {
            try { return JSON.parse(cascadeResult.response.content) as never } catch { /* fall through */ }
          }
          return cascadeResult.response.content as never
        }
      }

      // ── Direct provider path ──
      const provider = providers.find((p) => p.name === modelConfig.provider)
      if (!provider) throw new Error(`Provider ${modelConfig.provider} not found`)

      const response = await provider.chat(request)
      const costCents = provider.estimateCost(modelConfig.model, response.inputTokens, response.outputTokens)

      const costEvent: CostEvent = {
        timestamp: Date.now(),
        agentId: agent.id,
        agentName: agent.name,
        stepId,
        provider: provider.name,
        model: response.model,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        cachedInputTokens: response.cachedInputTokens,
        costCents,
        durationMs: response.durationMs,
      }

      ledger.record(costEvent)

      traceSpans.push({
        id: `${stepId}_llm_${Date.now()}`,
        parentId: stepId,
        name: `llm:${modelConfig.model}`,
        type: 'llm_call',
        startedAt: spanStart,
        completedAt: performance.now(),
        durationMs: response.durationMs,
        attributes: { model: modelConfig.model, provider: provider.name, structured: !!opts?.responseFormat },
        costCents,
        tokens: response.inputTokens + response.outputTokens,
        status: 'ok',
      })

      // Structured output: return parsed object
      if (opts?.responseFormat && response.parsed !== undefined) {
        return response.parsed as never
      }
      if (opts?.responseFormat) {
        try { return JSON.parse(response.content) as never } catch { /* fall through */ }
      }
      return response.content as never
    },

    async tool<T>(name: string, input: unknown): Promise<T> {
      const tool = agent.tools.find((t) => t.name === name)
      if (!tool) throw new Error(`Tool ${name} not found on agent ${agent.name}`)

      const spanStart = performance.now()
      const result = await tool.execute(input)
      const durationMs = performance.now() - spanStart

      traceSpans.push({
        id: `${stepId}_tool_${Date.now()}`,
        parentId: stepId,
        name: `tool:${name}`,
        type: 'tool_call',
        startedAt: spanStart,
        completedAt: performance.now(),
        durationMs,
        attributes: { toolName: name },
        status: 'ok',
      })

      return result as T
    },

    trace(event: string, data?: unknown): void {
      traceSpans.push({
        id: `${stepId}_trace_${Date.now()}`,
        parentId: stepId,
        name: event,
        type: 'step',
        startedAt: performance.now(),
        completedAt: performance.now(),
        durationMs: 0,
        attributes: { data },
        status: 'ok',
      })
    },

    getStepOutput<T>(id: string): T | undefined {
      return stepResults.get(id) as T | undefined
    },

    deps: (agent.deps ?? {}) as Record<string, unknown>,
  }
}
