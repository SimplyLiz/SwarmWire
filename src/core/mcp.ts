/**
 * MCP tool integration — load tools from MCP servers.
 *
 * Uses the official @modelcontextprotocol/sdk when available (proper protocol
 * handling, capability negotiation, resource/prompt support).
 * Falls back to a minimal hand-rolled JSON-RPC client if the SDK isn't installed.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import type { Tool } from '../types/tool.js'

export interface McpServerConfig {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
}

/**
 * Connect to an MCP server and load its tools.
 * Tries the official SDK first, falls back to raw JSON-RPC.
 */
export async function loadMcpTools(config: McpServerConfig | string): Promise<Tool[]> {
  const serverConfig = typeof config === 'string' ? parseCommand(config) : config

  // Try official MCP SDK first
  try {
    return await loadWithOfficialSdk(serverConfig)
  } catch {
    // SDK not installed or failed — fall back to raw client
    return await loadWithRawClient(serverConfig)
  }
}

function parseCommand(cmd: string): McpServerConfig {
  const parts = cmd.split(/\s+/)
  return { command: parts[0]!, args: parts.slice(1) }
}

// ─── Official SDK Path ───

async function loadWithOfficialSdk(config: McpServerConfig): Promise<Tool[]> {
  // Dynamic import — @modelcontextprotocol/sdk is an optional peer dep
  // @ts-expect-error — optional peer dependency
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  // @ts-expect-error — optional peer dependency
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')

  const client = new Client({ name: 'swarmwire', version: '0.1.0' })
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    cwd: config.cwd,
    env: config.env ? { ...process.env, ...config.env } as Record<string, string> : undefined,
  })

  await client.connect(transport)

  const { tools: toolDefs } = await client.listTools() as { tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }

  return toolDefs.map((def: { name: string; description?: string; inputSchema?: unknown }) => ({
    name: def.name,
    description: def.description ?? '',
    inputSchema: (def.inputSchema ?? {}) as Record<string, unknown>,
    async execute(input: unknown): Promise<unknown> {
      const result = await client.callTool({ name: def.name, arguments: input as Record<string, unknown> })
      const textParts = (result.content as Array<{ type: string; text?: string }>)
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text ?? '') ?? []
      return textParts.join('')
    },
  }))
}

// ─── Fallback: Raw JSON-RPC ───

interface McpToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

async function loadWithRawClient(config: McpServerConfig): Promise<Tool[]> {
  const client = new RawMcpClient(config)
  try {
    await client.initialize()
    const toolDefs = await client.listTools()
    return toolDefs.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      async execute(input: unknown): Promise<unknown> {
        return client.callTool(def.name, input)
      },
    }))
  } catch (err) {
    client.close()
    throw err
  }
}

class RawMcpClient {
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

    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'swarmwire', version: '0.1.0' },
    })

    this.sendNotification('notifications/initialized')
  }

  async listTools(): Promise<McpToolDef[]> {
    const result = await this.send('tools/list', {}) as { tools?: McpToolDef[] }
    return result.tools ?? []
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    const result = await this.send('tools/call', { name, arguments: args }) as {
      content?: Array<{ type: string; text?: string }>
    }
    return result.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('') ?? ''
  }

  close(): void {
    this.process?.kill()
    this.process = null
  }

  private send(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })

      const msg = { jsonrpc: '2.0', id, method, params }
      this.process?.stdin?.write(JSON.stringify(msg) + '\n')

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
        const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } }
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          if (msg.error) p.reject(new Error(`MCP error: ${msg.error.message}`))
          else p.resolve(msg.result)
        }
      } catch {
        // Ignore unparseable lines
      }
    }
  }
}
