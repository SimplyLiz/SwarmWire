/**
 * A2A Server — expose SwarmWire agents as A2A-compatible endpoints.
 *
 * Implements the A2A v0.3 protocol:
 * - JSON-RPC 2.0 dispatch on a single endpoint
 * - /.well-known/agent-card.json discovery
 * - Methods: message/send, message/stream, tasks/get, tasks/cancel
 * - Push notification config CRUD
 * - Authentication middleware support
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Agent, AgentContext } from '../types/agent.js'
import { toAgentCard, type ToAgentCardOptions } from './agent-card.js'
import type {
  AgentCard,
  A2ATask,
  A2ATaskState,
  A2AMessage,
  A2AArtifact,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  MessageSendParams,
  TaskQueryParams,
  TaskIdParams,
  TaskPushNotificationConfig,
  PushNotificationConfig,
  A2AStreamEvent,
} from './types.js'
import { A2AErrorCodes } from './types.js'

// ─── Config ────────────────────────────────────────────────────

export interface A2AServerConfig {
  /** Port to listen on (0 = OS-assigned) */
  port: number
  /** Agents to expose */
  agents: Agent[]
  /** Host to bind. Default 'localhost' */
  host?: string
  /** Agent card options (provider, security, etc.) */
  cardOptions?: ToAgentCardOptions
  /** Authentication middleware — return true to allow, false to deny */
  authenticate?: (req: IncomingMessage) => boolean | Promise<boolean>
  /** Context factory — build a real AgentContext for task execution */
  contextFactory?: (taskId: string, agent: Agent) => AgentContext
}

// ─── Internal task state ───────────────────────────────────────

interface ServerTask {
  id: string
  contextId: string
  agentName: string
  state: A2ATaskState
  messages: A2AMessage[]
  artifacts: A2AArtifact[]
  metadata: Record<string, unknown>
  createdAt: string
  lastModified: string
  pushConfigs: Map<string, PushNotificationConfig>
  /** SSE subscribers waiting for updates */
  subscribers: Set<ServerResponse>
  /** Resolve function for input-required continuation */
  inputResolve?: (message: A2AMessage) => void
}

let taskCounter = 0
function generateTaskId(): string {
  return `task_${++taskCounter}_${Date.now().toString(36)}`
}

function generateContextId(): string {
  return `ctx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function isoNow(): string {
  return new Date().toISOString()
}

// ─── Server ────────────────────────────────────────────────────

export function startA2AServer(config: A2AServerConfig): { close: () => void; url: string } {
  const { port, agents, host = 'localhost', cardOptions, authenticate } = config
  const baseUrl = `http://${host}:${port}`
  const agentMap = new Map(agents.map((a) => [a.name, a]))
  const tasks = new Map<string, ServerTask>()

  // Build cards per agent
  const cards = new Map<string, AgentCard>()
  for (const agent of agents) {
    cards.set(agent.name, toAgentCard(agent, `${baseUrl}`, {
      ...cardOptions,
      streaming: cardOptions?.streaming ?? true,
    }))
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', baseUrl)

    try {
      // ── CORS preflight ──
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders())
        res.end()
        return
      }

      // ── Agent Card discovery: GET /.well-known/agent-card.json ──
      if (req.method === 'GET' && url.pathname === '/.well-known/agent-card.json') {
        const allCards = [...cards.values()]
        sendJson(res, 200, allCards.length === 1 ? allCards[0] : allCards)
        return
      }

      // ── Legacy path support ──
      if (req.method === 'GET' && url.pathname === '/.well-known/agent.json') {
        const allCards = [...cards.values()]
        sendJson(res, 200, allCards.length === 1 ? allCards[0] : allCards)
        return
      }

      // ── JSON-RPC endpoint: POST / ──
      if (req.method === 'POST' && (url.pathname === '/' || url.pathname === '')) {
        // Auth check
        if (authenticate) {
          const allowed = await authenticate(req)
          if (!allowed) {
            sendJsonRpcError(res, null, A2AErrorCodes.AUTH_REQUIRED, 'Authentication required')
            return
          }
        }

        const body = await readBody(req)
        let request: JsonRpcRequest
        try {
          request = JSON.parse(body) as JsonRpcRequest
        } catch {
          sendJsonRpcError(res, null, A2AErrorCodes.PARSE_ERROR, 'Invalid JSON')
          return
        }

        if (!request.jsonrpc || request.jsonrpc !== '2.0' || !request.method) {
          sendJsonRpcError(res, request?.id ?? null, A2AErrorCodes.INVALID_REQUEST, 'Invalid JSON-RPC request')
          return
        }

        await handleJsonRpc(request, req, res, agentMap, tasks, cards, config)
        return
      }

      sendJson(res, 404, { error: 'Not found' })
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : 'Internal error' })
    }
  })

  server.listen(port, host)

  return {
    close: () => {
      // Close all SSE subscribers
      for (const task of tasks.values()) {
        for (const sub of task.subscribers) {
          sub.end()
        }
      }
      server.close()
    },
    url: baseUrl,
  }
}

