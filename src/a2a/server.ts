/**
 * A2A Server — expose SwarmWire agents as A2A-compatible endpoints.
 * Implements the Agent2Agent protocol task lifecycle.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Agent } from '../types/agent.js'
import { toAgentCard, type AgentCard } from './agent-card.js'

export interface A2AServerConfig {
  port: number
  agents: Agent[]
  host?: string
}

export interface A2ATask {
  id: string
  status: A2ATaskStatus
  input: A2AMessage
  output?: A2AMessage
  history: A2ATaskEvent[]
  createdAt: number
}

export type A2ATaskStatus = 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled'

export interface A2AMessage {
  role: 'user' | 'agent'
  parts: A2APart[]
}

export interface A2APart {
  type: 'text' | 'data'
  text?: string
  data?: unknown
  mimeType?: string
}

export interface A2ATaskEvent {
  status: A2ATaskStatus
  timestamp: number
  message?: A2AMessage
}

/**
 * Start an A2A server that exposes agents via HTTP.
 */
export function startA2AServer(config: A2AServerConfig): { close: () => void; url: string } {
  const { port, agents, host = 'localhost' } = config
  const baseUrl = `http://${host}:${port}`
  const agentMap = new Map(agents.map((a) => [a.name, a]))
  const tasks = new Map<string, A2ATask>()

  let taskCounter = 0

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', baseUrl)

    try {
      // GET /.well-known/agent.json — Agent Card discovery
      if (req.method === 'GET' && url.pathname === '/.well-known/agent.json') {
        const cards = agents.map((a) => toAgentCard(a, baseUrl))
        sendJson(res, 200, cards.length === 1 ? cards[0] : cards)
        return
      }

      // GET /a2a/:agentName — Individual Agent Card
      const cardMatch = url.pathname.match(/^\/a2a\/([^/]+)$/)
      if (req.method === 'GET' && cardMatch) {
        const agent = agentMap.get(cardMatch[1]!)
        if (!agent) { sendJson(res, 404, { error: 'Agent not found' }); return }
        sendJson(res, 200, toAgentCard(agent, baseUrl))
        return
      }

      // POST /a2a/:agentName/tasks/send — Submit a task
      const taskMatch = url.pathname.match(/^\/a2a\/([^/]+)\/tasks\/send$/)
      if (req.method === 'POST' && taskMatch) {
        const agent = agentMap.get(taskMatch[1]!)
        if (!agent) { sendJson(res, 404, { error: 'Agent not found' }); return }

        const body = await readBody(req)
        const request = JSON.parse(body)

        const taskId = `task_${++taskCounter}_${Date.now().toString(36)}`
        const inputMessage: A2AMessage = request.params?.message ?? { role: 'user', parts: [{ type: 'text', text: body }] }

        const task: A2ATask = {
          id: taskId,
          status: 'submitted',
          input: inputMessage,
          history: [{ status: 'submitted', timestamp: Date.now() }],
          createdAt: Date.now(),
        }
        tasks.set(taskId, task)

        // Execute async
        executeTask(agent, task).catch(() => {
          task.status = 'failed'
          task.history.push({ status: 'failed', timestamp: Date.now() })
        })

        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: request.id,
          result: taskToResponse(task),
        })
        return
      }

      // POST /a2a/:agentName/tasks/get — Get task status
      const getMatch = url.pathname.match(/^\/a2a\/([^/]+)\/tasks\/get$/)
      if (req.method === 'POST' && getMatch) {
        const body = await readBody(req)
        const request = JSON.parse(body)
        const taskId = request.params?.id

        const task = tasks.get(taskId)
        if (!task) { sendJson(res, 404, { error: 'Task not found' }); return }

        sendJson(res, 200, {
          jsonrpc: '2.0',
          id: request.id,
          result: taskToResponse(task),
        })
        return
      }

      sendJson(res, 404, { error: 'Not found' })
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : 'Internal error' })
    }
  })

  server.listen(port, host)

  async function executeTask(agent: Agent, task: A2ATask): Promise<void> {
    task.status = 'working'
    task.history.push({ status: 'working', timestamp: Date.now() })

    const inputText = task.input.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('\n')

    const mockContext = {
      executionId: task.id,
      budgetRemaining: {},
      llm: async () => '',
      tool: async () => { throw new Error('No tools in A2A context') },
      trace: () => {},
      getStepOutput: () => undefined,
      board: { post() {}, read() { return [] }, inbox() { return [] }, findings() { return [] }, warnings() { return [] }, reply() {} },
    }

    try {
      const result = await agent.execute(inputText, mockContext as never)
      const outputText = typeof result === 'string' ? result : JSON.stringify(result)

      task.output = { role: 'agent', parts: [{ type: 'text', text: outputText }] }
      task.status = 'completed'
      task.history.push({ status: 'completed', timestamp: Date.now(), message: task.output })
    } catch (err) {
      task.status = 'failed'
      task.history.push({ status: 'failed', timestamp: Date.now() })
    }
  }

  return {
    close: () => server.close(),
    url: baseUrl,
  }
}

function taskToResponse(task: A2ATask) {
  return {
    id: task.id,
    status: { state: task.status, timestamp: Date.now() },
    artifacts: task.output ? [{ parts: task.output.parts }] : [],
    history: task.history,
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}
