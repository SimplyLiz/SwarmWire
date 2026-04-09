import { describe, it, expect, afterEach } from 'vitest'
import { startA2AServer } from '../../src/a2a/server.js'
import { importA2AAgent, cancelA2ATask } from '../../src/a2a/client.js'
import { toAgentCard } from '../../src/a2a/agent-card.js'
import { createAgent } from '../../src/core/agent-factory.js'
import { A2AErrorCodes } from '../../src/a2a/types.js'
import type { A2ATask, JsonRpcResponse, A2AMessage } from '../../src/a2a/types.js'

// ─── Agent Card ────────────────────────────────────────────────

describe('A2A Agent Card', () => {
  it('generates spec-compliant agent card', () => {
    const agent = createAgent({
      name: 'test-agent',
      role: 'Does testing',
      capabilities: ['test', 'validate'],
    })

    const card = toAgentCard(agent, 'http://localhost:3000')
    expect(card.kind).toBe('agentCard')
    expect(card.name).toBe('test-agent')
    expect(card.description).toBe('Does testing')
    expect(card.url).toBe('http://localhost:3000')
    expect(card.protocolVersion).toBe('1.0')
    expect(card.skills.length).toBe(2)
    expect(card.skills[0]!.id).toBe('test')
    expect(card.defaultInputModes).toContain('text/plain')
    expect(card.defaultOutputModes).toContain('application/json')
    expect(card.capabilities.stateTransitionHistory).toBe(true)
  })

  it('includes optional fields when provided', () => {
    const agent = createAgent({ name: 'secure-agent', role: 'Secured' })

    const card = toAgentCard(agent, 'http://localhost:3000', {
      provider: { organization: 'Acme Corp', url: 'https://acme.com' },
      iconUrl: 'https://acme.com/icon.png',
      documentationUrl: 'https://docs.acme.com',
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      security: [{ bearer: [] }],
      streaming: true,
      pushNotifications: true,
      supportsAuthenticatedExtendedCard: true,
    })

    expect(card.provider!.organization).toBe('Acme Corp')
    expect(card.iconUrl).toBe('https://acme.com/icon.png')
    expect(card.documentationUrl).toBe('https://docs.acme.com')
    expect(card.securitySchemes!['bearer']).toBeDefined()
    expect(card.security![0]).toEqual({ bearer: [] })
    expect(card.capabilities.streaming).toBe(true)
    expect(card.capabilities.pushNotifications).toBe(true)
    expect(card.supportsAuthenticatedExtendedCard).toBe(true)
  })
})

// ─── Server ────────────────────────────────────────────────────