// ─── JSON-RPC Dispatch ────────────────────────────────────────

async function handleJsonRpc(
  request: JsonRpcRequest,
  httpReq: IncomingMessage,
  res: ServerResponse,
  agentMap: Map<string, Agent>,
  tasks: Map<string, ServerTask>,
  cards: Map<string, AgentCard>,
  config: A2AServerConfig,
): Promise<void> {
  const params = (request.params ?? {}) as Record<string, unknown>

  switch (request.method) {
    case 'message/send':
      await handleMessageSend(request, params as unknown as MessageSendParams, res, agentMap, tasks, config)
      return

    case 'message/stream':
      await handleMessageStream(request, params as unknown as MessageSendParams, res, agentMap, tasks, config)
      return

    case 'tasks/get':
      handleTasksGet(request, params as unknown as TaskQueryParams, res, tasks)
      return

    case 'tasks/cancel':
      handleTasksCancel(request, params as unknown as TaskIdParams, res, tasks)
      return

    case 'tasks/resubscribe':
      handleTasksResubscribe(request, params as unknown as TaskIdParams, res, tasks)
      return

    case 'tasks/sendSubscribe':
      await handleTasksSendSubscribe(request, params as unknown as MessageSendParams, res, agentMap, tasks, config)
      return

    case 'tasks/pushNotificationConfig/set':
      handlePushConfigSet(request, params as unknown as TaskPushNotificationConfig, res, tasks)
      return

    case 'tasks/pushNotificationConfig/get':
      handlePushConfigGet(request, params as unknown as { taskId: string; configId: string }, res, tasks)
      return

    case 'tasks/pushNotificationConfig/list':
      handlePushConfigList(request, params as unknown as TaskIdParams, res, tasks)
      return

    case 'tasks/pushNotificationConfig/delete':
      handlePushConfigDelete(request, params as unknown as { taskId: string; configId: string }, res, tasks)
      return

    case 'agent/getAuthenticatedExtendedCard': {
      // Return the first agent's card with full details
      const allCards = [...cards.values()]
      sendJsonRpcResult(res, request.id, allCards.length === 1 ? allCards[0] : allCards)
      return
    }

    default:
      sendJsonRpcError(res, request.id, A2AErrorCodes.METHOD_NOT_FOUND, `Unknown method: ${request.method}`)
  }
}

// ─── message/send ──────────────────────────────────────────────

async function handleMessageSend(
  request: JsonRpcRequest,
  params: MessageSendParams,
  res: ServerResponse,
  agentMap: Map<string, Agent>,
  tasks: Map<string, ServerTask>,
  config: A2AServerConfig,
): Promise<void> {
  if (!params.message?.parts?.length) {
    sendJsonRpcError(res, request.id, A2AErrorCodes.INVALID_MESSAGE, 'Message with parts is required')
    return
  }

  // Multi-turn: resume existing task
  if (params.taskId) {
    const task = tasks.get(params.taskId)
    if (!task) {
      sendJsonRpcError(res, request.id, A2AErrorCodes.TASK_NOT_FOUND, `Task not found: ${params.taskId}`)
      return
    }
    if (task.state !== 'input-required') {
      sendJsonRpcError(res, request.id, A2AErrorCodes.INVALID_TASK_ID, `Task is not awaiting input (state: ${task.state})`)
      return
    }

    // Resume the task
    task.messages.push(params.message)
    if (task.inputResolve) {
      task.inputResolve(params.message)
      task.inputResolve = undefined
    }

    sendJsonRpcResult(res, request.id, serverTaskToA2ATask(task))
    return
  }

  // Find agent — resolve by skillId or fall back to first
  const agent = resolveAgent(agentMap, params.skillId)
  if (!agent) {
    const errMsg = params.skillId
      ? `No agent found with skill: ${params.skillId}`
      : 'No agents available'
    const errCode = params.skillId ? A2AErrorCodes.UNSUPPORTED_SKILL : A2AErrorCodes.INTERNAL_ERROR
    sendJsonRpcError(res, request.id, errCode, errMsg)
    return
  }

  const contextId = params.configuration?.contextId ?? generateContextId()
  const task = createServerTask(agent.name, contextId, params.message, params.configuration?.metadata)
  tasks.set(task.id, task)

  // Execute async — don't await, respond immediately with submitted task
  executeTask(agent, task, config).catch(() => {
    updateTaskState(task, 'failed')
  })

  sendJsonRpcResult(res, request.id, serverTaskToA2ATask(task))
}

