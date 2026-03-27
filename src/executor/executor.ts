/**
 * Executor — runs a Plan's DAG with parallel execution, budget enforcement, and tracing.
 */

import type { Agent, AgentContext, AgentOutput, LlmCallOptions } from '../types/agent.js'
import type { Budget, CostEvent } from '../types/budget.js'
import type { ExecutionResult, ExecutionTrace, TraceSpan, EvidenceRef, Conflict } from '../types/execution.js'
import type { Plan, Step, StepInput } from '../types/plan.js'
import type { Provider, LlmRequest, LlmResponse, ModelConfig } from '../types/provider.js'
import type { SwarmEvent } from '../types/pattern.js'
import type { AgentBoard } from '../types/agent.js'
import { isAgentRef } from '../types/plan.js'
import { BudgetLedger } from '../budget/ledger.js'
import { MessageBoard } from '../core/messageboard.js'
import { scopedBoard } from '../core/stub-board.js'
import { runGuardrails, GuardrailTripped } from '../core/guardrails.js'

export interface ExecutorConfig {
  providers: Provider[]
  budget: Budget
  emitEvent?: (event: SwarmEvent) => void
  defaultModel?: ModelConfig
  /** Callback for approval gates. If not provided, gates auto-approve. */
  onApproval?: import('../types/plan.js').ApprovalCallback
  /** Shared MessageBoard for inter-agent communication. If not provided, a fresh one is created. */
  board?: MessageBoard
}

