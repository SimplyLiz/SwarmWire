/**
 * Hive-Mind pattern — Queen-based intelligent task decomposition and delegation.
 * Routes tasks to optimal agent combinations using capability scoring and tier analysis.
 */

import type { Task } from '../types/task.js'
import type { Agent } from '../types/agent.js'
import type { ExecutionResult } from '../types/execution.js'
import type { Provider } from '../types/provider.js'
import type { Budget } from '../types/budget.js'
import type { SwarmEvent } from '../types/pattern.js'
import type { MessageBoard } from '../core/messageboard.js'
import { analyzeTaskComplexity, calculateComplexityScore, defaultModelRoutingConfig } from '../planner/model-router.js'
import { runPipeline } from './pipeline.js'
import { runFanOut } from './fan-out.js'
import { buildPlan } from '../planner/planner.js'
import { executePlan } from '../executor/executor.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentDomain =
  | 'code'
  | 'data'
  | 'text'
  | 'math'
  | 'security'
  | 'design'
  | 'test'
  | 'ops'

export type DelegationStrategy = 'sequential' | 'parallel' | 'pipeline' | 'fan-out-fan-in'

export interface TaskAnalysis {
  complexity: number
  requiredCapabilities: string[]
  recommendedDomain: AgentDomain
  subtasks: string[]
  strategy: DelegationStrategy
}

export interface AgentScore {
  agent: Agent
  capabilityScore: number
  loadScore: number
  performanceScore: number
  healthScore: number
  total: number
}

export interface DelegationPlan {
  primary: Agent
  backups: Agent[]
  parallelAssignments: Agent[]
  strategy: DelegationStrategy
}

