import { describe, it, expect, vi } from 'vitest'
import { runLoop } from '../../src/patterns/loop-agent.js'
import { createAgent } from '../../src/core/agent-factory.js'
import type { Provider } from '../../src/types/provider.js'

function mockProvider(responses: string[]): Provider {
  let i = 0
  return {
    name: 'mock',
    chat: vi.fn(async () => ({
      content: responses[i++ % responses.length] ?? 'response',
      inputTokens: 5,
      outputTokens: 5,
      cachedInputTokens: 0,
      durationMs: 1,
    })),
    countTokens: vi.fn(async () => 5),
  } as unknown as Provider
}

describe('runLoop', () => {
  it('runs agent once and returns when shouldStop returns true immediately', async () => {
    const agent = createAgent({
      name: 'test-agent',
      role: 'tester',
      execute: async (input) => `processed: ${String(input)}`,
    })
    const provider = mockProvider(['response'])
    const result = await runLoop('hello', {
      agent,
      provider,
      model: { model: 'test-model' },
      maxIterations: 3,
      shouldStop: () => true,
    })
    expect(result.iterations).toBe(1)
    expect(result.converged).toBe(true)
  })

  it('loops up to maxIterations when shouldStop never fires', async () => {
    const agent = createAgent({
      name: 'looper',
      role: 'looper',
      execute: async () => 'not done yet',
    })
    const result = await runLoop('start', {
      agent,
      provider: mockProvider(['not done']),
      model: { model: 'test-model' },
      maxIterations: 4,
      shouldStop: () => false,
    })
    expect(result.iterations).toBe(4)
    expect(result.converged).toBe(false)
  })

  it('refine transforms input for next iteration', async () => {
    const inputs: unknown[] = []
    const agent = createAgent({
      name: 'recorder',
      role: 'recorder',
      execute: async (input) => { inputs.push(input); return `step:${String(input)}` },
    })
    let iter = 0
    await runLoop(0, {
      agent,
      provider: mockProvider(['x']),
      model: { model: 'test-model' },
      maxIterations: 3,
      shouldStop: () => false,
      refine: (output) => parseInt(String(output).replace('step:', '')) + 1,
    })
    expect(inputs[0]).toBe(0)
    expect(inputs[1]).toBe(1)
  })

  it('history records all iterations', async () => {
    const agent = createAgent({
      name: 'hist',
      role: 'hist',
      execute: async (_, ctx) => `iter${ctx.executionId}`,
    })
    const result = await runLoop('start', {
      agent,
      provider: mockProvider(['x']),
      model: { model: 'test-model' },
      maxIterations: 3,
      shouldStop: () => false,
    })
    expect(result.history).toHaveLength(3)
  })

  it('detects DONE signal by default', async () => {
    const agent = createAgent({
      name: 'done-agent',
      role: 'done-agent',
      execute: async () => 'Task complete DONE',
    })
    const result = await runLoop('start', {
      agent,
      provider: mockProvider(['DONE']),
      model: { model: 'test-model' },
      maxIterations: 10,
    })
    expect(result.converged).toBe(true)
    expect(result.iterations).toBe(1)
  })

  it('calls onIteration callback', async () => {
    const iterations: number[] = []
    const agent = createAgent({
      name: 'cb',
      role: 'cb',
      execute: async () => 'DONE',
    })
    await runLoop('x', {
      agent,
      provider: mockProvider([]),
      model: { model: 'test-model' },
      maxIterations: 2,
      onIteration: (i) => iterations.push(i),
    })
    expect(iterations).toContain(1)
  })
})
