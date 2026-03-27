/**
 * A2A Client — consume external A2A agents as SwarmWire agents.
 */

import type { Agent, AgentContext } from '../types/agent.js'
import type { AgentCard } from './agent-card.js'

export interface A2AClientConfig {
  /** Base URL of the A2A server */
  url: string
  /** Timeout for task completion (ms). Default 60_000 */
  timeoutMs?: number
  /** Poll interval when waiting for task completion (ms). Default 1_000 */
  pollIntervalMs?: number
}

/**
 * Import an external A2A agent as a SwarmWire Agent.
 */
export async function importA2AAgent(config: A2AClientConfig): Promise<Agent> {
  const baseUrl = config.url.replace(/\/$/, '')
  const timeoutMs = config.timeoutMs ?? 60_000
  const pollIntervalMs = config.pollIntervalMs ?? 1_000

  // Fetch agent card
  const cardRes = await fetch(`${baseUrl}/.well-known/agent.json`)
  if (!cardRes.ok) throw new Error(`Failed to fetch A2A agent card: ${cardRes.status}`)
  const card = await cardRes.json() as AgentCard

  let idCounter = 0

  const agent: Agent = {
    id: `a2a_${card.name}_${Date.now().toString(36)}`,
    name: card.name,
    role: card.description,
    capabilities: card.skills.map((s) => s.id),
    tools: [],
    modelTier: 'standard',
    systemPrompt: undefined,
    maxTokens: undefined,
    maxCostCents: undefined,
    timeoutMs,

    async execute(input: unknown, _context: AgentContext): Promise<unknown> {
      const text = typeof input === 'string' ? input : JSON.stringify(input)

      // Send task
      const sendRes = await fetch(`${baseUrl}/a2a/${card.name}/tasks/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++idCounter,
          method: 'tasks/send',
          params: {
            message: {
              role: 'user',
              parts: [{ type: 'text', text }],
            },
          },
        }),
      })

      if (!sendRes.ok) throw new Error(`A2A task send failed: ${sendRes.status}`)
      const sendResult = await sendRes.json() as { result?: { id: string; status: { state: string } } }
      const taskId = sendResult.result?.id
      if (!taskId) throw new Error('A2A task send returned no task ID')

      // Poll for completion
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const getRes = await fetch(`${baseUrl}/a2a/${card.name}/tasks/get`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: ++idCounter,
            method: 'tasks/get',
            params: { id: taskId },
          }),
        })

        if (!getRes.ok) throw new Error(`A2A task get failed: ${getRes.status}`)
        const getResult = await getRes.json() as {
          result?: {
            status: { state: string }
            artifacts?: Array<{ parts: Array<{ type: string; text?: string }> }>
          }
        }

        const state = getResult.result?.status?.state
        if (state === 'completed') {
          const parts = getResult.result?.artifacts?.[0]?.parts ?? []
          return parts.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n')
        }
        if (state === 'failed' || state === 'canceled') {
          throw new Error(`A2A task ${state}`)
        }

        await new Promise((r) => setTimeout(r, pollIntervalMs))
      }

      throw new Error(`A2A task timed out after ${timeoutMs}ms`)
    },
  }

  return agent
}