export interface HiveMindConfig {
  agents: Agent[]
  maxParallel?: number
  /** Minimum capability overlap score threshold. Default 0. */
  minCapabilityScore?: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CAPABILITY_KEYWORDS: Record<string, string[]> = {
  code: ['code', 'programming', 'implementation', 'function', 'class', 'module', 'api', 'typescript', 'javascript', 'python'],
  data: ['data', 'analysis', 'statistics', 'database', 'sql', 'csv', 'table', 'metrics'],
  text: ['write', 'document', 'summarize', 'explain', 'translate', 'text', 'content'],
  math: ['math', 'calculate', 'formula', 'equation', 'algorithm', 'compute'],
  security: ['security', 'vulnerability', 'authentication', 'encryption', 'threat', 'audit'],
  design: ['design', 'architecture', 'pattern', 'structure', 'diagram', 'ux', 'ui'],
  test: ['test', 'testing', 'coverage', 'spec', 'unit', 'integration', 'quality'],
  ops: ['deploy', 'pipeline', 'infrastructure', 'docker', 'kubernetes', 'ci', 'cd', 'ops'],
}

const TIER_PERF_SCORE: Record<string, number> = {
  cheap: 0.5,
  standard: 0.7,
  premium: 0.9,
  reasoning: 1.0,
}

function analyzeTask(task: Task): TaskAnalysis {
  const indicators = analyzeTaskComplexity(task, defaultModelRoutingConfig)
  const complexity = calculateComplexityScore(indicators, defaultModelRoutingConfig)

  const desc = task.description.toLowerCase()

  // Detect required capabilities from keyword scan
  const requiredCapabilities: string[] = []
  let bestDomain: AgentDomain = 'text'
  let bestDomainCount = 0

  for (const [domain, keywords] of Object.entries(CAPABILITY_KEYWORDS)) {
    const count = keywords.filter((kw) => desc.includes(kw)).length
    if (count > 0) {
      requiredCapabilities.push(domain)
      if (count > bestDomainCount) {
        bestDomainCount = count
        bestDomain = domain as AgentDomain
      }
    }
  }

  // Pick strategy by complexity bucket
  let strategy: DelegationStrategy
  if (complexity < 0.3) {
    strategy = 'sequential'
  } else if (complexity < 0.6) {
    strategy = 'parallel'
  } else if (complexity < 0.8) {
    strategy = 'pipeline'
  } else {
    strategy = 'fan-out-fan-in'
  }

  // Crude subtask decomposition: split on '.' or ';'
  const subtasks = task.description
    .split(/[.;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5)
    .slice(0, 5)

  return {
    complexity,
    requiredCapabilities,
    recommendedDomain: bestDomain,
    subtasks,
    strategy,
  }
}

function scoreAgents(agents: Agent[], analysis: TaskAnalysis): AgentScore[] {
  return agents.map((agent) => {
    const caps = agent.capabilities.map((c) => c.toLowerCase())
    const required = analysis.requiredCapabilities

    // Capability overlap (40%)
    let capabilityScore = 0
    if (required.length > 0) {
      const matched = required.filter((r) =>
        caps.some((c) => c.includes(r) || r.includes(c))
      ).length
      capabilityScore = matched / required.length
    }

    // Load score — always 1.0 at plan time (30%)
    const loadScore = 1.0

    // Tier-based performance score (20%)
    const performanceScore = TIER_PERF_SCORE[agent.modelTier] ?? 0.5

    // Health score (10%) — 0 if no execute fn (duck-typed check)
    const healthScore = typeof agent.execute === 'function' ? 1.0 : 0.0

    const total =
      capabilityScore * 0.4 +
      loadScore * 0.3 +
      performanceScore * 0.2 +
      healthScore * 0.1

    return { agent, capabilityScore, loadScore, performanceScore, healthScore, total }
  })
}

function buildDelegationPlan(scores: AgentScore[], config: HiveMindConfig): DelegationPlan {
  const sorted = [...scores].sort((a, b) => b.total - a.total)
  const maxParallel = config.maxParallel ?? 3

  return {
    primary: sorted[0]!.agent,
    backups: sorted.slice(1, 3).map((s) => s.agent),
    parallelAssignments: sorted.slice(0, maxParallel).map((s) => s.agent),
    strategy: 'sequential', // will be overridden by runHiveMind
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function runHiveMind<T = unknown>(
  task: Task,
  config: HiveMindConfig,
  providers: Provider[],
  budget: Budget,
  emitEvent?: (event: SwarmEvent) => void,
  board?: MessageBoard,
): Promise<ExecutionResult<T>> {
  const agents = config.agents
  if (agents.length === 0) throw new Error('hive-mind requires at least one agent')

  const analysis = analyzeTask(task)
  const scores = scoreAgents(agents, analysis)
  const plan = buildDelegationPlan(scores, config)

  const { strategy } = analysis

  if (strategy === 'sequential' || strategy === 'pipeline') {
    // Use pipeline with primary + backup agents
    const pipelineAgents = [plan.primary, ...plan.backups].slice(0, 2)
    const stages = pipelineAgents.map((a, i) => ({ name: `stage_${i}`, agent: a }))
    return runPipeline<T>(
      task,
      { pattern: 'pipeline', stages },
      providers,
      budget,
      emitEvent,
      board,
    )
  }

  if (strategy === 'parallel' || strategy === 'fan-out-fan-in') {
    // Fan-out to parallel agents, then synthesize with primary
    const fanOutAgents = plan.parallelAssignments
    const synthesizer = plan.primary

    const fanOutResult = await runFanOut(
      task,
      { agents: fanOutAgents },
      providers,
      budget,
      emitEvent,
      board,
    )

    // Build a single synthesizer step
    const synthPlan = buildPlan(
      { ...task, input: fanOutResult.output },
      { agents: [synthesizer] },
    )

    return executePlan<T>(synthPlan, { providers, budget, emitEvent, board })
  }

  // Fallback: single agent
  const fallbackPlan = buildPlan(task, { agents: [plan.primary] })
  return executePlan<T>(fallbackPlan, { providers, budget, emitEvent, board })
}
