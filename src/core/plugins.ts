/**
 * Plugin System — extend SwarmWire with third-party providers, patterns, guardrails, and evals.
 *
 * Usage:
 *   const swarm = new Swarm({ providers: [...] })
 *   swarm.use(myPlugin)
 *
 * Plugins can register:
 *   - Providers (LLM adapters)
 *   - Patterns (orchestration strategies)
 *   - Guardrails (safety checks)
 *   - Evals (quality metrics)
 *   - Agents (pre-configured agent templates)
 *   - Middleware (hooks into the execution pipeline)
 */

import type { Provider } from '../types/provider.js'
import type { Agent, AgentDefinition } from '../types/agent.js'
import type { Guardrail } from './guardrails.js'
import type { Eval } from '../testing/evals.js'
import type { Tool } from '../types/tool.js'

// ─── Plugin Interface ───

export interface SwarmWirePlugin {
  /** Unique plugin name */
  name: string
  /** Plugin version (semver) */
  version: string
  /** Optional description */
  description?: string

  /** Called when the plugin is registered via swarm.use() */
  install?(context: PluginContext): void | Promise<void>

  /** Providers to register */
  providers?: Provider[]
  /** Agent definitions to register */
  agents?: AgentDefinition[]
  /** Guardrails to make available */
  guardrails?: { input?: Guardrail[]; output?: Guardrail[]; toolInput?: Guardrail[]; toolOutput?: Guardrail[] }
  /** Evals to make available */
  evals?: Eval[]
  /** Tools to make available to all agents */
  tools?: Tool[]
  /** Middleware hooks */
  middleware?: PluginMiddleware
}

export interface PluginContext {
  /** Register a provider */
  addProvider(provider: Provider): void
  /** Register an agent */
  addAgent(agent: Agent): void
  /** Register a guardrail */
  addGuardrail(phase: 'input' | 'output' | 'toolInput' | 'toolOutput', guardrail: Guardrail): void
  /** Register an eval */
  addEval(eval_: Eval): void
  /** Register a tool available to all agents */
  addTool(tool: Tool): void
  /** Get current swarm config (read-only) */
  getConfig(): PluginReadOnlyConfig
}

export interface PluginReadOnlyConfig {
  providerNames: string[]
  agentNames: string[]
  registeredPlugins: string[]
}

export interface PluginMiddleware {
  /** Called before each agent execution */
  beforeExecute?(agentName: string, input: unknown): Promise<unknown> | unknown
  /** Called after each agent execution */
  afterExecute?(agentName: string, input: unknown, output: unknown): Promise<unknown> | unknown
  /** Called when an error occurs */
  onError?(agentName: string, error: Error): Promise<void> | void
}

// ─── Plugin Registry ───

export class PluginRegistry {
  private plugins = new Map<string, SwarmWirePlugin>()
  private providers = new Map<string, Provider>()
  private agents = new Map<string, Agent>()
  private guardrails: { input: Guardrail[]; output: Guardrail[]; toolInput: Guardrail[]; toolOutput: Guardrail[] } = {
    input: [], output: [], toolInput: [], toolOutput: [],
  }
  private evals: Eval[] = []
  private tools: Tool[] = []
  private middlewares: PluginMiddleware[] = []

  /**
   * Register a plugin.
   */
  async use(plugin: SwarmWirePlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`)
    }

    // Validate
    if (!plugin.name) throw new Error('Plugin must have a name')
    if (!plugin.version) throw new Error(`Plugin "${plugin.name}" must have a version`)

    this.plugins.set(plugin.name, plugin)

    // Register static declarations
    if (plugin.providers) {
      for (const p of plugin.providers) this.providers.set(p.name, p)
    }
    if (plugin.guardrails) {
      if (plugin.guardrails.input) this.guardrails.input.push(...plugin.guardrails.input)
      if (plugin.guardrails.output) this.guardrails.output.push(...plugin.guardrails.output)
      if (plugin.guardrails.toolInput) this.guardrails.toolInput.push(...plugin.guardrails.toolInput)
      if (plugin.guardrails.toolOutput) this.guardrails.toolOutput.push(...plugin.guardrails.toolOutput)
    }
    if (plugin.evals) this.evals.push(...plugin.evals)
    if (plugin.tools) this.tools.push(...plugin.tools)
    if (plugin.middleware) this.middlewares.push(plugin.middleware)

    // Call install() with context
    if (plugin.install) {
      const context = this.createContext()
      await plugin.install(context)
    }
  }

  /** Get all registered providers (plugin + built-in) */
  getProviders(): Provider[] {
    return [...this.providers.values()]
  }

  /** Get all registered agents */
  getAgents(): Agent[] {
    return [...this.agents.values()]
  }

  /** Get all guardrails for a phase */
  getGuardrails(phase: 'input' | 'output' | 'toolInput' | 'toolOutput'): Guardrail[] {
    return this.guardrails[phase]
  }

  /** Get all registered evals */
  getEvals(): Eval[] {
    return [...this.evals]
  }

  /** Get all registered tools */
  getTools(): Tool[] {
    return [...this.tools]
  }

  /** Get all middlewares */
  getMiddlewares(): PluginMiddleware[] {
    return [...this.middlewares]
  }

  /** Check if a plugin is registered */
  has(name: string): boolean {
    return this.plugins.has(name)
  }

  /** List all registered plugins */
  list(): Array<{ name: string; version: string; description?: string }> {
    return [...this.plugins.values()].map((p) => ({
      name: p.name, version: p.version, description: p.description,
    }))
  }

  /** Run beforeExecute middleware chain */
  async runBeforeExecute(agentName: string, input: unknown): Promise<unknown> {
    let current = input
    for (const mw of this.middlewares) {
      if (mw.beforeExecute) {
        current = await mw.beforeExecute(agentName, current) ?? current
      }
    }
    return current
  }

  /** Run afterExecute middleware chain */
  async runAfterExecute(agentName: string, input: unknown, output: unknown): Promise<unknown> {
    let current = output
    for (const mw of this.middlewares) {
      if (mw.afterExecute) {
        current = await mw.afterExecute(agentName, input, current) ?? current
      }
    }
    return current
  }

  /** Run onError middleware chain */
  async runOnError(agentName: string, error: Error): Promise<void> {
    for (const mw of this.middlewares) {
      if (mw.onError) {
        await mw.onError(agentName, error)
      }
    }
  }

  private createContext(): PluginContext {
    return {
      addProvider: (p) => this.providers.set(p.name, p),
      addAgent: (a) => this.agents.set(a.name, a),
      addGuardrail: (phase, g) => this.guardrails[phase].push(g),
      addEval: (e) => this.evals.push(e),
      addTool: (t) => this.tools.push(t),
      getConfig: () => ({
        providerNames: [...this.providers.keys()],
        agentNames: [...this.agents.keys()],
        registeredPlugins: [...this.plugins.keys()],
      }),
    }
  }
}

// ─── Plugin Helpers ───

/**
 * Create a plugin from a simple definition.
 */
export function definePlugin(def: SwarmWirePlugin): SwarmWirePlugin {
  return def
}
