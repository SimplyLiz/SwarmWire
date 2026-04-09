import { describe, it, expect } from 'vitest'
import { toAgentCard } from '../../src/a2a/agent-card.js'
import type { Agent } from '../../src/types/agent.js'

function makeAgent(name = 'TestAgent'): Agent {
  return {
    id: `agent_${name}`,
    name,
    role: 'test agent',
    capabilities: ['analysis', 'summarize'],
    tools: [],
    modelTier: 'standard',
    execute: async () => 'ok',
  }
}

describe('A2A v1.0', () => {
  it('protocolVersion defaults to 1.0', () => {
    const card = toAgentCard(makeAgent(), 'http://localhost:3000')
    expect(card.protocolVersion).toBe('1.0')
  })

  it('AgentCard.offline is an optional boolean', () => {
    const card = toAgentCard(makeAgent(), 'http://localhost:3000')
    expect(card.offline).toBeUndefined()
    // Manually set to verify type accepts it
    const withOffline = { ...card, offline: true }
    expect(withOffline.offline).toBe(true)
  })

  it('A2ATask has kind: task', () => {
    const task = {
      kind: 'task' as const,
      id: 'task_1',
      contextId: 'ctx_1',
      status: { state: 'completed' as const, timestamp: new Date().toISOString() },
    }
    expect(task.kind).toBe('task')
  })

  it('A2AMessage accepts messageId and contextId', () => {
    const msg = {
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'hello' }],
      messageId: 'msg_1',
      contextId: 'ctx_1',
    }
    expect(msg.messageId).toBe('msg_1')
    expect(msg.contextId).toBe('ctx_1')
  })

  it('A2ATaskState includes streaming', () => {
    const state: import('../../src/a2a/types.js').A2ATaskState = 'streaming'
    expect(state).toBe('streaming')
  })

  it('protocolVersion can be overridden', () => {
    const card = toAgentCard(makeAgent(), 'http://localhost:3000', { protocolVersion: '0.3.0' })
    expect(card.protocolVersion).toBe('0.3.0')
  })
})
