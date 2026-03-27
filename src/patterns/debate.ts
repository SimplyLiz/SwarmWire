/**
 * Debate pattern.
 * Agents argue opposing positions over multiple rounds, a judge resolves.
 * Proven to improve reasoning quality (arXiv:2501.06322).
 */

import type { Agent, AgentOutput } from '../types/agent.js'
import type { Task } from '../types/task.js'
import type { ExecutionResult, TraceSpan } from '../types/execution.js'
import type { DebateConfig, SwarmEvent } from '../types/pattern.js'
import type { Provider } from '../types/provider.js'
import type { Budget } from '../types/budget.js'
import type { Plan } from '../types/plan.js'
import { BudgetLedger } from '../budget/ledger.js'
import { detectConflicts } from '../conflict/detector.js'

export async function runDebate<T = unknown>(
  task: Task,
  config: DebateConfig,
  providers: Provider[],
  budget: Budget,
  emitEvent?: (event: SwarmEvent) => void,
  board?: import('../core/messageboard.js').MessageBoard,
): Promise<ExecutionResult<T>> {
  const { proponents, judge, rounds = 3, convergenceThreshold = 0.85 } = config
  if (proponents.length < 2) throw new Error('debate requires at least 2 proponents')

  const ledger = new BudgetLedger(budget, emitEvent)
  const traceSpans: TraceSpan[] = []
  const allOutputs: AgentOutput[] = []
  const startedAt = performance.now()

  const previousArguments: Map<string, string> = new Map()
  let finalRound = rounds

  // Debate rounds
  for (let round = 1; round <= rounds; round++) {
    if (ledger.usage().exhausted) break

    const roundOutputs: AgentOutput[] = []

    // Each proponent argues
    for (const proponent of proponents) {
      if (ledger.usage().exhausted) break

      const spanStart = performance.now()
      emitEvent?.({ type: 'step:start', stepId: `debate_r${round}_${proponent.name}`, agentName: proponent.name })

      try {
        const context = makeContext(task, proponent, ledger, providers, traceSpans, board)
        const otherArgs = [...previousArguments.entries()]
          .filter(([name]) => name !== proponent.name)
          .map(([name, arg]) => `${name}: ${arg}`)
          .join('\n\n')

        const prompt = round === 1
          ? `You are in a debate. Present your position on: ${task.description}\n\nInput: ${JSON.stringify(task.input)}`
          : `You are in round ${round} of a debate on: ${task.description}\n\nOther positions:\n${otherArgs}\n\nPresent your counter-arguments and refined position.`

        const result = await context.llm(prompt)
        const durationMs = performance.now() - spanStart

        previousArguments.set(proponent.name, typeof result === 'string' ? result : JSON.stringify(result))

        const output: AgentOutput = {
          agentId: proponent.id,
          agentName: proponent.name,
          status: 'completed',
          output: result,
          cost: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, costCents: 0, calls: 1 },
          durationMs,
        }
        roundOutputs.push(output)
        allOutputs.push(output)

        emitEvent?.({ type: 'step:complete', stepId: `debate_r${round}_${proponent.name}`, agentName: proponent.name, durationMs, costCents: 0 })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        emitEvent?.({ type: 'step:error', stepId: `debate_r${round}_${proponent.name}`, agentName: proponent.name, error: errorMsg })
      }
    }

    // Check convergence — if proponents are agreeing, stop early
    if (roundOutputs.length >= 2) {
      const conflicts = detectConflicts(roundOutputs, { contradictionThreshold: 1 - convergenceThreshold })
      if (conflicts.length === 0) {
        finalRound = round
        break
      }
    }
  }

  // Judge phase — evaluate all arguments and render verdict
  let verdict: unknown = null
  if (!ledger.usage().exhausted) {
    const judgeSpanStart = performance.now()
    emitEvent?.({ type: 'step:start', stepId: 'debate_judge', agentName: judge.name })

    try {
      const context = makeContext(task, judge, ledger, providers, traceSpans, board)
      const allArgs = [...previousArguments.entries()]
        .map(([name, arg]) => `### ${name}\n${arg}`)
        .join('\n\n---\n\n')

      const judgePrompt = `You are the judge in a debate on: ${task.description}\n\nHere are the final positions after ${finalRound} round(s):\n\n${allArgs}\n\nRender your verdict. Which position is strongest and why? Provide your final answer.`

      verdict = await context.llm(judgePrompt)
      const durationMs = performance.now() - judgeSpanStart

      allOutputs.push({
        agentId: judge.id,
        agentName: judge.name,
        status: 'completed' as const,
        output: verdict,
        cost: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, costCents: 0, calls: 1 },
        durationMs,
      })

      emitEvent?.({ type: 'step:complete', stepId: 'debate_judge', agentName: judge.name, durationMs, costCents: 0 })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      emitEvent?.({ type: 'step:error', stepId: 'debate_judge', agentName: judge.name, error: errorMsg })
    }
  }

  const completedAt = performance.now()
  const costSummary = ledger.summarize()
  costSummary.totalLatencyMs = completedAt - startedAt

  // Build a retrospective plan for the trace
  const plan: Plan = {
    id: `plan_debate_${Date.now().toString(36)}`,
    task,
    steps: allOutputs.map((o, i) => ({
      id: `debate_step_${i}`,
      agent: { name: o.agentName } as Agent,
      input: { type: 'task_input' as const },
      dependencies: i > 0 ? [`debate_step_${i - 1}`] : [],
      status: 'complete' as const,
      output: o.output,
    })),
    mode: 'swarm',
    estimatedCost: { estimatedTokens: 0, estimatedCostCents: 0, estimatedLatencyMs: 0, estimatedAgents: proponents.length + 1, confidence: 0.5 },
    status: 'complete',
  }

  return {
    output: verdict as T,
    confidence: 0.85,
    evidence: [],
    agentOutputs: allOutputs,
    allResults: allOutputs,
    events: [],
    messages: board ? board.export() : [],
    conflicts: detectConflicts(allOutputs.filter((o) => o.agentId !== judge.id)),
    cost: costSummary,
    trace: { id: plan.id, startedAt, completedAt, spans: traceSpans },
    plan,
    partial: verdict === null,
  }
}

import { buildAgentContext as buildCtx } from '../core/agent-context.js'

function makeContext(
  task: Task, agent: Agent, ledger: BudgetLedger, providers: Provider[],
  traceSpans: TraceSpan[], agentBoard?: import('../core/messageboard.js').MessageBoard,
) {
  return buildCtx({
    executionId: task.id, stepId: `debate_${agent.name}`, agent, ledger, providers,
    traceSpans, board: agentBoard,
  })
}