// ─── message/stream ────────────────────────────────────────────

async function handleMessageStream(
  request: JsonRpcRequest,
  params: MessageSendParams,
  res: ServerResponse,
  agentMap: Map<string, Agent>,
  tasks: Map<string, ServerTask>,
  config: A2AServerConfig,
): Promise<void> {
  if (!params.message?.parts?.length) {
    sendJsonRpcError(res, request.id, A2AErrorCodes.INVALID_MESSAGE, 'Message with parts is required')
    return
  }

  // Multi-turn: resume existing task
  let task: ServerTask
  if (params.taskId) {
    const existing = tasks.get(params.taskId)
    if (!existing) {
      sendJsonRpcError(res, request.id, A2AErrorCodes.TASK_NOT_FOUND, `Task not found: ${params.taskId}`)
      return
    }
    if (existing.state !== 'input-required') {
      sendJsonRpcError(res, request.id, A2AErrorCodes.INVALID_TASK_ID, `Task is not awaiting input`)
      return
    }
    existing.messages.push(params.message)
    task = existing
    if (task.inputResolve) {
      task.inputResolve(params.message)
      task.inputResolve = undefined
    }
  } else {
    const agent = resolveAgent(agentMap, params.skillId)
    if (!agent) {
      const errMsg = params.skillId
        ? `No agent found with skill: ${params.skillId}`
        : 'No agents available'
      const errCode = params.skillId ? A2AErrorCodes.UNSUPPORTED_SKILL : A2AErrorCodes.INTERNAL_ERROR
      sendJsonRpcError(res, request.id, errCode, errMsg)
      return
    }
    const contextId = params.configuration?.contextId ?? generateContextId()
    task = createServerTask(agent.name, contextId, params.message, params.configuration?.metadata)
    tasks.set(task.id, task)

    // Start execution async
    const execAgent = agent
    executeTask(execAgent, task, config).catch(() => {
      updateTaskState(task, 'failed')
    })
  }

  // Set up SSE stream
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...corsHeaders(),
  })

  task.subscribers.add(res)

  // Send current status immediately
  const statusEvent: A2AStreamEvent = {
    type: 'task.status.update',
    taskId: task.id,
    status: { state: task.state, timestamp: isoNow() },
    final: isTerminal(task.state),
  }
  writeSseEvent(res, request.id, statusEvent)

  // Keep-alive heartbeat
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n')
  }, 15_000)

  // Clean up on disconnect
  req_onClose(res, () => {
    task.subscribers.delete(res)
    clearInterval(heartbeat)
  })
}

function req_onClose(res: ServerResponse, fn: () => void): void {
  res.on('close', fn)
}

// ─── tasks/get ─────────────────────────────────────────────────

function handleTasksGet(
  request: JsonRpcRequest,
  params: TaskQueryParams,
  res: ServerResponse,
  tasks: Map<string, ServerTask>,
): void {
  if (!params.id) {
    sendJsonRpcError(res, request.id, A2AErrorCodes.INVALID_PARAMS, 'Task ID is required')
    return
  }

  const task = tasks.get(params.id)
  if (!task) {
    sendJsonRpcError(res, request.id, A2AErrorCodes.TASK_NOT_FOUND, `Task not found: ${params.id}`)
    return
  }

  const result = serverTaskToA2ATask(task)
  if (params.historyLength !== undefined && result.history) {
    result.history = result.history.slice(-params.historyLength)
  }

  sendJsonRpcResult(res, request.id, result)
}

// ─── tasks/cancel ──────────────────────────────────────────────

