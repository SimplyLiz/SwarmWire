import { describe, it, expect } from 'vitest'
import { Swarm, PluginRegistry, definePlugin } from '../../src/index.js'
import type { SwarmWirePlugin, Provider } from '../../src/index.js'

function mockProvider(name = 'mock'): Provider {
  return {
    name,
    models: [{ model: 'mock', tier: 'cheap', inputCostPer1kTokens: 0.1, outputCostPer1kTokens: 0.3, contextWindow: 128000 }],
    async chat() {
      return { content: 'ok', model: 'mock', inputTokens: 50, outputTokens: 25, cachedInputTokens: 0, finishReason: 'stop' as const, durationMs: 20 }
    },
    estimateCost: () => 0.03,
  }
}

describe('PluginRegistry', () => {
  it('registers a plugin with providers', async () => {
    const registry = new PluginRegistry()

    await registry.use({
      name: 'test-plugin',
      version: '1.0.0',
      providers: [mockProvider('plugin-provider')],
    })

    expect(registry.has('test-plugin')).toBe(true)
    expect(registry.getProviders().length).toBe(1)
    expect(registry.getProviders()[0]!.name).toBe('plugin-provider')
  })

  it('registers guardrails via plugin', async () => {
    const registry = new PluginRegistry()

    await registry.use({
      name: 'safety-plugin',
      version: '1.0.0',
      guardrails: {
        input: [{ name: 'custom-guard', async check() { return { passed: true } } }],
      },
    })

    expect(registry.getGuardrails('input').length).toBe(1)
    expect(registry.getGuardrails('input')[0]!.name).toBe('custom-guard')
  })

  it('registers evals via plugin', async () => {
    const registry = new PluginRegistry()

    await registry.use({
      name: 'eval-plugin',
      version: '1.0.0',
      evals: [{ name: 'custom-eval', score: () => 1 }],
    })

    expect(registry.getEvals().length).toBe(1)
  })

  it('registers tools via plugin', async () => {
    const registry = new PluginRegistry()

    await registry.use({
      name: 'tool-plugin',
      version: '1.0.0',
      tools: [{ name: 'my-tool', description: 'A tool', inputSchema: {}, execute: async () => 'result' }],
    })

    expect(registry.getTools().length).toBe(1)
    expect(registry.getTools()[0]!.name).toBe('my-tool')
  })

  it('calls install() with context', async () => {
    const registry = new PluginRegistry()
    const installed: string[] = []

    await registry.use({
      name: 'install-plugin',
      version: '1.0.0',
      install(ctx) {
        installed.push('installed')
        ctx.addProvider(mockProvider('dynamic-provider'))
        const config = ctx.getConfig()
        installed.push(`providers:${config.providerNames.length}`)
      },
    })

    expect(installed).toContain('installed')
    expect(registry.getProviders().some((p) => p.name === 'dynamic-provider')).toBe(true)
  })

  it('rejects duplicate plugin names', async () => {
    const registry = new PluginRegistry()
    await registry.use({ name: 'dup', version: '1.0.0' })
    await expect(registry.use({ name: 'dup', version: '2.0.0' })).rejects.toThrow('already registered')
  })

  it('rejects plugins without name or version', async () => {
    const registry = new PluginRegistry()
    await expect(registry.use({ name: '', version: '1.0.0' })).rejects.toThrow('must have a name')
    await expect(registry.use({ name: 'ok', version: '' })).rejects.toThrow('must have a version')
  })

  it('lists registered plugins', async () => {
    const registry = new PluginRegistry()
    await registry.use({ name: 'a', version: '1.0.0', description: 'First' })
    await registry.use({ name: 'b', version: '2.0.0' })

    const list = registry.list()
    expect(list.length).toBe(2)
    expect(list[0]!.name).toBe('a')
    expect(list[0]!.description).toBe('First')
  })
})

describe('Swarm.use() integration', () => {
  it('registers plugin providers into the swarm', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })

    await swarm.use({
      name: 'extra-provider',
      version: '1.0.0',
      providers: [mockProvider('extra')],
    })

    expect(swarm.listPlugins().length).toBe(1)
    expect(swarm.listPlugins()[0]!.name).toBe('extra-provider')
  })

  it('plugin agents are available in swarm.run()', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    const { createAgent } = await import('../../src/core/agent-factory.js')

    await swarm.use({
      name: 'agent-plugin',
      version: '1.0.0',
      install(ctx) {
        ctx.addAgent(createAgent({ name: 'plugin-agent', role: 'from plugin', execute: async () => 'plugin-output' }))
      },
    })

    expect(swarm.listPlugins().length).toBe(1)

    // The plugin-registered agent should be usable
    const result = await swarm.run('test')
    expect(result.output).toBe('plugin-output')
  })
})

describe('Plugin middleware', () => {
  it('runs beforeExecute and afterExecute hooks', async () => {
    const registry = new PluginRegistry()
    const log: string[] = []

    await registry.use({
      name: 'logging-plugin',
      version: '1.0.0',
      middleware: {
        async beforeExecute(agentName, input) {
          log.push(`before:${agentName}`)
          return input
        },
        async afterExecute(agentName, _input, output) {
          log.push(`after:${agentName}`)
          return output
        },
      },
    })

    await registry.runBeforeExecute('test-agent', 'input')
    await registry.runAfterExecute('test-agent', 'input', 'output')

    expect(log).toEqual(['before:test-agent', 'after:test-agent'])
  })

  it('middleware can transform input', async () => {
    const registry = new PluginRegistry()

    await registry.use({
      name: 'transform-plugin',
      version: '1.0.0',
      middleware: {
        async beforeExecute(_agentName, input) {
          return `transformed: ${input}`
        },
      },
    })

    const result = await registry.runBeforeExecute('agent', 'original')
    expect(result).toBe('transformed: original')
  })
})

describe('definePlugin helper', () => {
  it('creates a plugin from a definition', () => {
    const plugin = definePlugin({
      name: 'my-plugin',
      version: '1.0.0',
      description: 'A test plugin',
      evals: [{ name: 'test', score: () => 1 }],
    })

    expect(plugin.name).toBe('my-plugin')
    expect(plugin.evals?.length).toBe(1)
  })
})
