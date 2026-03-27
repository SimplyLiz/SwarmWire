/**
 * MCP tool integration — load tools from MCP servers.
 * Uses stdio transport to communicate with MCP-compatible servers.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import type { Tool } from '../types/tool.js'

export interface McpServerConfig {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/**
 * Connect to an MCP server and load its tools.
 */
export async function loadMcpTools(config: McpServerConfig | string): Promise<Tool[]> {
  const serverConfig = typeof config === 'string'
    ? parseCommand(config)
    : config

  const client = new McpStdioClient(serverConfig)

  try {
    await client.initialize()
    const toolDefs = await client.listTools()
    return toolDefs.map((def) => createToolFromMcp(def, client))
  } catch (err) {
    client.close()
    throw err
  }
}

function parseCommand(cmd: string): McpServerConfig {
  const parts = cmd.split(/\s+/)
  return {
    command: parts[0]!,
    args: parts.slice(1),
  }
}

interface McpToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

class McpStdioClient {
  private process: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private buffer = ''

  constructor(private config: McpServerConfig) {}

  async initialize(): Promise<void> {
    this.process = spawn(this.config.command, this.config.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString()
      this.processBuffer()
    })

    this.process.on('error', (err) => {
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
    })

    this.process.on('exit', () => {
      for (const p of this.pending.values()) p.reject(new Error('MCP server exited'))
      this.pending.clear()
    })

    // Send initialize
    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'swarmwire', version: '0.1.0' },
    })

    // Send initialized notification
    this.sendNotification('notifications/initialized')
  }

  async listTools(): Promise<McpToolDef[]> {
    const result = await this.send('tools/list', {}) as { tools?: McpToolDef[] }
    return result.tools ?? []
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    const result = await this.send('tools/call', { name, arguments: args }) as { content?: Array<{ type: string; text?: string }> }
    const textParts = result.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '') ?? []
    return textParts.join('')
  }

  close(): void {
    this.process?.kill()
    this.process = null
  }

  private send(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })

      const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
      this.process?.stdin?.write(JSON.stringify(msg) + '\n')

      // Timeout
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`MCP request ${method} timed out`))
        }
      }, 30_000)
    })
  }

  private sendNotification(method: string, params?: unknown): void {
    const msg = { jsonrpc: '2.0', method, params }
    this.process?.stdin?.write(JSON.stringify(msg) + '\n')
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line) as JsonRpcResponse
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          if (msg.error) {
            p.reject(new Error(`MCP error: ${msg.error.message}`))
          } else {
            p.resolve(msg.result)
          }
        }
      } catch {
        // Ignore unparseable lines (could be stderr leaking to stdout)
      }
    }
  }
}

function createToolFromMcp(def: McpToolDef, client: McpStdioClient): Tool {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    async execute(input: unknown): Promise<unknown> {
      return client.callTool(def.name, input)
    },
  }
}