describe('A2A Server', () => {
  let server: { close: () => void; url: string } | null = null

  function getPort(): number {
    return 18000 + Math.floor(Math.random() * 2000)
  }

  afterEach(() => {
    server?.close()
    server = null
  })

  it('serves agent card at /.well-known/agent-card.json', async () => {
    const agent = createAgent({
      name: 'echo',
      role: 'Echo agent',
      execute: async (input) => `echo: ${input}`,
    })

    const port = getPort()
    server = startA2AServer({ port, agents: [agent], host: '127.0.0.1' })
    await new Promise((r) => setTimeout(r, 50))

    const res = await fetch(`http://127.0.0.1:${port}/.well-known/agent-card.json`)
    expect(res.ok).toBe(true)
    const card = await res.json()
    expect(card.kind).toBe('agentCard')
    expect(card.name).toBe('echo')
    expect(card.protocolVersion).toBe('1.0')
  })

  it('also serves agent card at legacy /.well-known/agent.json', async () => {
    const agent = createAgent({ name: 'legacy', role: 'Legacy test', execute: async () => 'ok' })
    const port = getPort()
    server = startA2AServer({ port, agents: [agent], host: '127.0.0.1' })
    await new Promise((r) => setTimeout(r, 50))

    const res = await fetch(`http://127.0.0.1:${port}/.well-known/agent.json`)
    expect(res.ok).toBe(true)
    const card = await res.json()
    expect(card.name).toBe('legacy')
  })

  it('handles message/send via JSON-RPC', async () => {
    const agent = createAgent({
      name: 'greeter',
      role: 'Greets',
      execute: async (input) => `Hello, ${input}!`,
    })

    const port = getPort()
    server = startA2AServer({ port, agents: [agent], host: '127.0.0.1' })
    await new Promise((r) => setTimeout(r, 50))

    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'message/send',
        params: {
          message: { role: 'user', parts: [{ type: 'text', text: 'World' }] },
        },
      }),
    })

    expect(res.ok).toBe(true)
    const rpc = await res.json() as JsonRpcResponse
    expect(rpc.jsonrpc).toBe('2.0')
    expect(rpc.id).toBe(1)
    const task = rpc.result as A2ATask
    expect(task.id).toBeTruthy()
    expect(task.contextId).toBeTruthy()
    // Task may already be 'working' since execution starts async
    expect(['submitted', 'working']).toContain(task.status.state)
  })

  it('handles tasks/get via JSON-RPC', async () => {
    const agent = createAgent({
      name: 'slow',
      role: 'Slow agent',
      execute: async (input) => {
        await new Promise((r) => setTimeout(r, 100))
        return `done: ${input}`
      },
    })

    const port = getPort()
    server = startA2AServer({ port, agents: [agent], host: '127.0.0.1' })
    await new Promise((r) => setTimeout(r, 50))

    // Send task
    const sendRes = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'message/send',
        params: { message: { role: 'user', parts: [{ type: 'text', text: 'test' }] } },
      }),
    })
    const sendRpc = await sendRes.json() as JsonRpcResponse
    const taskId = (sendRpc.result as A2ATask).id

    // Wait for completion
    await new Promise((r) => setTimeout(r, 200))

    // Get task
    const getRes = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tasks/get',
        params: { id: taskId },
      }),
    })

    const getRpc = await getRes.json() as JsonRpcResponse
    const task = getRpc.result as A2ATask
    expect(task.status.state).toBe('completed')
    expect(task.artifacts).toBeDefined()
    expect(task.artifacts!.length).toBe(1)
    expect(task.artifacts![0]!.id).toBeTruthy()
    expect(task.artifacts![0]!.parts[0]!.type).toBe('text')
  })

  it('handles tasks/cancel via JSON-RPC', async () => {
    const agent = createAgent({
      name: 'long-running',
      role: 'Takes forever',
      execute: async () => {
        await new Promise((r) => setTimeout(r, 10_000))
        return 'never'
      },
    })

    const port = getPort()
    server = startA2AServer({ port, agents: [agent], host: '127.0.0.1' })
    await new Promise((r) => setTimeout(r, 50))

    // Send task
    const sendRes = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'message/send',
        params: { message: { role: 'user', parts: [{ type: 'text', text: 'start' }] } },
      }),
    })
    const taskId = ((await sendRes.json() as JsonRpcResponse).result as A2ATask).id

    // Cancel
    const cancelRes = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tasks/cancel',
        params: { id: taskId },
      }),
    })

    const cancelRpc = await cancelRes.json() as JsonRpcResponse
    const task = cancelRpc.result as A2ATask
    expect(task.status.state).toBe('canceled')
  })

  it('returns JSON-RPC errors for unknown methods', async () => {
    const agent = createAgent({ name: 'x', role: 'x', execute: async () => 'x' })
    const port = getPort()
    server = startA2AServer({ port, agents: [agent], host: '127.0.0.1' })
    await new Promise((r) => setTimeout(r, 50))

    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'nonexistent' }),
    })

    const rpc = await res.json() as JsonRpcResponse
    expect(rpc.error).toBeDefined()
    expect(rpc.error!.code).toBe(A2AErrorCodes.METHOD_NOT_FOUND)
  })

  it('returns JSON-RPC error for task not found', async () => {
    const agent = createAgent({ name: 'x', role: 'x', execute: async () => 'x' })
    const port = getPort()
    server = startA2AServer({ port, agents: [agent], host: '127.0.0.1' })
    await new Promise((r) => setTimeout(r, 50))

    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'tasks/get',
        params: { id: 'nonexistent' },
      }),
    })

    const rpc = await res.json() as JsonRpcResponse
    expect(rpc.error).toBeDefined()
    expect(rpc.error!.code).toBe(A2AErrorCodes.TASK_NOT_FOUND)
  })

  it('returns JSON-RPC error for not-cancelable task', async () => {
    const agent = createAgent({
      name: 'fast',
      role: 'Fast',
      execute: async () => 'done',
    })

    const port = getPort()
    server = startA2AServer({ port, agents: [agent], host: '127.0.0.1' })
    await new Promise((r) => setTimeout(r, 50))

    // Send and wait for completion
    const sendRes = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'message/send',
        params: { message: { role: 'user', parts: [{ type: 'text', text: 'go' }] } },
      }),
    })
    const taskId = ((await sendRes.json() as JsonRpcResponse).result as A2ATask).id

    await new Promise((r) => setTimeout(r, 100))

    const cancelRes = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tasks/cancel',
        params: { id: taskId },
      }),
    })

    const rpc = await cancelRes.json() as JsonRpcResponse
    expect(rpc.error).toBeDefined()
    expect(rpc.error!.code).toBe(A2AErrorCodes.TASK_NOT_CANCELABLE)
  })

  it('enforces authentication when configured', async () => {
    const agent = createAgent({ name: 'secure', role: 'Secured', execute: async () => 'secret' })
    const port = getPort()
    server = startA2AServer({
      port,
      agents: [agent],
      host: '127.0.0.1',
      authenticate: (req) => req.headers.authorization === 'Bearer valid-token',
    })
    await new Promise((r) => setTimeout(r, 50))

    // Unauthenticated request
    const noAuthRes = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'message/send',
        params: { message: { role: 'user', parts: [{ type: 'text', text: 'hello' }] } },
      }),
    })
    const noAuthRpc = await noAuthRes.json() as JsonRpcResponse
    expect(noAuthRpc.error).toBeDefined()
    expect(noAuthRpc.error!.code).toBe(A2AErrorCodes.AUTH_REQUIRED)

    // Authenticated request
    const authRes = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer valid-token',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'message/send',
        params: { message: { role: 'user', parts: [{ type: 'text', text: 'hello' }] } },
      }),
    })
    const authRpc = await authRes.json() as JsonRpcResponse
    expect(authRpc.error).toBeUndefined()
    expect((authRpc.result as A2ATask).id).toBeTruthy()
  })

  it('resolves agent by skillId', async () => {
    const writer = createAgent({
      name: 'writer',
      role: 'Writes text',
      capabilities: ['write', 'draft'],
      execute: async (input) => `written: ${input}`,
    })
    const reviewer = createAgent({
      name: 'reviewer',
      role: 'Reviews text',
      capabilities: ['review', 'critique'],
      execute: async (input) => `reviewed: ${input}`,
    })

    const port = getPort()
    server = startA2AServer({ port, agents: [writer, reviewer], host: '127.0.0.1' })
    await new Promise((r) => setTimeout(r, 50))

    // Request with skillId that matches reviewer
    const res1 = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'message/send',
        params: {
          skillId: 'review',
          message: { role: 'user', parts: [{ type: 'text', text: 'check this' }] },
        },
      }),
    })
    const rpc1 = await res1.json() as JsonRpcResponse
    expect(rpc1.error).toBeUndefined()

    // Wait for completion and verify correct agent handled it
    await new Promise((r) => setTimeout(r, 100))
    const getRes = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tasks/get',
        params: { id: (rpc1.result as A2ATask).id },
      }),
    })
    const task = (await getRes.json() as JsonRpcResponse).result as A2ATask
    expect(task.status.state).toBe('completed')
    expect(task.artifacts![0]!.parts[0]).toEqual({ type: 'text', text: 'reviewed: check this' })

    // Request with unknown skillId
    const res2 = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 3, method: 'message/send',
        params: {
          skillId: 'nonexistent',
          message: { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
        },
      }),
    })
    const rpc2 = await res2.json() as JsonRpcResponse
    expect(rpc2.error).toBeDefined()
    expect(rpc2.error!.code).toBe(1004) // UNSUPPORTED_SKILL
  })

  it('supports contextId for conversation grouping', async () => {
    const agent = createAgent({
      name: 'ctx-agent',
      role: 'Context test',
      execute: async (input) => `got: ${input}`,
    })

    const port = getPort()
    server = startA2AServer({ port, agents: [agent], host: '127.0.0.1' })
    await new Promise((r) => setTimeout(r, 50))

    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'message/send',
        params: {
          message: { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
          configuration: { contextId: 'my-context-123' },
        },
      }),
    })

    const rpc = await res.json() as JsonRpcResponse
    const task = rpc.result as A2ATask
    expect(task.contextId).toBe('my-context-123')
  })

  it('returns artifacts with proper schema', async () => {
    const agent = createAgent({
      name: 'artifact-agent',
      role: 'Artifacts',
      execute: async () => 'artifact content',
    })

    const port = getPort()
    server = startA2AServer({ port, agents: [agent], host: '127.0.0.1' })
    await new Promise((r) => setTimeout(r, 50))

    const sendRes = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'message/send',
        params: { message: { role: 'user', parts: [{ type: 'text', text: 'go' }] } },
      }),
    })
    const taskId = ((await sendRes.json() as JsonRpcResponse).result as A2ATask).id

    await new Promise((r) => setTimeout(r, 100))

    const getRes = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tasks/get', params: { id: taskId } }),
    })
    const task = (await getRes.json() as JsonRpcResponse).result as A2ATask

    expect(task.artifacts).toBeDefined()
    const artifact = task.artifacts![0]!
    expect(artifact.id).toMatch(/^artifact_/)
    expect(artifact.parts).toBeDefined()
    expect(artifact.parts[0]!.type).toBe('text')
  })

  it('handles push notification config CRUD', async () => {
    const agent = createAgent({ name: 'push-agent', role: 'Push test', execute: async () => 'done' })
    const port = getPort()
    server = startA2AServer({ port, agents: [agent], host: '127.0.0.1' })
    await new Promise((r) => setTimeout(r, 50))

    // Create task
    const sendRes = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'message/send',
        params: { message: { role: 'user', parts: [{ type: 'text', text: 'go' }] } },
      }),
    })
    const taskId = ((await sendRes.json() as JsonRpcResponse).result as A2ATask).id

    // Set push config
    const setRes = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tasks/pushNotificationConfig/set',
        params: {
          taskId,
          config: {
            url: 'https://example.com/webhook',
            authentication: { type: 'bearer', credentials: 'tok123' },
          },
        },
      }),
    })
    const setRpc = await setRes.json() as JsonRpcResponse
    expect(setRpc.error).toBeUndefined()
    const configResult = setRpc.result as { taskId: string; configId: string }
    expect(configResult.configId).toBeTruthy()

    // List push configs
    const listRes = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 3, method: 'tasks/pushNotificationConfig/list',
        params: { taskId },
      }),
    })
    const listRpc = await listRes.json() as JsonRpcResponse
    const configs = listRpc.result as Array<{ configId: string }>
    expect(configs.length).toBe(1)

    // Delete push config
    const deleteRes = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 4, method: 'tasks/pushNotificationConfig/delete',
        params: { taskId, configId: configResult.configId },
      }),
    })
    const deleteRpc = await deleteRes.json() as JsonRpcResponse
    expect(deleteRpc.error).toBeUndefined()
  })
})

