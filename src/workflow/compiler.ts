/**
 * Workflow compiler — converts WorkflowDef into an executable Plan.
 */

import type { Agent } from '../types/agent.js'
import type { Plan, Step, StepInput } from '../types/plan.js'
import type { Task } from '../types/task.js'
import type { Budget } from '../types/budget.js'
import type { WorkflowDef, WorkflowStepDef } from './parser.js'

export interface CompileOptions {
  /** Map of agent names to Agent instances */
  agents: Map<string, Agent>
  /** Fallback agent for steps without an explicit agent */
  defaultAgent?: Agent
  /** Input values for workflow template variables */
  inputs?: Record<string, unknown>
  /** Budget for the execution */
  budget?: Budget
}

/**
 * Compile a WorkflowDef into a Plan ready for execution.
 */
export function compileWorkflow(workflow: WorkflowDef, options: CompileOptions): Plan {
  const { agents, defaultAgent, inputs = {} } = options

  // Validate required inputs
  for (const [key, def] of Object.entries(workflow.inputs)) {
    if (def.required !== false && !(key in inputs) && def.default === undefined) {
      throw new Error(`Missing required workflow input: ${key}`)
    }
  }

  // Merge defaults
  const resolvedInputs: Record<string, unknown> = {}
  for (const [key, def] of Object.entries(workflow.inputs)) {
    resolvedInputs[key] = inputs[key] ?? def.default
  }

  const steps: Step[] = workflow.steps.map((stepDef) => {
    const agent = resolveAgent(stepDef, agents, defaultAgent)
    const input = resolveStepInput(stepDef, resolvedInputs, workflow.steps)

    return {
      id: stepDef.id,
      agent,
      input,
      dependencies: stepDef.dependencies ?? inferDependencies(stepDef, workflow.steps),
      optional: stepDef.optional,
      retries: stepDef.retries,
      timeoutMs: stepDef.timeoutMs,
      status: 'pending' as const,
    }
  })

  const task: Task = {
    id: `wf_${workflow.name}_${Date.now().toString(36)}`,
    description: workflow.description ?? workflow.name,
    input: resolvedInputs,
    budget: options.budget ?? {},
  }

  return {
    id: `plan_wf_${workflow.name}_${Date.now().toString(36)}`,
    task,
    steps,
    mode: steps.length > 2 ? 'swarm' : 'deep',
    estimatedCost: {
      estimatedTokens: steps.length * 5000,
      estimatedCostCents: steps.length * 5,
      estimatedLatencyMs: steps.length * 2000,
      estimatedAgents: steps.length,
      confidence: 0.4,
    },
    status: 'draft',
  }
}

function resolveAgent(
  stepDef: WorkflowStepDef,
  agents: Map<string, Agent>,
  defaultAgent?: Agent,
): Agent {
  if (stepDef.agent) {
    const agent = agents.get(stepDef.agent)
    if (!agent) throw new Error(`Agent "${stepDef.agent}" not found for step "${stepDef.id}"`)
    return agent
  }
  if (defaultAgent) return defaultAgent
  throw new Error(`Step "${stepDef.id}" has no agent and no default agent provided`)
}

function resolveStepInput(
  stepDef: WorkflowStepDef,
  workflowInputs: Record<string, unknown>,
  allSteps: WorkflowStepDef[],
): StepInput {
  // If step has a prompt with template vars, resolve them
  if (stepDef.prompt) {
    const resolved = resolveTemplate(stepDef.prompt, workflowInputs, allSteps)
    return { type: 'literal', value: resolved }
  }

  // If step has explicit inputs mapping
  if (stepDef.inputs) {
    const resolved: Record<string, unknown> = {}
    for (const [key, template] of Object.entries(stepDef.inputs)) {
      resolved[key] = resolveTemplate(template, workflowInputs, allSteps)
    }
    return { type: 'literal', value: resolved }
  }

  // Default: pass workflow inputs
  return { type: 'task_input' }
}

/**
 * Simple template resolution: {{ inputs.key }} and {{ steps.id.output }}
 */
function resolveTemplate(
  template: string,
  inputs: Record<string, unknown>,
  _steps: WorkflowStepDef[],
): string {
  return template.replace(/\{\{\s*inputs\.(\w+)\s*\}\}/g, (_match, key) => {
    const val = inputs[key]
    return val !== undefined ? String(val) : `{{inputs.${key}}}`
  })
}

/**
 * Infer dependencies from template variable references to other steps.
 */
function inferDependencies(stepDef: WorkflowStepDef, allSteps: WorkflowStepDef[]): string[] {
  const deps: string[] = []
  const text = JSON.stringify(stepDef)
  const stepIds = allSteps.map((s) => s.id)

  for (const id of stepIds) {
    if (id !== stepDef.id && text.includes(`steps.${id}`)) {
      deps.push(id)
    }
  }

  return deps
}