export async function executePlan<T = unknown>(
  plan: Plan,
  config: ExecutorConfig,
): Promise<ExecutionResult<T>> {
  const collectedEvents: import('../types/pattern.js').SwarmEvent[] = []
  const wrappedEmit = (event: import('../types/pattern.js').SwarmEvent) => {
    collectedEvents.push(event)
    config.emitEvent?.(event)
  }
  const ledger = new BudgetLedger(config.budget, wrappedEmit)
  const traceSpans: TraceSpan[] = []
  const agentOutputs: AgentOutput[] = []
  const allResults: AgentOutput[] = []
  const stepResults = new Map<string, unknown>()
  const board = config.board ?? new MessageBoard()
  const startedAt = performance.now()

  plan.status = 'running'
  wrappedEmit({ type: 'plan:created', planId: plan.id, steps: plan.steps.length })

  // Topological execution — process steps respecting dependencies
  const completed = new Set<string>()
  const failed = new Set<string>()
  const running = new Map<string, Promise<void>>()

  async function runStep(step: Step): Promise<void> {
    // Check budget before starting — also check if limits are set to 0
    if (ledger.usage().exhausted || !ledger.canAfford(1, 0)) {
      step.status = 'skipped'
      return
    }

    // Check if agent is a ref (unresolved) — skip
    if (isAgentRef(step.agent)) {
      step.status = 'failed'
      step.error = `Unresolved agent ref: ${step.agent.name}`
      failed.add(step.id)
      return
    }

    const agent = step.agent as Agent

    // Approval gate check
    if (step.gate && step.gate.type === 'approval') {
      if (config.onApproval) {
        const decision = await config.onApproval({ ...step.gate, stepId: step.id, agentName: agent.name })
        if (decision === 'rejected') {
          step.status = 'skipped'
          step.error = 'Rejected by approval gate'
          allResults.push({
            agentId: agent.id, agentName: agent.name, status: 'skipped', output: undefined as never,
            error: 'Rejected by approval gate',
            cost: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 },
            durationMs: 0,
          })
          if (step.optional) completed.add(step.id)
          else failed.add(step.id)
          return
        }
      }
      // If no onApproval callback, auto-approve
    }

    step.status = 'running'
    wrappedEmit({ type: 'step:start', stepId: step.id, agentName: agent.name })

    const spanStart = performance.now()

    try {
      // Build input from step definition
      const input = resolveInput(step.input, plan.task.input, stepResults)

      // Create agent context
      const context = createAgentContext(
        plan.id,
        step.id,
        agent,
        ledger,
        config.providers,
        config.defaultModel,
        stepResults,
        traceSpans,
        board,
        config.emitEvent,
      )

      // Run input guardrails (if configured)
      let guardedInput = input
      if (agent.guardrails?.input && agent.guardrails.input.length > 0) {
        const inputGuardrailResult = await runGuardrails(
          agent.guardrails.input,
          input,
          { phase: 'input', agentName: agent.name, executionId: plan.id, stepId: step.id },
        )
        if (inputGuardrailResult.sanitizedValue !== undefined) {
          guardedInput = inputGuardrailResult.sanitizedValue
        }
      }

      // Execute with timeout
      const timeoutMs = step.timeoutMs ?? agent.timeoutMs ?? 60_000
      const result = await withTimeout(agent.execute(guardedInput, context), timeoutMs)

      // Run output guardrails (if configured)
      if (agent.guardrails?.output && agent.guardrails.output.length > 0) {
        await runGuardrails(
          agent.guardrails.output,
          result,
          { phase: 'output', agentName: agent.name, executionId: plan.id, stepId: step.id },
        )
      }

      step.output = result
      step.status = 'complete'
      completed.add(step.id)
      stepResults.set(step.id, result)

      const durationMs = performance.now() - spanStart
      const costCents = step.cost?.costCents ?? 0

      const agentOutput: AgentOutput = {
        agentId: agent.id,
        agentName: agent.name,
        status: 'completed',
        output: result,
        cost: {
          inputTokens: step.cost?.inputTokens ?? 0,
          outputTokens: step.cost?.outputTokens ?? 0,
          cachedInputTokens: step.cost?.cachedInputTokens ?? 0,
          totalTokens: (step.cost?.inputTokens ?? 0) + (step.cost?.outputTokens ?? 0),
          costCents,
          calls: 1,
        },
        durationMs,
      }
      agentOutputs.push(agentOutput)
      allResults.push(agentOutput)

      traceSpans.push({
        id: step.id,
        name: `step:${agent.name}`,
        type: 'step',
        startedAt: spanStart,
        completedAt: performance.now(),
        durationMs,
        attributes: { agentName: agent.name, stepId: step.id },
        costCents,
        tokens: (step.cost?.inputTokens ?? 0) + (step.cost?.outputTokens ?? 0),
        status: 'ok',
      })

      wrappedEmit({ type: 'step:complete', stepId: step.id, agentName: agent.name, durationMs, costCents })
    } catch (err) {
      const durationMs = performance.now() - spanStart
      const errorMsg = err instanceof Error ? err.message : String(err)

      // Retry logic
      const retries = step.retries ?? 0
      if (retries > 0) {
        step.retries = retries - 1
        return runStep(step)
      }

      step.status = 'failed'
      step.error = errorMsg

      allResults.push({
        agentId: agent.id,
        agentName: agent.name,
        status: 'failed',
        output: undefined as never,
        error: errorMsg,
        cost: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, costCents: 0, calls: 0 },
        durationMs,
      })

      if (step.optional) {
        // Optional failures count as "completed" for dependency resolution
        completed.add(step.id)
      } else {
        failed.add(step.id)
      }

      traceSpans.push({
        id: step.id,
        name: `step:${agent.name}`,
        type: 'step',
        startedAt: spanStart,
        completedAt: performance.now(),
        durationMs,
        attributes: { agentName: agent.name, stepId: step.id },
        status: 'error',
        error: errorMsg,
      })

      wrappedEmit({ type: 'step:error', stepId: step.id, agentName: agent.name, error: errorMsg })
    }
  }

  // Process DAG — find ready steps, execute in parallel, repeat
  while (completed.size + failed.size < plan.steps.length) {
    const ready = plan.steps.filter((s) =>
      s.status === 'pending'
      && s.dependencies.every((d) => completed.has(d))
      && !s.dependencies.some((d) => failed.has(d) && !plan.steps.find((ps) => ps.id === d)?.optional)
    )

    if (ready.length === 0 && running.size === 0) break // Deadlock or all done

    // Check agent concurrency limit
    const maxAgents = config.budget.maxAgents ?? Infinity
    const toRun = ready.slice(0, Math.max(1, maxAgents - running.size))

    const promises = toRun.map((step) => {
      const p = runStep(step).finally(() => running.delete(step.id))
      running.set(step.id, p)
      return p
    })

    // Wait for at least one to finish before checking for more
    if (promises.length > 0) {
      await Promise.race([...running.values()])
    }

    // Also skip steps whose dependencies failed (non-optional)
    for (const step of plan.steps) {
      if (step.status === 'pending' && step.dependencies.some((d) => failed.has(d))) {
        const depStep = plan.steps.find((s) => s.id === step.dependencies.find((dd) => failed.has(dd)))
        if (depStep && !depStep.optional) {
          step.status = 'skipped'
        }
      }
    }
  }

  // Wait for any remaining running steps
  if (running.size > 0) {
    await Promise.allSettled([...running.values()])
  }

  // Determine final output
  const lastCompleted = [...plan.steps].reverse().find((s) => s.status === 'complete')
  const output = lastCompleted?.output as T

  const completedAt = performance.now()
  const partial = failed.size > 0 || plan.steps.some((s) => s.status === 'skipped')

  plan.status = failed.size > 0 && !partial ? 'failed' : 'complete'

  const costSummary = ledger.summarize()
  costSummary.totalLatencyMs = completedAt - startedAt

  const trace: ExecutionTrace = {
    id: plan.id,
    startedAt,
    completedAt,
    spans: traceSpans,
  }

  const durationMs = completedAt - startedAt
  wrappedEmit({ type: 'execution:complete', durationMs, costCents: costSummary.totalCostCents })

  return {
    output,
    confidence: partial ? 0.5 : 0.8,
    evidence: [],
    agentOutputs,
    allResults,
    cost: costSummary,
    trace,
    plan,
    partial,
    events: collectedEvents,
    messages: board.export(),
  }
}

