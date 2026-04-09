/**
 * A2A Client — consume external A2A agents as SwarmWire agents.
 *
 * Supports:
 * - Agent card discovery via /.well-known/agent-card.json
 * - message/send with polling
 * - message/stream with SSE
 * - Multi-turn conversations (input-required handling)
 * - tasks/cancel
 * - Authentication (Bearer, API key)
 */

import type { Agent, AgentContext } from '../types/agent.js'
import type {
  AgentCard,
  A2ATask,
  A2AMessage,
  A2AStreamEvent,
  JsonRpcRequest,
  JsonRpcResponse,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
} from './types.js'

// ─── Config ────────────────────────────────────────────────────

export interface A2AClientConfig {
  /** Base URL of the A2A server */
  url: string
  /** Timeout for task completion (ms). Default 60_000 */
  timeoutMs?: number
  /** Poll interval when waiting for task completion (ms). Default 1_000 */
  pollIntervalMs?: number
  /** Use streaming (SSE) instead of polling when available. Default true */
  streaming?: boolean
  /** Authentication config */
  auth?: A2AClientAuth
  /** Callback for multi-turn: called when agent requests input */
  onInputRequired?: (prompt: string) => Promise<string>
  /** Callback for streaming updates */
  onStreamEvent?: (event: A2AStreamEvent) => void
  /** Context ID for cross-task threading (ACP alignment). */
  contextId?: string
}

export type A2AClientAuth =
  | { type: 'bearer'; token: string }
  | { type: 'apiKey'; name: string; value: string; in: 'header' | 'query' }

// ─── Client ────────────────────────────────────────────────────

/**
 * Import an external A2A agent as a SwarmWire Agent.
 */
export async function importA2AAgent(config: A2AClientConfig): Promise<Agent> {
  const baseUrl = config.url.replace(/\/$/, '')
  const timeoutMs = config.timeoutMs ?? 60_000
  const pollIntervalMs = config.pollIntervalMs ?? 1_000
  const useStreaming = config.streaming ?? true

  // Fetch agent card — try canonical path first, fall back to legacy
  let card: AgentCard
  const cardRes = await fetchWithAuth(`${baseUrl}/.well-known/agent-card.json`, config.auth)
  if (cardRes.ok) {
    card = await cardRes.json() as AgentCard
  } else {
    const legacyRes = await fetchWithAuth(`${baseUrl}/.well-known/agent.json`, config.auth)
    if (!legacyRes.ok) throw new Error(`Failed to fetch A2A agent card: ${cardRes.status}`)
    card = await legacyRes.json() as AgentCard
  }

  let rpcId = 0

  const agent: Agent = {
    id: `a2a_${card.name}_${Date.now().toString(36)}`,
    name: card.name,
    role: card.description,
    capabilities: card.skills?.map((s) => s.id) ?? [],
    tools: [],
    modelTier: 'standard',
    systemPrompt: undefined,
    maxTokens: undefined,
    maxCostCents: undefined,
    timeoutMs,
    deps: {},

    async execute(input: unknown, _context: AgentContext): Promise<unknown> {
      const text = typeof input === 'string' ? input : JSON.stringify(input)
      const message: A2AMessage = { role: 'user', parts: [{ type: 'text', text }] }

      // Use streaming if server supports it and client hasn't disabled it
      if (useStreaming && card.capabilities?.streaming) {
        return executeViaStream(baseUrl, message, config, () => ++rpcId, timeoutMs)
      }

      return executeViaPolling(baseUrl, message, config, () => ++rpcId, timeoutMs, pollIntervalMs)
    },
  }

  return agent
}

// ─── Polling execution ─────────────────────────────────────────

