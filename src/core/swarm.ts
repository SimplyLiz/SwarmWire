/**
 * Swarm — top-level orchestrator.
 * Progressive disclosure: simple one-liner to full DAG control.
 */

import type { Agent, AgentDefinition } from '../types/agent.js'
import type { Budget } from '../types/budget.js'
import type { ExecutionResult } from '../types/execution.js'
import type { Plan } from '../types/plan.js'
import type { Provider, ModelConfig } from '../types/provider.js'
import type { Task } from '../types/task.js'
import type {
  PatternName,
  SwarmEvent,
  MergeStrategy,
  ConflictStrategy,
} from '../types/pattern.js'
import type { MemoryBackend } from '../types/memory.js'
import { createAgent } from './agent-factory.js'
import { buildPlan } from '../planner/planner.js'
import { executePlan } from '../executor/executor.js'
import { runOrchestratorWorker } from '../patterns/orchestrator-worker.js'
import { runPipeline } from '../patterns/pipeline.js'
import { runMapReduce } from '../patterns/map-reduce.js'
import { PluginRegistry } from './plugins.js'
import type { SwarmWirePlugin } from './plugins.js'

export interface SwarmConfig {
   providers: Provider[]
   agents?: Agent[]
   budget?: Budget
   memory?: MemoryBackend
   defaultModel?: ModelConfig
   mergeStrategy?: MergeStrategy
   conflictResolution?: ConflictStrategy
   /** Shared MessageBoard for inter-agent communication. Persists across runs if injected.
    *  Use CognitiveVaultBoard for CV persistence, FileBoard for local persistence, or plain MessageBoard for ephemeral. */
   board?: import('./messageboard.js').MessageBoard
   /** Configuration for FileBoard when used as default MessageBoard */
   fileBoardConfig?: import('../adapters/file-board.js').FileBoardConfig
}

export type SwarmRunOptions = {
  pattern?: PatternName
  agents?: Agent[]
  budget?: Budget
  mergeStrategy?: MergeStrategy
  conflictResolution?: ConflictStrategy

  // Pipeline-specific
  stages?: Array<{ name: string; agent: Agent; optional?: boolean }>

  // MapReduce-specific
  mapper?: (input: unknown) => unknown[]
  worker?: Agent
  reducer?: Agent
  maxParallel?: number
}

type EventHandler = (event: SwarmEvent) => void

export class Swarm {
  private readonly providers: Provider[]
  private readonly registeredAgents: Map<string, Agent> = new Map()
  private readonly defaultBudget: Budget
  private readonly memory?: MemoryBackend
  private readonly defaultModel?: ModelConfig
  private readonly board?: import('./messageboard.js').MessageBoard
  private readonly eventHandlers: Map<string, EventHandler[]> = new Map()
  private readonly plugins = new PluginRegistry()

constructor(config: SwarmConfig) {
   this.providers = config.providers
   this.defaultBudget = config.budget ?? { maxCostCents: 100 }
   this.memory = config.memory
   this.defaultModel = config.defaultModel
   // Default to FileBoard for persistence, fallback to plain MessageBoard if config.board is explicitly set to null/undefined
   if (config.board !== undefined) {
     this.board = config.board
   } else {
     // Import FileBoard from compiled dist/ directory
     const { FileBoard } = require('./dist/adapters/file-board.js')
     this.board = new FileBoard(config.fileBoardConfig)
   }
   if (config.agents) {
      for (const agent of config.agents) {
        this.registeredAgents.set(agent.name, agent)
      }
    }
  }

  /** Create and register an agent. */
  agent<TInput = unknown, TOutput = unknown>(
    def: AgentDefinition<TInput, TOutput>,
  ): Agent<TInput, TOutput> {
    const agent = createAgent(def)
    this.registeredAgents.set(agent.name, agent as Agent)
    return agent
  }

  /** Register an existing agent. */
  register(agent: Agent): void {
    this.registeredAgents.set(agent.name, agent)
  }

  /** Register a plugin. Plugins can add providers, agents, guardrails, evals, tools, and middleware. */
  async use(plugin: SwarmWirePlugin): Promise<void> {
    await this.plugins.use(plugin)

    // Merge plugin registrations into the swarm
    for (const provider of this.plugins.getProviders()) {
      if (!this.providers.find((p) => p.name === provider.name)) {
        this.providers.push(provider)
      }
    }
    for (const agent of this.plugins.getAgents()) {
      this.registeredAgents.set(agent.name, agent)
    }
  }