function handleTasksCancel(
  request: JsonRpcRequest,
  params: TaskIdParams,
  res: ServerResponse,
  tasks: Map<string, ServerTask>,
): void {
  if (!params.id) {
    sendJsonRpcError(res, request.id, A2AErrorCodes.INVALID_PARAMS, 'Task ID is required')
    return
  }

  const task = tasks.get(params.id)
  if (!task) {
    sendJsonRpcError(res, request.id, A2AErrorCodes.TASK_NOT_FOUND, `Task not found: ${params.id}`)
    return
  }

  if (isTerminal(task.state)) {
    sendJsonRpcError(res, request.id, A2AErrorCodes.TASK_NOT_CANCELABLE, `Task already in terminal state: ${task.state}`)
    return
  }

  updateTaskState(task, 'canceled')
  sendJsonRpcResult(res, request.id, serverTaskToA2ATask(task))
}

// ─── tasks/sendSubscribe ───────────────────────────────────────
// Long-lived SSE subscription for the full task lifetime (ACP alignment)

async function handleTasksSendSubscribe(
  request: JsonRpcRequest,
  params: MessageSendParams,
  res: ServerResponse,
  agentMap: Map<string, Agent>,
  tasks: Map<string, ServerTask>,
  config: A2AServerConfig,
): Promise<void> {
  if (!params.message?.parts?.length) {
    sendJsonRpcError(res, request.id, A2AErrorCodes.INVALID_MESSAGE, 'Message with parts is required')
    return
  }

  const agent = resolveAgent(agentMap, params.skillId)
  if (!agent) {
    const errMsg = params.skillId ? `No agent found with skill: ${params.skillId}` : 'No agents available'
    const errCode = params.skillId ? A2AErrorCodes.UNSUPPORTED_SKILL : A2AErrorCodes.INTERNAL_ERROR
    sendJsonRpcError(res, request.id, errCode, errMsg)
    return
  }

  const contextId = params.configuration?.contextId ?? generateContextId()
  const task = createServerTask(agent.name, contextId, params.message, params.configuration?.metadata)
  tasks.set(task.id, task)

  // Set up SSE stream before starting execution
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...corsHeaders(),
  })

  task.subscribers.add(res)

  // Send initial submitted status
  writeSseEvent(res, request.id, {
    type: 'task.status.update',
    taskId: task.id,
    status: { state: 'submitted', timestamp: isoNow() },
    final: false,
  })

  const heartbeat = setInterval(() => { res.write(': heartbeat\n\n') }, 15_000)
  req_onClose(res, () => { task.subscribers.delete(res); clearInterval(heartbeat) })

  executeTask(agent, task, config).catch(() => updateTaskState(task, 'failed'))
}

// ─── tasks/resubscribe ─────────────────────────────────────────

function handleTasksResubscribe(
  request: JsonRpcRequest,
  params: TaskIdParams,
  res: ServerResponse,
  tasks: Map<string, ServerTask>,
): void {
  if (!params.id) {
    sendJsonRpcError(res, request.id, A2AErrorCodes.INVALID_PARAMS, 'Task ID is required')
    return
  }

  const task = tasks.get(params.id)
  if (!task) {
    sendJsonRpcError(res, request.id, A2AErrorCodes.TASK_NOT_FOUND, `Task not found: ${params.id}`)
    return
  }

  // Set up SSE stream
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...corsHeaders(),
  })

  task.subscribers.add(res)

  // Send current status
  const statusEvent: A2AStreamEvent = {
    type: 'task.status.update',
    taskId: task.id,
    status: { state: task.state, timestamp: isoNow() },
    final: isTerminal(task.state),
  }
  writeSseEvent(res, request.id, statusEvent)

  // If already terminal, close immediately
  if (isTerminal(task.state)) {
    res.end()
    task.subscribers.delete(res)
    return
  }

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n')
  }, 15_000)

  req_onClose(res, () => {
    task.subscribers.delete(res)
    clearInterval(heartbeat)
  })
}

// ─── Push notification config CRUD ─────────────────────────────

function handlePushConfigSet(
  request: JsonRpcRequest,
  params: TaskPushNotificationConfig,
  res: ServerResponse,
  tasks: Map<string, ServerTask>,
): void {
  const task = tasks.get(params.taskId)
  if (!task) {
    sendJsonRpcError(res, request.id, A2AErrorCodes.TASK_NOT_FOUND, `Task not found: ${params.taskId}`)
    return
  }

  if (!params.config?.url) {
    sendJsonRpcError(res, request.id, A2AErrorCodes.INVALID_WEBHOOK, 'Push notification URL is required')
    return
  }

  const configId = `push_${Date.now().toString(36)}`
  task.pushConfigs.set(configId, params.config)
  sendJsonRpcResult(res, request.id, { taskId: params.taskId, configId, config: params.config })
}