async function executeViaPolling(
  baseUrl: string,
  message: A2AMessage,
  config: A2AClientConfig,
  nextId: () => number,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<string> {
  // Send task
  const sendResult = await rpcCall<A2ATask>(baseUrl, 'message/send', { message }, nextId(), config.auth)
  let taskId = sendResult.id

  // Poll for completion
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const task = await rpcCall<A2ATask>(baseUrl, 'tasks/get', { id: taskId }, nextId(), config.auth)

    switch (task.status.state) {
      case 'completed':
        return extractTextFromTask(task)

      case 'failed':
        throw new Error('A2A task failed')

      case 'canceled':
        throw new Error('A2A task canceled')

      case 'rejected':
        throw new Error('A2A task rejected')

      case 'input-required': {
        if (!config.onInputRequired) {
          throw new Error('A2A agent requires input but no onInputRequired callback provided')
        }
        // Extract the prompt from the task
        const prompt = extractAgentPrompt(task)
        const userResponse = await config.onInputRequired(prompt)

        // Resume task with user input
        const resumeMessage: A2AMessage = { role: 'user', parts: [{ type: 'text', text: userResponse }] }
        const resumed = await rpcCall<A2ATask>(
          baseUrl, 'message/send',
          { taskId, message: resumeMessage },
          nextId(), config.auth,
        )
        taskId = resumed.id
        break
      }

      default:
        // submitted, working, auth-required — keep polling
        break
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }

  throw new Error(`A2A task timed out after ${timeoutMs}ms`)
}

// ─── SSE streaming execution ───────────────────────────────────

async function executeViaStream(
  baseUrl: string,
  message: A2AMessage,
  config: A2AClientConfig,
  nextId: () => number,
  timeoutMs: number,
): Promise<string> {
  const id = nextId()
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    id,
    method: 'message/stream',
    params: { message },
  }

  const res = await fetchWithAuth(baseUrl, config.auth, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (!res.ok) {
    throw new Error(`A2A stream request failed: ${res.status}`)
  }

  if (!res.body) {
    throw new Error('A2A stream response has no body')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let collectedText = ''
  let buffer = ''
  const deadline = Date.now() + timeoutMs

  try {
    while (true) {
      if (Date.now() > deadline) {
        throw new Error(`A2A stream timed out after ${timeoutMs}ms`)
      }

      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      let finished = false
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (!data) continue

        try {
          const rpcResponse = JSON.parse(data) as JsonRpcResponse
          if (rpcResponse.error) {
            throw new Error(`A2A stream error: ${rpcResponse.error.message}`)
          }

          const event = rpcResponse.result as A2AStreamEvent
          config.onStreamEvent?.(event)

          if (event.type === 'task.artifact.update') {
            const artifactEvent = event as TaskArtifactUpdateEvent
            for (const part of artifactEvent.artifact.parts) {
              if (part.type === 'text') {
                collectedText += (part as { type: 'text'; text: string }).text
              }
            }
          }

          if (event.type === 'task.status.update') {
            const statusEvent = event as TaskStatusUpdateEvent
            if (statusEvent.final) {
              finished = true
              break
            }
          }
        } catch (e) {
          if (e instanceof Error && (e.message.includes('A2A stream error') || e.message.includes('timed out'))) {
            throw e
          }
          // Skip malformed SSE data
        }
      }

      if (finished) break
    }
  } finally {
    await reader.cancel()
  }

  return collectedText
}

// ─── tasks/sendSubscribe (long-lived SSE) ─────────────────────

/**
 * Subscribe to a new task via the tasks/sendSubscribe method.
 * The SSE connection stays open for the full task lifetime.
 */
export async function streamSubscribe(
  config: A2AClientConfig,
  input: string,
  onEvent: (event: A2AStreamEvent) => void,
): Promise<void> {
  const baseUrl = config.url.replace(/\/$/, '')
  const id = Date.now()
  const message: A2AMessage = { role: 'user', parts: [{ type: 'text', text: input }] }
  const params: Record<string, unknown> = { message }
  if (config.contextId) {
    params.configuration = { contextId: config.contextId }
  }

  const request = { jsonrpc: '2.0', id, method: 'tasks/sendSubscribe', params }

  const res = await fetchWithAuth(baseUrl, config.auth, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (!res.ok || !res.body) {
    throw new Error(`tasks/sendSubscribe failed: ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (!data) continue
        try {
          const rpcResponse = JSON.parse(data) as { result?: A2AStreamEvent }
          if (rpcResponse.result) {
            onEvent(rpcResponse.result)
            if (rpcResponse.result.type === 'task.status.update' && (rpcResponse.result as { final?: boolean }).final) {
              return
            }
          }
        } catch { /* skip malformed */ }
      }
    }
  } finally {
    await reader.cancel()
  }
}

// ─── Cancel ────────────────────────────────────────────────────

/**
 * Cancel a running A2A task.
 */
export async function cancelA2ATask(baseUrl: string, taskId: string, auth?: A2AClientAuth): Promise<A2ATask> {
  return rpcCall<A2ATask>(baseUrl.replace(/\/$/, ''), 'tasks/cancel', { id: taskId }, Date.now(), auth)
}

// ─── Helpers ───────────────────────────────────────────────────

async function rpcCall<T>(baseUrl: string, method: string, params: unknown, id: number, auth?: A2AClientAuth): Promise<T> {
  const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }

  const res = await fetchWithAuth(baseUrl, auth, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (!res.ok) throw new Error(`A2A RPC ${method} failed: ${res.status}`)

  const rpcResponse = await res.json() as JsonRpcResponse
  if (rpcResponse.error) {
    throw new Error(`A2A RPC ${method} error [${rpcResponse.error.code}]: ${rpcResponse.error.message}`)
  }

  return rpcResponse.result as T
}

async function fetchWithAuth(url: string, auth?: A2AClientAuth, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)

  if (auth) {
    if (auth.type === 'bearer') {
      headers.set('Authorization', `Bearer ${auth.token}`)
    } else if (auth.type === 'apiKey') {
      if (auth.in === 'header') {
        headers.set(auth.name, auth.value)
      } else {
        const separator = url.includes('?') ? '&' : '?'
        url = `${url}${separator}${encodeURIComponent(auth.name)}=${encodeURIComponent(auth.value)}`
      }
    }
  }

  return fetch(url, { ...init, headers })
}

function extractTextFromTask(task: A2ATask): string {
  // Try artifacts first
  if (task.artifacts?.length) {
    return task.artifacts
      .flatMap((a) => a.parts)
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
  }

  // Fall back to last agent message
  if (task.history?.length) {
    const agentMessages = task.history.filter((m) => m.role === 'agent')
    if (agentMessages.length > 0) {
      const last = agentMessages[agentMessages.length - 1]!
      return last.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
    }
  }

  return ''
}

function extractAgentPrompt(task: A2ATask): string {
  if (!task.history?.length) return 'Input required'
  const agentMessages = task.history.filter((m) => m.role === 'agent')
  if (agentMessages.length === 0) return 'Input required'
  const last = agentMessages[agentMessages.length - 1]!
  return last.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n') || 'Input required'
}