function resolveInput(input: StepInput, taskInput: unknown, stepResults: Map<string, unknown>): unknown {
  switch (input.type) {
    case 'literal':
      return input.value
    case 'task_input':
      return taskInput
    case 'step_output':
      return stepResults.get(input.stepId)
    case 'merged':
      return input.sources.map((s) => resolveInput(s, taskInput, stepResults))
    default:
      return taskInput
  }
}

function createAgentContext(
  executionId: string,
  stepId: string,
  agent: Agent,
  ledger: BudgetLedger,
  providers: Provider[],
  defaultModel: ModelConfig | undefined,
  stepResults: Map<string, unknown>,
  traceSpans: TraceSpan[],
  board: MessageBoard,
  emitEvent?: (event: SwarmEvent) => void,
): AgentContext {
  const agentBoard = scopedBoard(agent.name, board)

  return {
    executionId,
    budgetRemaining: ledger.remaining(),
    board: agentBoard,

    async llm(prompt: string, opts?: LlmCallOptions): Promise<string> {
      const modelConfig = opts?.model ?? agent.model ?? defaultModel
      if (!modelConfig) throw new Error(`No model configured for agent ${agent.name}`)

      const provider = providers.find((p) => p.name === modelConfig.provider)
      if (!provider) throw new Error(`Provider ${modelConfig.provider} not found`)

      const spanStart = performance.now()
      const request: LlmRequest = {
        model: modelConfig.model,
        systemPrompt: opts?.systemPrompt ?? agent.systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: opts?.maxTokens ?? agent.maxTokens ?? 4096,
        temperature: opts?.temperature ?? modelConfig.temperature,
        responseFormat: opts?.responseFormat,
      }

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

      // If responseFormat was requested, return parsed object; otherwise return string
      if (opts?.responseFormat && response.parsed !== undefined) {
        return response.parsed as never
      }
      if (opts?.responseFormat) {
        // Provider didn't set parsed — try to parse the content as JSON
        try { return JSON.parse(response.content) as never } catch { /* fall through to string */ }
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
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}
