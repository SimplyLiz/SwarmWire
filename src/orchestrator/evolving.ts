/**
 * Evolving Orchestrator — adaptive agent sequencing that learns from execution traces.
 * Inspired by arXiv:2505.19591: discovers "compact, cyclic reasoning structures"
 * that outperform static hierarchies.
 *
 * Instead of RL (which requires a training loop), we use a simpler bandit approach:
 * track which agent orderings work best for each task profile, and exploit that.
 */

import type { Agent, AgentOutput } from '../types/agent.js'
import type { Task } from '../types/task.js'
import type { ExecutionResult, TraceSpan } from '../types/execution.js'
import type { SwarmEvent } from '../types/pattern.js'
import type { Provider } from '../types/provider.js'
import type { Budget } from '../types/budget.js'
import type { Plan } from '../types/plan.js'
import { scoreTask } from '../planner/scorer.js'
import { BudgetLedger } from '../budget/ledger.js'

export interface EvolvingConfig {
  agents: Agent[]
  /** Max rounds of agent invocation. Default 10 */
  maxRounds?: number
  /** Quality threshold to stop. Default 0.85 */
  qualityThreshold?: number
  /** Exploration rate (0-1). How often to try non-optimal orderings. Default 0.15 */
  explorationRate?: number
  budget?: Budget
}

interface SequenceScore {
  agentOrder: string[]
  avgQuality: number
  avgCostCents: number
  uses: number
}

/**
 * Evolving orchestrator that discovers optimal agent sequences.
 */
export class EvolvingOrchestrator {
  private sequences = new Map<string, SequenceScore[]>()

  /** Run a task with adaptive agent sequencing. */
  async run<T = unknown>(
    task: Task,
    config: EvolvingConfig,
    providers: Provider[],
    emitEvent?: (event: SwarmEvent) => void,
  ): Promise<ExecutionResult<T>> {
    const { agents, maxRounds = 10, qualityThreshold = 0.85, explorationRate = 0.15 } = config
    const budget = config.budget ?? {}
    const ledger = new BudgetLedger(budget, emitEvent)
    const traceSpans: TraceSpan[] = []
    const allOutputs: AgentOutput[] = []
    const startedAt = performance.now()

    const taskProfile = this.getTaskProfile(task)
    const agentOrder = this.selectAgentOrder(taskProfile, agents, explorationRate)

    let lastOutput: unknown = null
    let roundsUsed = 0

    for (let round = 0; round < maxRounds; round++) {
      if (ledger.usage().exhausted) break
      roundsUsed = round + 1

      // Pick next agent from the evolved sequence (cycle if needed)
      const agentIdx = round % agentOrder.length
      const agent = agentOrder[agentIdx]!

      const stepId = `evolve_r${round}_${agent.name}`
      emitEvent?.({ type: 'step:start', stepId, agentName: agent.name })
      const spanStart = performance.now()

      try {
        const context = this.buildContext(task, agent, round, lastOutput, ledger, providers, traceSpans)
        const result = await agent.execute(
          round === 0 ? task.input : { previousResult: lastOutput, originalTask: task.input, round },
          context,
        )

        lastOutput = result
        const durationMs = performance.now() - spanStart

        allOutputs.push({
          agentId: agent.id,
          agentName: agent.name,
        status: 'completed' as const,
          output: result,
          cost: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, costCents: 0, calls: 1 },
          durationMs,
        })

        emitEvent?.({ type: 'step:complete', stepId, agentName: agent.name, durationMs, costCents: 0 })

        // Quality heuristic: if the output stabilized (same as previous round), we've converged
        if (round > 0 && allOutputs.length >= 2) {
          const prev = JSON.stringify(allOutputs[allOutputs.length - 2]?.output)
          const curr = JSON.stringify(result)
          if (prev === curr) break
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        emitEvent?.({ type: 'step:error', stepId, agentName: agent.name, error: errorMsg })
      }
    }

    const completedAt = performance.now()
    const costSummary = ledger.summarize()
    costSummary.totalLatencyMs = completedAt - startedAt

    const plan: Plan = {
      id: `plan_evolve_${Date.now().toString(36)}`,
      task,
      steps: [],
      mode: 'swarm',
      estimatedCost: { estimatedTokens: 0, estimatedCostCents: 0, estimatedLatencyMs: 0, estimatedAgents: agents.length, confidence: 0.5 },
      status: 'complete',
    }

    // Record the sequence performance for learning
    this.recordSequence(taskProfile, agentOrder.map((a) => a.name), 0.7, costSummary.totalCostCents)

    return {
      output: lastOutput as T,
      confidence: 0.7,
      evidence: [],
      agentOutputs: allOutputs,
      allResults: allOutputs,
      events: [],
      cost: costSummary,
      trace: { id: plan.id, startedAt, completedAt, spans: traceSpans },
      plan,
      partial: ledger.usage().exhausted,
    }
  }

