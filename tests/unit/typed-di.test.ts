import { describe, it, expect } from 'vitest'
import { createAgent } from '../../src/core/agent-factory.js'

interface MyDeps {
  dbUrl: string
  apiKey: string
  featureFlags: { newUi: boolean }
}

describe('Typed DI — AgentDefinition deps', () => {
  it('agent carries deps from definition', () => {
    const deps: MyDeps = { dbUrl: 'postgres://localhost/db', apiKey: 'sk-test', featureFlags: { newUi: true } }
    const agent = createAgent<string, string, MyDeps>({
      name: 'typed-agent',
      role: 'tester',
      deps,
    })
    expect(agent.deps.dbUrl).toBe('postgres://localhost/db')
    expect(agent.deps.apiKey).toBe('sk-test')
    expect(agent.deps.featureFlags.newUi).toBe(true)
  })

  it('agent deps default to empty object when omitted', () => {
    const agent = createAgent({ name: 'plain-agent', role: 'plain' })
    expect(agent.deps).toEqual({})
  })

  it('execute receives deps in context', async () => {
    let capturedDeps: MyDeps | undefined

    const deps: MyDeps = { dbUrl: 'db', apiKey: 'key', featureFlags: { newUi: false } }
    const agent = createAgent<string, string, MyDeps>({
      name: 'ctx-agent',
      role: 'tester',
      deps,
      execute: async (_input, ctx) => {
        capturedDeps = ctx.deps as MyDeps
        return 'done'
      },
    })

    // Create a minimal context stub to test
    const stubCtx = {
      executionId: 'test',
      budgetRemaining: { maxCostCents: 100 },
      llm: async () => '',
      tool: async () => null,
      trace: () => {},
      getStepOutput: () => undefined,
      board: { post: () => {}, read: () => [], inbox: () => [], findings: () => [], warnings: () => [], reply: () => {} },
      deps: agent.deps,
    }

    await agent.execute('input', stubCtx as Parameters<typeof agent.execute>[1])
    expect(capturedDeps!.dbUrl).toBe('db')
    expect(capturedDeps!.apiKey).toBe('key')
  })

  it('deps type is preserved in agent interface', () => {
    const deps = { timeout: 5000, retries: 3 }
    const agent = createAgent({ name: 'a', role: 'r', deps })
    // TypeScript would catch type errors here at compile time
    expect(agent.deps.timeout).toBe(5000)
    expect(agent.deps.retries).toBe(3)
  })
})