function handlePushConfigGet(
  request: JsonRpcRequest,
  params: { taskId: string; configId: string },
  res: ServerResponse,
  tasks: Map<string, ServerTask>,
): void {
  const task = tasks.get(params.taskId)
  if (!task) {
    sendJsonRpcError(res, request.id, A2AErrorCodes.TASK_NOT_FOUND, `Task not found: ${params.taskId}`)
    return
  }

  const config = task.pushConfigs.get(params.configId)
  if (!config) {
    sendJsonRpcError(res, request.id, A2AErrorCodes.INVALID_WEBHOOK, `Push config not found: ${params.configId}`)
    return
  }

  sendJsonRpcResult(res, request.id, { taskId: params.taskId, configId: params.configId, config })
}

function handlePushConfigList(
  request: JsonRpcRequest,
  params: TaskIdParams,
  res: ServerResponse,
  tasks: Map<string, ServerTask>,
): void {
  const task = tasks.get(params.id ?? (params as unknown as { taskId: string }).taskId)
  if (!task) {
    sendJsonRpcError(res, request.id, A2AErrorCodes.TASK_NOT_FOUND, 'Task not found')
    return
  }

  const configs = [...task.pushConfigs.entries()].map(([configId, config]) => ({
    taskId: task.id,
    configId,
    config,
  }))

  sendJsonRpcResult(res, request.id, configs)
}

function handlePushConfigDelete(
  request: JsonRpcRequest,
  params: { taskId: string; configId: string },
  res: ServerResponse,
  tasks: Map<string, ServerTask>,
): void {
  const task = tasks.get(params.taskId)
  if (!task) {
    sendJsonRpcError(res, request.id, A2AErrorCodes.TASK_NOT_FOUND, `Task not found: ${params.taskId}`)
    return
  }

  task.pushConfigs.delete(params.configId)
  sendJsonRpcResult(res, request.id, { success: true })
}

// ─── Task execution ────────────────────────────────────────────

function createServerTask(
  agentName: string,
  contextId: string,
  message: A2AMessage,
  metadata?: Record<string, unknown>,
): ServerTask {
  const now = isoNow()
  return {
    id: generateTaskId(),
    contextId,
    agentName,
    state: 'submitted',
    messages: [message],
    artifacts: [],
    metadata: metadata ?? {},
    createdAt: now,
    lastModified: now,
    pushConfigs: new Map(),
    subscribers: new Set(),
  }
}

/** Default timeout for task execution if agent has no timeoutMs (5 minutes) */
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000

async function executeTask(agent: Agent, task: ServerTask, config: A2AServerConfig): Promise<void> {
  updateTaskState(task, 'working')

  const inputText = task.messages
    .filter((m) => m.role === 'user')
    .flatMap((m) => m.parts)
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n')

  const context: AgentContext = config.contextFactory
    ? config.contextFactory(task.id, agent)
    : createDefaultContext(task)

  const timeoutMs = agent.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS

  try {
    const result = await Promise.race([
      agent.execute(inputText, context),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Task timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ])
    const outputText = typeof result === 'string' ? result : JSON.stringify(result)

    const outputMessage: A2AMessage = { role: 'agent', parts: [{ type: 'text', text: outputText }] }
    task.messages.push(outputMessage)

    const artifact: A2AArtifact = {
      id: `artifact_${task.id}_0`,
      parts: [{ type: 'text', text: outputText }],
    }
    task.artifacts.push(artifact)

    // Notify SSE subscribers of artifact
    broadcastEvent(task, {
      type: 'task.artifact.update',
      taskId: task.id,
      artifact,
      append: false,
      lastChunk: true,
    })

    updateTaskState(task, 'completed')
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Execution failed'
    task.messages.push({ role: 'agent', parts: [{ type: 'text', text: `Error: ${errorMsg}` }] })
    updateTaskState(task, 'failed')
  }
}