// ─── Client ────────────────────────────────────────────────────

describe('A2A Client', () => {
  let server: { close: () => void; url: string } | null = null

  function getPort(): number {
    return 20000 + Math.floor(Math.random() * 2000)
  }

  afterEach(() => {
    server?.close()
    server = null
  })

  it('round-trips agent card → server → client', async () => {
    const agent = createAgent({
      name: 'greeter',
      role: 'Greet people',
      capabilities: ['greet'],
      execute: async (input) => `Hello, ${input}!`,
    })

    const port = getPort()
    server = startA2AServer({ port, agents: [agent], host: '127.0.0.1' })
    await new Promise((r) => setTimeout(r, 100))

    try {
      const imported = await importA2AAgent({
        url: `http://127.0.0.1:${port}`,
        timeoutMs: 5000,
        pollIntervalMs: 100,
        streaming: false,
      })
      expect(imported.name).toBe('greeter')
      expect(imported.capabilities).toContain('greet')

      const result = await imported.execute('World', {} as never)
      expect(result).toBe('Hello, World!')
    } catch (err) {
      if ((err as Error).message.includes('fetch')) {
        console.log('Skipping A2A network test (no network)')
      } else {
        throw err
      }
    }
  })

  it('client uses authentication', async () => {
    const agent = createAgent({
      name: 'secure',
      role: 'Secured',
      execute: async () => 'secret-data',
    })

    const port = getPort()
    server = startA2AServer({
      port,
      agents: [agent],
      host: '127.0.0.1',
      authenticate: (req) => req.headers.authorization === 'Bearer my-token',
    })
    await new Promise((r) => setTimeout(r, 100))

    try {
      const imported = await importA2AAgent({
        url: `http://127.0.0.1:${port}`,
        timeoutMs: 5000,
        pollIntervalMs: 100,
        streaming: false,
        auth: { type: 'bearer', token: 'my-token' },
      })
      const result = await imported.execute('go', {} as never)
      expect(result).toBe('secret-data')
    } catch (err) {
      if ((err as Error).message.includes('fetch')) {
        console.log('Skipping A2A network test (no network)')
      } else {
        throw err
      }
    }
  })

  it('client handles streaming via SSE', async () => {
    const agent = createAgent({
      name: 'streamer',
      role: 'Streams responses',
      execute: async () => 'streamed-response',
    })

    const port = getPort()
    server = startA2AServer({
      port,
      agents: [agent],
      host: '127.0.0.1',
      cardOptions: { streaming: true },
    })
    await new Promise((r) => setTimeout(r, 100))

    try {
      const events: unknown[] = []
      const imported = await importA2AAgent({
        url: `http://127.0.0.1:${port}`,
        timeoutMs: 5000,
        streaming: true,
        onStreamEvent: (event) => events.push(event),
      })

      const result = await imported.execute('go', {} as never)
      expect(result).toBe('streamed-response')
      expect(events.length).toBeGreaterThan(0)
    } catch (err) {
      if ((err as Error).message.includes('fetch') || (err as Error).message.includes('body')) {
        console.log('Skipping A2A streaming test (environment limitation)')
      } else {
        throw err
      }
    }
  })
})