  /** List registered plugins. */
  listPlugins(): Array<{ name: string; version: string; description?: string }> {
    return this.plugins.list()
  }

  /** Subscribe to events. */
  on(event: string, handler: EventHandler): void {
    const existing = this.eventHandlers.get(event) ?? []
    existing.push(handler)
    this.eventHandlers.set(event, existing)
  }

  /** Run a task — progressive API. */
  async run<T = unknown>(
    taskOrDescription: string | Task,
    options?: SwarmRunOptions,
  ): Promise<ExecutionResult<T>> {
    const task = normalizeTask(taskOrDescription)
    const budget = options?.budget ?? this.defaultBudget
    const agents = options?.agents ?? [...this.registeredAgents.values()]
    const pattern = options?.pattern ?? 'orchestrator-worker'

    const emitEvent = (event: SwarmEvent) => this.emit(event)

    switch (pattern) {
      case 'pipeline': {
        const stages = options?.stages ?? agents.map((a) => ({ name: a.name, agent: a }))
        return runPipeline<T>(task, { pattern: 'pipeline', stages }, this.providers, budget, emitEvent, this.board)
      }

      case 'map-reduce': {
        if (!options?.mapper || !options?.worker || !options?.reducer) {
          throw new Error('map-reduce pattern requires mapper, worker, and reducer')
        }
        return runMapReduce<T>(task, {
          pattern: 'map-reduce',
          mapper: options.mapper,
          worker: options.worker,
          reducer: options.reducer,
          maxParallel: options.maxParallel,
        }, this.providers, budget, emitEvent, this.board)
      }

      case 'orchestrator-worker':
      default: {
        return runOrchestratorWorker<T>(task, {
          pattern: 'orchestrator-worker',
          agents,
          mergeStrategy: options?.mergeStrategy,
          conflictResolution: options?.conflictResolution,
        }, this.providers, budget, emitEvent, this.board)
      }
    }
  }

  /** Plan a task without executing — inspect/modify the plan first. */
  async plan(task: string | Task, options?: {
    agents?: Agent[]
    input?: unknown
    parallel?: boolean
    stepsOptional?: boolean
  }): Promise<Plan> {
    const normalizedTask = normalizeTask(task)
    const agents = options?.agents ?? [...this.registeredAgents.values()]
    return buildPlan(normalizedTask, {
      agents,
      input: options?.input,
      parallel: options?.parallel,
      stepsOptional: options?.stepsOptional,
    })
  }

  /** Execute a pre-built plan. */
  async execute<T = unknown>(plan: Plan, options?: {
    budget?: Budget
    onApproval?: import('../types/plan.js').ApprovalCallback
  }): Promise<ExecutionResult<T>> {
    return executePlan<T>(plan, {
      providers: this.providers,
      budget: options?.budget ?? this.defaultBudget,
      emitEvent: (event) => this.emit(event),
      defaultModel: this.defaultModel,
      onApproval: options?.onApproval,
      board: this.board,
    })
  }

  /** Async iterator for streaming events during execution. */
  async *stream<T = unknown>(
    taskOrDescription: string | Task,
    options?: SwarmRunOptions,
  ): AsyncGenerator<SwarmEvent, ExecutionResult<T>, undefined> {
    const events: SwarmEvent[] = []
    let resolve: (() => void) | null = null
    let done = false

    const originalEmit = (event: SwarmEvent) => {
      events.push(event)
      resolve?.()
    }

    // Temporarily add handler
    const handler: EventHandler = originalEmit
    this.on('*', handler)

    const resultPromise = this.run<T>(taskOrDescription, options).then((result) => {
      done = true
      resolve?.()
      return result
    })

    while (!done) {
      if (events.length > 0) {
        yield events.shift()!
      } else {
        await new Promise<void>((r) => { resolve = r })
      }
    }

    // Drain remaining events
    while (events.length > 0) {
      yield events.shift()!
    }

    const result = await resultPromise
    return result
  }

  private emit(event: SwarmEvent): void {
    const handlers = [
      ...(this.eventHandlers.get(event.type) ?? []),
      ...(this.eventHandlers.get('*') ?? []),
    ]
    for (const handler of handlers) {
      try {
        handler(event)
      } catch {
        // Don't let handler errors break execution
      }
    }
  }
}

function normalizeTask(input: string | Task): Task {
  if (typeof input === 'string') {
    return {
      id: `task_${Date.now().toString(36)}`,
      description: input,
      input,
      budget: {},
    }
  }
  return input
}