function createDefaultContext(task: ServerTask): AgentContext {
  return {
    executionId: task.id,
    budgetRemaining: {},
    llm: async (prompt: string) => {
      // Default context just returns the prompt — real usage should provide contextFactory
      return prompt
    },
    tool: async () => { throw new Error('No tools available in default A2A context — provide a contextFactory') },
    trace: () => {},
    getStepOutput: () => undefined,
    board: {
      post() {},
      read() { return [] },
      inbox() { return [] },
      findings() { return [] },
      warnings() { return [] },
      reply() {},
    },
    deps: {},
  } as AgentContext
}

// ─── State management & notifications ──────────────────────────

function updateTaskState(task: ServerTask, state: A2ATaskState): void {
  task.state = state
  task.lastModified = isoNow()

  const event: A2AStreamEvent = {
    type: 'task.status.update',
    taskId: task.id,
    status: { state, timestamp: task.lastModified },
    final: isTerminal(state),
  }

  broadcastEvent(task, event)

  // Fire push notifications
  for (const [, pushConfig] of task.pushConfigs) {
    firePushNotification(pushConfig, event).catch(() => {
      // Silently ignore push failures
    })
  }

  // Close SSE connections on terminal state
  if (isTerminal(state)) {
    for (const sub of task.subscribers) {
      sub.end()
    }
    task.subscribers.clear()
  }
}

function broadcastEvent(task: ServerTask, event: A2AStreamEvent): void {
  for (const sub of task.subscribers) {
    writeSseEvent(sub, null, event)
  }
}

async function firePushNotification(config: PushNotificationConfig, event: A2AStreamEvent): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...config.headers,
  }

  if (config.authentication) {
    if (config.authentication.type === 'bearer') {
      headers['Authorization'] = `Bearer ${config.authentication.credentials}`
    } else if (config.authentication.type === 'basic') {
      headers['Authorization'] = `Basic ${config.authentication.credentials}`
    }
  }

  await fetch(config.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(event),
  })
}

/**
 * Request input from the user during task execution.
 * Call this from within an agent's execute function to pause and wait for user input.
 */
export function requestInput(task: ServerTask, prompt: string): Promise<A2AMessage> {
  const promptMessage: A2AMessage = { role: 'agent', parts: [{ type: 'text', text: prompt }] }
  task.messages.push(promptMessage)
  updateTaskState(task, 'input-required')

  return new Promise<A2AMessage>((resolve) => {
    task.inputResolve = resolve
  })
}

// ─── Helpers ───────────────────────────────────────────────────

function isTerminal(state: A2ATaskState): boolean {
  return state === 'completed' || state === 'failed' || state === 'canceled' || state === 'rejected'
}

/**
 * Resolve which agent should handle a request.
 * If skillId is provided, find the agent whose capabilities include that skill.
 * Otherwise, fall back to the first (or only) registered agent.
 */
function resolveAgent(agentMap: Map<string, Agent>, skillId?: string): Agent | undefined {
  if (skillId) {
    for (const agent of agentMap.values()) {
      if (agent.capabilities.includes(skillId)) return agent
    }
    return undefined // No agent has this skill
  }
  return agentMap.values().next().value
}

function serverTaskToA2ATask(task: ServerTask): A2ATask {
  return {
    kind: 'task',
    id: task.id,
    contextId: task.contextId,
    status: {
      state: task.state,
      timestamp: task.lastModified,
    },
    history: task.messages,
    artifacts: task.artifacts.length > 0 ? task.artifacts : undefined,
    metadata: Object.keys(task.metadata).length > 0 ? task.metadata : undefined,
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders() })
  res.end(JSON.stringify(data))
}

function sendJsonRpcResult(res: ServerResponse, id: string | number | null, result: unknown): void {
  const response: JsonRpcResponse = { jsonrpc: '2.0', id: id ?? 0, result }
  res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() })
  res.end(JSON.stringify(response))
}

function sendJsonRpcError(res: ServerResponse, id: string | number | null, code: number, message: string, data?: unknown): void {
  const error: JsonRpcError = { code, message }
  if (data !== undefined) error.data = data
  const response: JsonRpcResponse = { jsonrpc: '2.0', id: id ?? 0, error }
  res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() })
  res.end(JSON.stringify(response))
}

function writeSseEvent(res: ServerResponse, rpcId: string | number | null, event: A2AStreamEvent): void {
  const wrapper: JsonRpcResponse = { jsonrpc: '2.0', id: rpcId ?? 0, result: event }
  res.write(`data: ${JSON.stringify(wrapper)}\n\n`)
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}