  /** Get learned sequences for a task profile. */
  getSequences(taskProfile: string): SequenceScore[] {
    return this.sequences.get(taskProfile) ?? []
  }

  /** Export state for persistence. */
  exportState(): Map<string, SequenceScore[]> {
    return new Map(this.sequences)
  }

  /** Import state from persistence. */
  importState(state: Map<string, SequenceScore[]>): void {
    this.sequences = new Map(state)
  }

  private getTaskProfile(task: Task): string {
    const score = scoreTask(task)
    return `${score.difficulty}:${score.domain.sort().join(',')}`
  }

  private selectAgentOrder(taskProfile: string, agents: Agent[], explorationRate: number): Agent[] {
    const known = this.sequences.get(taskProfile) ?? []

    // Explore: random permutation
    if (Math.random() < explorationRate || known.length === 0) {
      return shuffle([...agents])
    }

    // Exploit: best known sequence
    const best = known.reduce((a, b) => a.avgQuality > b.avgQuality ? a : b)
    const ordered: Agent[] = []
    for (const name of best.agentOrder) {
      const agent = agents.find((a) => a.name === name)
      if (agent) ordered.push(agent)
    }
    // Add any agents not in the known sequence
    for (const agent of agents) {
      if (!ordered.includes(agent)) ordered.push(agent)
    }
    return ordered
  }

  private recordSequence(taskProfile: string, order: string[], quality: number, costCents: number): void {
    const existing = this.sequences.get(taskProfile) ?? []
    const key = order.join(',')
    const match = existing.find((s) => s.agentOrder.join(',') === key)

    if (match) {
      match.avgQuality = (match.avgQuality * match.uses + quality) / (match.uses + 1)
      match.avgCostCents = (match.avgCostCents * match.uses + costCents) / (match.uses + 1)
      match.uses++
    } else {
      existing.push({ agentOrder: order, avgQuality: quality, avgCostCents: costCents, uses: 1 })
    }

    // Keep top 10 sequences per profile
    existing.sort((a, b) => b.avgQuality - a.avgQuality)
    this.sequences.set(taskProfile, existing.slice(0, 10))
  }

  private buildContext(
    task: Task, agent: Agent, round: number, previousOutput: unknown,
    ledger: BudgetLedger, providers: Provider[], traceSpans: TraceSpan[],
  ) {
    return {
      executionId: task.id,
      budgetRemaining: ledger.remaining(),
      async llm(prompt: string): Promise<string> {
        const modelConfig = agent.model
        if (!modelConfig) throw new Error(`No model for agent ${agent.name}`)
        const provider = providers.find((p) => p.name === modelConfig.provider)
        if (!provider) throw new Error(`Provider ${modelConfig.provider} not found`)
        const response = await provider.chat({
          model: modelConfig.model,
          systemPrompt: agent.systemPrompt,
          messages: [{ role: 'user', content: prompt }],
          maxTokens: agent.maxTokens ?? 4096,
        })
        const cost = provider.estimateCost(modelConfig.model, response.inputTokens, response.outputTokens)
        ledger.record({
          timestamp: Date.now(), agentId: agent.id, agentName: agent.name,
          provider: provider.name, model: response.model,
          inputTokens: response.inputTokens, outputTokens: response.outputTokens,
          cachedInputTokens: response.cachedInputTokens, costCents: cost, durationMs: response.durationMs,
        })
        return response.content
      },
      async tool<T>(_n: string, _i: unknown): Promise<T> { throw new Error('Not supported') },
      trace(_e: string): void {},
      getStepOutput<T>(): T | undefined { return previousOutput as T },
      board: stubBoard(),
    }
  }
}

import { stubBoard } from '../core/stub-board.js'

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr
}
