/**
 * Planner — decomposes a task into an executable DAG of steps.
 */

import type { Agent } from '../types/agent.js'
import type { Plan, Step, ExecutionMode } from '../types/plan.js'
import type { Task, TaskScore } from '../types/task.js'
import type { BudgetEstimate } from '../types/budget.js'
import type { PatternConfig } from '../types/pattern.js'
import { scoreTask } from './scorer.js'

let planCounter = 0
function nextPlanId(): string {
  return `plan_${++planCounter}_${Date.now().toString(36)}`
}

let stepCounter = 0
function nextStepId(): string {
  return `step_${++stepCounter}`
}

export interface PlannerOptions {
  /** Available agents to assign to steps */
  agents: Agent[]
  /** Override the scoring function */
  scorer?: (task: Task) => TaskScore
  /** Pattern hint — shapes the DAG structure */
  pattern?: PatternConfig
  /** Override input for all steps (instead of task.input) */
  input?: unknown
  /** If true, all steps run in parallel (no dependencies) */
  parallel?: boolean
  /** If true, all steps are marked optional (failures don't kill the plan) */
  stepsOptional?: boolean
}

/**
 * Build a Plan from a Task.
 * The plan is a draft — caller can modify steps before execution.
 */
export function buildPlan(task: Task, options: PlannerOptions): Plan {
  const score = (options.scorer ?? scoreTask)(task)
  // If user explicitly provides multiple agents, force swarm mode
  const mode: ExecutionMode = options.agents.length > 1 ? 'swarm' : score.recommendedMode
  const pattern = options.pattern?.pattern ?? 'orchestrator-worker'

  let steps: Step[]

  switch (pattern) {
    case 'pipeline':
      steps = buildPipelineSteps(options.agents)
      break
    case 'map-reduce':
      steps = buildMapReduceSteps(options.agents)
      break
    case 'orchestrator-worker':
    default:
      steps = buildOrchestratorWorkerSteps(options.agents, mode)
      break
  }

  // Apply plan-level overrides
  if (options.parallel) {
    for (const step of steps) step.dependencies = []
  }
  if (options.input !== undefined) {
    for (const step of steps) step.input = { type: 'literal', value: options.input }
  }
  if (options.stepsOptional) {
    for (const step of steps) step.optional = true
  }

  const estimatedCost: BudgetEstimate = {
    estimatedTokens: score.estimatedTokens,
    estimatedCostCents: estimateCostFromTokens(score.estimatedTokens, score.modelTier),
    estimatedLatencyMs: steps.length * 2000,
    estimatedAgents: steps.length,
    confidence: 0.6,
  }

  return {
    id: nextPlanId(),
    task,
    steps,
    mode,
    estimatedCost,
    status: 'draft',
  }
}

function buildOrchestratorWorkerSteps(agents: Agent[], mode: ExecutionMode): Step[] {
  if (agents.length === 0) return []

  if (mode === 'deep' || agents.length === 1) {
    // Single agent — one step
    return [{
      id: nextStepId(),
      agent: agents[0]!,
      input: { type: 'task_input' },
      dependencies: [],
      status: 'pending',
    }]
  }

  // Swarm: all workers run in parallel, then a final merge step
  const workers = agents.slice(0, -1)
  const synthesizer = agents[agents.length - 1]!

  const workerSteps: Step[] = workers.map((agent) => ({
    id: nextStepId(),
    agent,
    input: { type: 'task_input' as const },
    dependencies: [],
    status: 'pending' as const,
  }))

  const mergeStep: Step = {
    id: nextStepId(),
    agent: synthesizer,
    input: { type: 'merged', sources: workerSteps.map((s) => ({ type: 'step_output' as const, stepId: s.id })) },
    dependencies: workerSteps.map((s) => s.id),
    status: 'pending',
  }

  return [...workerSteps, mergeStep]
}

function buildPipelineSteps(agents: Agent[]): Step[] {
  const steps: Step[] = []
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i]!
    const prevStep = steps[i - 1]
    steps.push({
      id: nextStepId(),
      agent,
      input: prevStep ? { type: 'step_output', stepId: prevStep.id } : { type: 'task_input' },
      dependencies: prevStep ? [prevStep.id] : [],
      status: 'pending',
    })
  }
  return steps
}

function buildMapReduceSteps(agents: Agent[]): Step[] {
  // Expects [worker, reducer] — mapper is handled at the pattern level
  if (agents.length < 2) return buildPipelineSteps(agents)

  const worker = agents[0]!
  const reducer = agents[agents.length - 1]!

  const mapStep: Step = {
    id: nextStepId(),
    agent: worker,
    input: { type: 'task_input' },
    dependencies: [],
    status: 'pending',
  }

  const reduceStep: Step = {
    id: nextStepId(),
    agent: reducer,
    input: { type: 'step_output', stepId: mapStep.id },
    dependencies: [mapStep.id],
    status: 'pending',
  }

  return [mapStep, reduceStep]
}

function estimateCostFromTokens(tokens: number, tier: string): number {
  const costPer1k: Record<string, number> = {
    cheap: 0.5,
    standard: 9,
    premium: 45,
    reasoning: 25,
  }
  const rate = costPer1k[tier] ?? costPer1k.standard!
  return (tokens / 1000) * rate
}
