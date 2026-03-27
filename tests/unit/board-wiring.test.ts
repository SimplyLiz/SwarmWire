/**
 * Tests that the MessageBoard is properly wired across all patterns.
 * Agents should be able to communicate during parallel execution.
 */

import { describe, it, expect } from 'vitest'
import { Swarm, createAgent, MessageBoard, runFanOut } from '../../src/index.js'
import { CognitiveVaultBoard } from '../../src/adapters/cognitive-vault.js'
import { FileBoard } from '../../src/adapters/file-board.js'
import type { Provider, Task } from '../../src/index.js'

function mockProvider(): Provider {
  return {
    name: 'mock',
    models: [{ model: 'mock', tier: 'cheap', inputCostPer1kTokens: 0.1, outputCostPer1kTokens: 0.3, contextWindow: 128000 }],
    async chat() {
      return { content: 'ok', model: 'mock', inputTokens: 50, outputTokens: 25, cachedInputTokens: 0, finishReason: 'stop' as const, durationMs: 20 }
    },
    estimateCost: () => 0.03,
  }
}

describe('Board wiring: Executor (DAG patterns)', () => {
  it('parallel agents can see each others messages via board', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })

    const agentA = swarm.agent({
      name: 'agent-a',
      role: 'posts a finding',
      execute: async (_input, ctx) => {
        ctx.board.post('*', 'Found a critical bug in auth.ts', { type: 'finding', data: { file: 'auth.ts' } })
        return 'a-done'
      },
    })

    const agentB = swarm.agent({
      name: 'agent-b',
      role: 'reads findings',
      execute: async (_input, ctx) => {
        // In parallel execution, agent-a may or may not have posted yet
        // But we can verify the board is real (not a stub)
        ctx.board.post('*', 'Agent B reporting in', { type: 'status' })
        const findings = ctx.board.findings()
        return { foundFindings: findings.length, posted: true }
      },
    })

    // Run sequentially so agent-b can see agent-a's message
    const result = await swarm.run('test', {
      pattern: 'pipeline',
      stages: [{ name: 'a', agent: agentA }, { name: 'b', agent: agentB }],
    })

    // result.messages should contain messages from both agents
    expect(result.messages.length).toBeGreaterThanOrEqual(2)
    expect(result.messages.some((m) => m.from === 'agent-a' && m.type === 'finding')).toBe(true)
    expect(result.messages.some((m) => m.from === 'agent-b' && m.type === 'status')).toBe(true)

    // Agent B should have seen agent A's finding (pipeline = sequential)
    const bOutput = result.agentOutputs.find((o) => o.agentName === 'agent-b')?.output as { foundFindings: number }
    expect(bOutput.foundFindings).toBe(1)
  })

  it('fan-out agents share the same board', async () => {
    const messages: string[] = []

    const agents = ['a', 'b', 'c'].map((name) =>
      createAgent({
        name,
        role: 'posts',
        execute: async (_input, ctx) => {
          ctx.board.post('*', `${name} was here`, { type: 'status' })
          return `${name}-done`
        },
      })
    )

    const task: Task = { id: 't', description: 'test', input: 'go', budget: {} }
    const result = await runFanOut(task, { agents }, [mockProvider()], {})

    // All 3 agents should have posted
    expect(result.messages.length).toBe(3)
    expect(result.messages.map((m) => m.from).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('Board wiring: Injected board persists across runs', () => {
  it('injected MessageBoard survives across swarm.run() calls', async () => {
    const board = new MessageBoard()
    const swarm = new Swarm({ providers: [mockProvider()], board })

    const agent = swarm.agent({
      name: 'worker',
      role: 'posts',
      execute: async (_input, ctx) => {
        ctx.board.post('*', `Run at ${Date.now()}`, { type: 'status' })
        return 'done'
      },
    })

    await swarm.run('run 1')
    await swarm.run('run 2')
    await swarm.run('run 3')

    // The injected board should have messages from all 3 runs
    const stats = board.stats()
    expect(stats.totalMessages).toBe(3)
  })

  it('injected board messages are visible in result.messages', async () => {
    const board = new MessageBoard()
    // Pre-populate with a message from a prior session
    board.post('prior-agent', '*', 'Legacy finding from last run', { type: 'finding' })

    const swarm = new Swarm({ providers: [mockProvider()], board })
    swarm.agent({
      name: 'current',
      role: 'reads',
      execute: async (_input, ctx) => {
        const prior = ctx.board.findings()
        return { priorFindings: prior.length }
      },
    })

    const result = await swarm.run('test')

    // Current agent should see the pre-populated finding
    const output = result.output as { priorFindings: number }
    expect(output.priorFindings).toBe(1)
  })
})

describe('Board wiring: Without board (ephemeral)', () => {
  it('works without injecting a board — ephemeral per-run', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] }) // No board config

    swarm.agent({
      name: 'worker',
      role: 'posts',
      execute: async (_input, ctx) => {
        ctx.board.post('*', 'hello', { type: 'status' })
        return 'done'
      },
    })

    const result = await swarm.run('test')
    expect(result.messages.length).toBe(1) // Ephemeral board for this run
  })
})

describe('Board wiring: FileBoard adapter', () => {
  it('FileBoard extends MessageBoard and works as injected board', async () => {
    const fileBoard = new FileBoard({ path: '/tmp/swarmwire-test-board.jsonl', persist: false })

    const swarm = new Swarm({ providers: [mockProvider()], board: fileBoard })
    swarm.agent({
      name: 'worker',
      role: 'posts',
      execute: async (_input, ctx) => {
        ctx.board.post('*', 'file-backed message', { type: 'finding' })
        return 'done'
      },
    })

    const result = await swarm.run('test')
    expect(result.messages.length).toBe(1)
    expect(result.messages[0]!.content).toBe('file-backed message')
  })
})
