/**
 * Claude Agent SDK adapter — wrap Claude Agent SDK sessions as SwarmWire agents.
 * Peer dependency: @anthropic-ai/claude-agent-sdk
 */

import type { Agent, AgentContext } from '../types/agent.js'

export interface ClaudeAgentConfig {
  /** Agent name in SwarmWire */
  name: string
  /** Role description */
  role?: string
  /** Claude Agent SDK options passed to the session */
  sdkOptions?: Record<string, unknown>
  /** System prompt for the agent */
  systemPrompt?: string
  /** Max tokens per turn */
  maxTokens?: number
  /** Capabilities for routing */
  capabilities?: string[]
}

/**
 * Create a SwarmWire Agent backed by Claude Agent SDK.
 * The SDK handles tool use, file operations, and shell commands internally.
 */
export async function fromClaudeAgentSDK(config: ClaudeAgentConfig): Promise<Agent> {
  // Lazy import to avoid hard dependency
  let createSession: (opts: unknown) => Promise<ClaudeSession>
  try {
    // @ts-expect-error — optional peer dependency, only loaded if installed
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    createSession = (sdk as { createSession: typeof createSession }).createSession
      ?? (sdk as { default: { createSession: typeof createSession } }).default.createSession
  } catch {
    throw new Error(
      'swarmwire: @anthropic-ai/claude-agent-sdk is required for the Claude Agent SDK adapter. Install it: npm install @anthropic-ai/claude-agent-sdk'
    )
  }

  const _idCounter = 0

  const agent: Agent = {
    id: `claude_sdk_${config.name}_${Date.now().toString(36)}`,
    name: config.name,
    role: config.role ?? 'Claude Agent SDK agent',
    capabilities: config.capabilities ?? ['code', 'shell', 'file-operations', 'web-search'],
    tools: [],
    modelTier: 'premium',
    systemPrompt: config.systemPrompt,
    maxTokens: config.maxTokens,
    maxCostCents: undefined,
    timeoutMs: 120_000,
    deps: {},

    async execute(input: unknown, _context: AgentContext): Promise<unknown> {
      const prompt = typeof input === 'string' ? input : JSON.stringify(input)

      const session = await createSession({
        ...config.sdkOptions,
        systemPrompt: config.systemPrompt,
      })

      try {
        const result = await (session as { run: (p: string) => Promise<{ text: string }> }).run(prompt)
        return result.text ?? result
      } finally {
        if ('close' in (session as Record<string, unknown>)) {
          await (session as { close: () => Promise<void> }).close()
        }
      }
    },
  }

  return agent
}

// Minimal type placeholder
type ClaudeSession = unknown
