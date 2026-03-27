# Plugins

Extend SwarmWire with third-party providers, agents, guardrails, evals, tools, and middleware.

**Source:** `src/core/plugins.ts`

---

## Table of Contents

1. [Plugin Interface](#plugin-interface)
2. [swarm.use()](#swarmuse)
3. [Defining Plugins](#defining-plugins)
4. [Middleware Hooks](#middleware-hooks)
5. [PluginRegistry API](#pluginregistry-api)
6. [definePlugin() Helper](#defineplugin-helper)
7. [Publishing Plugins](#publishing-plugins)

---

## Plugin Interface

```typescript
interface SwarmWirePlugin {
  /** Unique plugin name */
  name: string
  /** Plugin version (semver) */
  version: string
  /** Optional description */
  description?: string

  /** Called when registered via swarm.use() */
  install?(context: PluginContext): void | Promise<void>

  /** Static declarations -- registered automatically */
  providers?: Provider[]
  agents?: AgentDefinition[]
  guardrails?: {
    input?: Guardrail[]
    output?: Guardrail[]
    toolInput?: Guardrail[]
    toolOutput?: Guardrail[]
  }
  evals?: Eval[]
  tools?: Tool[]
  middleware?: PluginMiddleware
}
```

A plugin can provide any combination of these. All fields except `name` and `version` are optional.

---

## swarm.use()

Register a plugin with the swarm:

```typescript
const swarm = new Swarm({ providers: [...] })

await swarm.use(myPlugin)
```

Registration order:
1. Validates `name` (required, must be unique) and `version` (required)
2. Registers static declarations: `providers`, `guardrails`, `evals`, `tools`, `middleware`
3. Calls `install(context)` if defined -- this is where dynamic registration happens

Duplicate names throw:

```typescript
await swarm.use(myPlugin)
await swarm.use(myPlugin) // Error: Plugin "my-plugin" is already registered
```

---

## Defining Plugins

### Plugin with providers

```typescript
import { definePlugin } from './core/plugins.js'
import type { Provider } from './types/provider.js'

const ollamaProvider: Provider = {
  name: 'ollama',
  // ... provider implementation
}

export default definePlugin({
  name: 'swarmwire-ollama',
  version: '1.0.0',
  description: 'Ollama local LLM provider for SwarmWire',
  providers: [ollamaProvider],
})
```

### Plugin with agents

```typescript
export default definePlugin({
  name: 'swarmwire-security-agents',
  version: '1.0.0',
  agents: [
    {
      name: 'sast-scanner',
      role: 'Static analysis security scanner',
      capabilities: ['security', 'code'],
      modelTier: 'standard',
      systemPrompt: 'You are a SAST scanner. Analyze code for vulnerabilities.',
    },
    {
      name: 'dependency-auditor',
      role: 'Checks dependencies for known CVEs',
      capabilities: ['security', 'dependencies'],
      modelTier: 'cheap',
      systemPrompt: 'Audit package dependencies for known vulnerabilities.',
    },
  ],
})
```

### Plugin with guardrails

```typescript
export default definePlugin({
  name: 'swarmwire-safety',
  version: '1.0.0',
  guardrails: {
    input: [
      {
        name: 'no-pii',
        description: 'Blocks PII from reaching agents',
        check: async (input) => {
          const hasPII = /\b\d{3}-\d{2}-\d{4}\b/.test(String(input))
          return { passed: !hasPII, reason: hasPII ? 'Input contains SSN' : undefined }
        },
      },
    ],
    output: [
      {
        name: 'no-secrets',
        description: 'Prevents secrets in agent output',
        check: async (output) => {
          const hasSecret = /(?:api[_-]?key|secret|password)\s*[:=]\s*\S+/i.test(String(output))
          return { passed: !hasSecret, reason: hasSecret ? 'Output contains secret' : undefined }
        },
      },
    ],
  },
})
```

The four guardrail phases:
- `input` -- checked before agent receives input
- `output` -- checked after agent produces output
- `toolInput` -- checked before a tool is called
- `toolOutput` -- checked after a tool returns

### Plugin with evals

```typescript
export default definePlugin({
  name: 'swarmwire-quality-evals',
  version: '1.0.0',
  evals: [
    {
      name: 'response-completeness',
      description: 'Checks if the response addresses all parts of the query',
      run: async (input, output) => {
        // scoring logic
        return { score: 0.85, details: 'Addressed 5/6 sub-questions' }
      },
    },
  ],
})
```

### Plugin with tools

```typescript
export default definePlugin({
  name: 'swarmwire-web-tools',
  version: '1.0.0',
  tools: [
    {
      name: 'fetch_url',
      description: 'Fetch content from a URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
        },
        required: ['url'],
      },
      execute: async ({ url }) => {
        const res = await fetch(url)
        return res.text()
      },
    },
  ],
})
```

Tools registered via plugins are available to all agents.

### Plugin with install() for dynamic registration

```typescript
export default definePlugin({
  name: 'swarmwire-dynamic',
  version: '1.0.0',

  async install(context: PluginContext) {
    // Read current config
    const config = context.getConfig()
    console.log('Registered providers:', config.providerNames)
    console.log('Registered agents:', config.agentNames)
    console.log('Registered plugins:', config.registeredPlugins)

    // Dynamically register based on environment
    if (process.env.ENABLE_OLLAMA) {
      context.addProvider(ollamaProvider)
    }

    // Register a guardrail
    context.addGuardrail('output', {
      name: 'length-limit',
      check: async (output) => ({
        passed: String(output).length < 10_000,
        reason: 'Output exceeds 10k characters',
      }),
    })

    // Register a tool
    context.addTool({
      name: 'lookup_db',
      description: 'Query the internal database',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
      execute: async ({ query }) => db.query(query),
    })
  },
})
```

### PluginContext API

```typescript
interface PluginContext {
  addProvider(provider: Provider): void
  addAgent(agent: Agent): void
  addGuardrail(phase: 'input' | 'output' | 'toolInput' | 'toolOutput', guardrail: Guardrail): void
  addEval(eval_: Eval): void
  addTool(tool: Tool): void
  getConfig(): PluginReadOnlyConfig
}

interface PluginReadOnlyConfig {
  providerNames: string[]
  agentNames: string[]
  registeredPlugins: string[]
}
```

---

## Middleware Hooks

Middleware intercepts the agent execution pipeline at three points:

```typescript
interface PluginMiddleware {
  /** Called before each agent execution. Return a modified input or void. */
  beforeExecute?(agentName: string, input: unknown): Promise<unknown> | unknown
  /** Called after each agent execution. Return a modified output or void. */
  afterExecute?(agentName: string, input: unknown, output: unknown): Promise<unknown> | unknown
  /** Called when an agent throws. */
  onError?(agentName: string, error: Error): Promise<void> | void
}
```

### Execution order

Multiple plugins can register middleware. They run in registration order:

```
beforeExecute (plugin A) -> beforeExecute (plugin B) -> agent.execute() -> afterExecute (plugin A) -> afterExecute (plugin B)
```

If `beforeExecute` returns a value, that value replaces the input for the next middleware and the agent. If it returns `undefined`/`void`, the current input passes through unchanged. Same for `afterExecute` with outputs.

### Example: Logging middleware

```typescript
export default definePlugin({
  name: 'swarmwire-logger',
  version: '1.0.0',
  middleware: {
    beforeExecute(agentName, input) {
      console.log(`[${agentName}] Input:`, JSON.stringify(input).slice(0, 200))
      // return nothing -- input passes through
    },
    afterExecute(agentName, input, output) {
      console.log(`[${agentName}] Output:`, JSON.stringify(output).slice(0, 200))
    },
    onError(agentName, error) {
      console.error(`[${agentName}] Error:`, error.message)
    },
  },
})
```

### Example: Input sanitization middleware

```typescript
export default definePlugin({
  name: 'swarmwire-sanitizer',
  version: '1.0.0',
  middleware: {
    beforeExecute(_agentName, input) {
      if (typeof input === 'string') {
        return input.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED-SSN]')
      }
      return input
    },
  },
})
```

### Example: Metrics middleware

```typescript
const metrics = new Map<string, { calls: number; totalMs: number; errors: number }>()

export default definePlugin({
  name: 'swarmwire-metrics',
  version: '1.0.0',
  middleware: {
    beforeExecute(agentName) {
      if (!metrics.has(agentName)) {
        metrics.set(agentName, { calls: 0, totalMs: 0, errors: 0 })
      }
      metrics.get(agentName)!.calls++
    },
    onError(agentName) {
      metrics.get(agentName)!.errors++
    },
  },
})
```

---

## PluginRegistry API

The `PluginRegistry` class manages all registered plugins. Typically you interact with it via `swarm.use()`, but you can use it directly:

```typescript
import { PluginRegistry } from './core/plugins.js'

const registry = new PluginRegistry()

// Register
await registry.use(myPlugin)

// Query
registry.has('my-plugin')              // boolean
registry.list()                        // [{ name, version, description }]
registry.getProviders()                // Provider[]
registry.getAgents()                   // Agent[]
registry.getGuardrails('input')        // Guardrail[]
registry.getGuardrails('output')       // Guardrail[]
registry.getGuardrails('toolInput')    // Guardrail[]
registry.getGuardrails('toolOutput')   // Guardrail[]
registry.getEvals()                    // Eval[]
registry.getTools()                    // Tool[]
registry.getMiddlewares()              // PluginMiddleware[]

// Run middleware chains
const modifiedInput = await registry.runBeforeExecute('agent-name', input)
const modifiedOutput = await registry.runAfterExecute('agent-name', input, output)
await registry.runOnError('agent-name', error)
```

---

## definePlugin() Helper

A pass-through helper for type safety and readability:

```typescript
import { definePlugin } from './core/plugins.js'

export default definePlugin({
  name: 'my-plugin',
  version: '1.0.0',
  // ... full type inference here
})
```

`definePlugin` literally returns its argument unchanged. Its only purpose is TypeScript type inference so your editor gives you autocomplete on the plugin shape.

---

## Publishing Plugins

### Package structure

```
swarmwire-plugin-foo/
  src/
    index.ts          # exports the plugin as default
  package.json
  tsconfig.json
```

### package.json

```json
{
  "name": "swarmwire-plugin-foo",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "peerDependencies": {
    "swarmwire": "^0.1.0"
  },
  "keywords": ["swarmwire", "swarmwire-plugin"]
}
```

### Entry point

```typescript
// src/index.ts
import { definePlugin } from 'swarmwire/plugins'

export default definePlugin({
  name: 'swarmwire-plugin-foo',
  version: '1.0.0',
  description: 'Adds foo capabilities to SwarmWire',
  providers: [...],
  middleware: { ... },
})
```

### Conventions

- Name: `swarmwire-plugin-<name>` or `@scope/swarmwire-plugin-<name>`
- Keywords: include `swarmwire` and `swarmwire-plugin` for discoverability
- Peer dependency: declare `swarmwire` as a peer dep, not a direct dep
- Default export: export the plugin as the default export
- Version: use semver; bump major when breaking the plugin interface

### Consumer usage

```typescript
import fooPlugin from 'swarmwire-plugin-foo'

const swarm = new Swarm({ providers: [...] })
await swarm.use(fooPlugin)
```
