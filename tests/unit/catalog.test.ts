import { describe, it, expect, vi } from 'vitest'
import { AgentCatalog } from '../../src/catalog/index.js'
import type { Agent } from '../../src/types/agent.js'

function makeAgent(name: string, capabilities: string[] = []): Agent {
  return {
    id: `id_${name}`,
    name,
    role: `${name} agent`,
    capabilities,
    tools: [],
    modelTier: 'standard',
    execute: vi.fn(),
  }
}

describe('AgentCatalog', () => {
  it('registers an agent', () => {
    const catalog = new AgentCatalog()
    const agent = makeAgent('analyst', ['analysis'])
    const entry = catalog.register(agent, ['data'])
    expect(entry.name).toBe('analyst')
    expect(entry.capabilities).toContain('analysis')
    expect(entry.tags).toContain('data')
  })

  it('resolves by id and name', () => {
    const catalog = new AgentCatalog()
    const agent = makeAgent('searcher')
    catalog.register(agent)
    expect(catalog.resolve(agent.id)?.name).toBe('searcher')
    expect(catalog.resolve('searcher')?.name).toBe('searcher')
  })

  it('discover by capabilities — must have ALL', () => {
    const catalog = new AgentCatalog()
    catalog.register(makeAgent('a1', ['analysis', 'summarize']))
    catalog.register(makeAgent('a2', ['analysis']))
    const results = catalog.discover({ capabilities: ['analysis', 'summarize'] })
    expect(results).toHaveLength(1)
    expect(results[0]!.name).toBe('a1')
  })

  it('discover by tags — any match', () => {
    const catalog = new AgentCatalog()
    catalog.register(makeAgent('a1'), ['ml'])
    catalog.register(makeAgent('a2'), ['backend'])
    const results = catalog.discover({ tags: ['ml'] })
    expect(results).toHaveLength(1)
    expect(results[0]!.name).toBe('a1')
  })

  it('discover returns only available by default', () => {
    const catalog = new AgentCatalog()
    const agent = makeAgent('a1', ['analysis'])
    const entry = catalog.register(agent)
    entry.available = false
    const results = catalog.discover({ capabilities: ['analysis'] })
    expect(results).toHaveLength(0)
  })

  it('semantic discover ranks by relevance', () => {
    const catalog = new AgentCatalog()
    catalog.register(makeAgent('data-analyst', ['analysis', 'data']))
    catalog.register(makeAgent('code-writer', ['coding']))
    const results = catalog.discover({ semantic: 'analyze data and find patterns' })
    expect(results[0]!.name).toBe('data-analyst')
  })

  it('heartbeat marks agent available', () => {
    const catalog = new AgentCatalog()
    const agent = makeAgent('a1')
    const entry = catalog.register(agent)
    entry.available = false
    catalog.heartbeat(agent.id)
    expect(catalog.resolve(agent.id)?.available).toBe(true)
  })

  it('unregister removes the agent', () => {
    const catalog = new AgentCatalog()
    const agent = makeAgent('a1')
    catalog.register(agent)
    expect(catalog.unregister(agent.id)).toBe(true)
    expect(catalog.resolve(agent.id)).toBeUndefined()
  })

  it('list filters by available', () => {
    const catalog = new AgentCatalog()
    const a1 = catalog.register(makeAgent('a1'))
    const a2 = catalog.register(makeAgent('a2'))
    a2.available = false
    expect(catalog.list({ available: true })).toHaveLength(1)
    expect(catalog.list({ available: false })).toHaveLength(1)
  })
})
