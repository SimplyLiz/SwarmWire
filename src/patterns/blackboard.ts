/**
 * Blackboard pattern.
 * Agents read/write to a shared state space over multiple rounds.
 * Good for iterative refinement where multiple specialists contribute.
 */

import type { Agent, AgentOutput } from '../types/agent.js'
import type { Task } from '../types/task.js'
import type { ExecutionResult, TraceSpan } from '../types/execution.js'
import type { SwarmEvent } from '../types/pattern.js'
import type { Provider } from '../types/provider.js'
import type { Budget } from '../types/budget.js'
import type { Plan } from '../types/plan.js'
import { BudgetLedger } from '../budget/ledger.js'

export interface BlackboardConfig {
  pattern: 'blackboard'
  agents: Agent[]
  /** Max iteration rounds. Default 5 */
  rounds?: number
  /** Convergence check — return true to stop early */
  convergence?: (state: BlackboardState) => boolean
  budget?: Budget
}

export interface BlackboardState {
  round: number
  entries: BlackboardEntry[]
  merged: Record<string, unknown>
}

export interface BlackboardEntry {
  agentName: string
  round: number
  data: unknown
  timestamp: number
}

export class Blackboard {
  private entries: BlackboardEntry[] = []
  private merged: Record<string, unknown> = {}

  /** Write data to the board under the agent's name. */
  write(agentName: string, round: number, data: unknown): void {
    this.entries.push({ agentName, round, data, timestamp: Date.now() })
    // Merge: latest write per agent wins
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      this.merged = { ...this.merged, ...(data as Record<string, unknown>) }
    } else {
      this.merged[agentName] = data
    }
  }

  /** Read the full state of the board. */
  read(): BlackboardState {
    return {
      round: this.entries.length > 0 ? Math.max(...this.entries.map((e) => e.round)) : 0,
      entries: [...this.entries],
      merged: { ...this.merged },
    }
  }

  /** Read entries from a specific round. */
  readRound(round: number): BlackboardEntry[] {
    return this.entries.filter((e) => e.round === round)
  }

  /** Read latest entry from a specific agent. */
  readAgent(agentName: string): BlackboardEntry | undefined {
    return [...this.entries].reverse().find((e) => e.agentName === agentName)
  }
}

export async function runBlackboard<T = unknown>(
  task: Task,
  config: BlackboardConfig,
  providers: Provider[],
  budget: Budget,
  emitEvent?: (event: SwarmEvent) => void,
  msgBoard?: import('../core/messageboard.js').MessageBoard,
): Promise<ExecutionResult<T>> {
  const { agents, rounds = 5, convergence } = config
  if (agents.length === 0) throw new Error('blackboard requires at least one agent')

  const ledger = new BudgetLedger(budget, emitEvent)
  const traceSpans: TraceSpan[] = []
  const allOutputs: AgentOutput[] = []
  const board = new Blackboard()
  const startedAt = performance.now()

  for (let round = 1; round <= rounds; round++) {
    if (ledger.usage().exhausted) break

    for (const agent of agents) {
      if (ledger.usage().exhausted) break

      const spanStart = performance.now()
      const stepId = `bb_r${round}_${agent.name}`
      emitEvent?.({ type: 'step:start', stepId, agentName: agent.name })

      try {
        const boardState = board.read()
        const context = buildContext(task, agent, ledger, providers, traceSpans, msgBoard)

        const prompt = round === 1
          ? `You are contributing to a collaborative analysis of: ${task.description}\n\nInput: ${JSON.stringify(task.input)}\n\nProvide your contribution as a JSON object.`
          : `You are in round ${round} of a collaborative analysis of: ${task.description}\n\nCurrent board state:\n${JSON.stringify(boardState.merged, null, 2)}\n\nPrevious round contributions:\n${boardState.entries.filter(e => e.round === round - 1).map(e => `${e.agentName}: ${JSON.stringify(e.data)}`).join('\n')}\n\nBuild on or refine the existing work. Provide your updated contribution as a JSON object.`

        const result = await context.llm(prompt)
        const durationMs = performance.now() - spanStart

        // Try to parse as JSON, fall back to string
        let parsed: unknown
        try { parsed = JSON.parse(result) } catch { parsed = result }

        board.write(agent.name, round, parsed)

        const output: AgentOutput = {
          agentId: agent.id,
          agentName: agent.name,
        status: 'completed' as const,
          output: parsed,
          cost: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, costCents: 0, calls: 1 },
          durationMs,
        }
        allOutputs.push(output)

        emitEvent?.({ type: 'step:complete', stepId, agentName: agent.name, durationMs, costCents: 0 })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        emitEvent?.({ type: 'step:error', stepId, agentName: agent.name, error: errorMsg })
      }
    }

    // Check convergence
    if (convergence) {
      const state = board.read()
      if (convergence(state)) break
    }
  }

  const completedAt = performance.now()
  const costSummary = ledger.summarize()
  costSummary.totalLatencyMs = completedAt - startedAt

  const finalState = board.read()

  const plan: Plan = {
    id: `plan_bb_${Date.now().toString(36)}`,
    task,
    steps: [],
    mode: 'swarm',
    estimatedCost: { estimatedTokens: 0, estimatedCostCents: 0, estimatedLatencyMs: 0, estimatedAgents: agents.length, confidence: 0.5 },
    status: 'complete',
  }

  return {
    output: finalState.merged as T,
    confidence: 0.7,
    evidence: [],
    agentOutputs: allOutputs,
    allResults: allOutputs,
    events: [],
    messages: msgBoard ? msgBoard.export() : [],
    cost: costSummary,
    trace: { id: plan.id, startedAt, completedAt, spans: traceSpans },
    plan,
    partial: ledger.usage().exhausted,
  }
}

function buildContext(
  task: Task,
  agent: Agent,
  ledger: BudgetLedger,
  providers: Provider[],
  _traceSpans: TraceSpan[],
  agentBoard?: import('../core/messageboard.js').MessageBoard,
) {
  const boardView = agentBoard ? scopedBoard(agent.name, agentBoard) : stubBoard()
  return {
    executionId: task.id,
    budgetRemaining: ledger.remaining(),
    async llm(prompt: string): Promise<string> {
      const modelConfig = agent.model
      if (!modelConfig) throw new Error(`No model configured for agent ${agent.name}`)
      const provider = providers.find((p) => p.name === modelConfig.provider)
      if (!provider) throw new Error(`Provider ${modelConfig.provider} not found`)

      const response = await provider.chat({
        model: modelConfig.model,
        systemPrompt: agent.systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: agent.maxTokens ?? 4096,
        temperature: modelConfig.temperature,
      })

      const costCents = provider.estimateCost(modelConfig.model, response.inputTokens, response.outputTokens)
      ledger.record({
        timestamp: Date.now(),
        agentId: agent.id,
        agentName: agent.name,
        provider: provider.name,
        model: response.model,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        cachedInputTokens: response.cachedInputTokens,
        costCents,
        durationMs: response.durationMs,
      })

      return response.content
    },
    async tool<T>(_name: string, _input: unknown): Promise<T> { throw new Error('Tools not supported in blackboard context') },
    trace(_event: string): void {},
    getStepOutput<T>(): T | undefined { return undefined },
    board: boardView,
  }
}

import { stubBoard, scopedBoard } from '../core/stub-board.js'
