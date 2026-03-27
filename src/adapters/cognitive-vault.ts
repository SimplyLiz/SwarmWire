/**
 * CognitiveVault MessageBoard Adapter
 *
 * Extends SwarmWire's in-process MessageBoard with durable persistence
 * via CognitiveVault's REST API. Messages are stored as vault entries
 * with structured tags, making them visible to all agents — including
 * those outside the current SwarmWire execution.
 *
 * Usage:
 *   const board = new CognitiveVaultBoard({
 *     apiUrl: 'https://cognitive-vault.com',
 *     apiKey: 'cvk_...',
 *     vaultId: 'vault-id',
 *   })
 *   await board.hydrate()  // catch up on prior messages
 *
 *   // Use normally — messages auto-persist to CV
 *   board.post('agent-a', '*', 'Found SQL injection', { type: 'finding', priority: 'urgent' })
 */

import { MessageBoard } from '../core/messageboard.js'
import type { Message, PostOptions } from '../core/messageboard.js'

export interface CognitiveVaultBoardConfig {
  /** CV API base URL (e.g., https://cognitive-vault.com) */
  apiUrl: string
  /** CV API key (Bearer token) */
  apiKey: string
  /** Target vault ID */
  vaultId: string
  /** Session ID (optional — auto-generated if omitted) */
  sessionId?: string
  /** Whether to persist messages to CV (default: true) */
  persist?: boolean
}

interface CVEntry {
  id: string
  title: string
  content: string
  tags: string[]
  createdAt: string
}

export class CognitiveVaultBoard extends MessageBoard {
  private config: Required<CognitiveVaultBoardConfig>
  private persistQueue: Promise<void> = Promise.resolve()

  constructor(config: CognitiveVaultBoardConfig) {
    super()
    this.config = {
      ...config,
      sessionId: config.sessionId ?? generateSessionId(),
      persist: config.persist ?? true,
    }
  }

  /**
   * Post a message to the board. Persists to CV in the background.
   */
  override post(from: string, to: string | '*', content: string, options: PostOptions = {}): Message {
    const msg = super.post(from, to, content, options)

    if (this.config.persist) {
      // Fire-and-forget persist — don't block the caller
      this.persistQueue = this.persistQueue
        .then(() => this.persistMessage(msg))
        .catch((err) => console.warn('[cv-board] persist failed:', err))
    }

    return msg
  }

  /**
   * Hydrate the in-memory board from CV vault entries.
   * Call this on construction to catch up on messages from prior sessions
   * or other agents outside this SwarmWire execution.
   */
  async hydrate(sessionId?: string): Promise<number> {
    const sid = sessionId ?? this.config.sessionId
    const url = new URL(`${this.config.apiUrl}/api/v1/vaults/${this.config.vaultId}/entries`)
    url.searchParams.set('tags', `session:${sid}`)
    url.searchParams.set('pageSize', '100')
    url.searchParams.set('chunkLevel', 'all')

    const res = await fetch(url.toString(), {
      headers: this.headers(),
    })

    if (!res.ok) {
      console.warn('[cv-board] hydrate failed:', res.status)
      return 0
    }

    const body = await res.json() as { data: CVEntry[] }
    let count = 0

    for (const entry of body.data) {
      // Only hydrate agent messages (have msg:* tag)
      const msgType = getTagValue(entry.tags, 'msg:')
      if (!msgType) continue

      const from = getTagValue(entry.tags, 'agent:')
      const to = getTagValue(entry.tags, 'agent:to:')
      const priority = getTagValue(entry.tags, 'msg:priority:') || 'normal'
      const channel = getTagValue(entry.tags, 'channel:')

      // Inject into the in-memory board without re-persisting
      super.post(from || 'unknown', to || '*', entry.content, {
        type: msgType as any,
        priority: priority as any,
        channel: channel || undefined,
        data: { cvEntryId: entry.id, hydrated: true },
      })
      count++
    }

    return count
  }

  /**
   * Wait for all pending persists to complete.
   */
  async flush(): Promise<void> {
    await this.persistQueue
  }

  /** Get the session ID being used */
  get sessionId(): string {
    return this.config.sessionId
  }

  // --- Private ---

  private async persistMessage(msg: Message): Promise<void> {
    const tags = [
      `session:${this.config.sessionId}`,
      `agent:${msg.from}`,
      `agent:to:${msg.to}`,
      `msg:${msg.type}`,
      `msg:priority:${msg.priority}`,
    ]

    if (msg.channel) tags.push(`channel:${msg.channel}`)

    // Check for reply threading
    const data = msg.data as Record<string, unknown> | undefined
    if (data?.replyTo) {
      tags.push(`thread:${data.replyTo}`)
    }

    const title = `${msg.type}: ${msg.content.slice(0, 80)}`

    const res = await fetch(
      `${this.config.apiUrl}/api/v1/vaults/${this.config.vaultId}/entries`,
      {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          content: msg.content,
          entryType: 'SESSION_UPDATE',
          source: 'MCP_SESSION',
          sourceAgent: msg.from,
          sourceSessionId: this.config.sessionId,
          tags,
        }),
      },
    )

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown')
      throw new Error(`CV persist failed (${res.status}): ${text}`)
    }
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
    }
  }
}

// --- Helpers ---

function generateSessionId(): string {
  const date = new Date().toISOString().slice(0, 10)
  const hex = Math.random().toString(16).slice(2, 6)
  return `${date}-${hex}`
}

function getTagValue(tags: string[], prefix: string): string | undefined {
  for (const t of tags) {
    if (t.startsWith(prefix)) {
      const val = t.slice(prefix.length)
      // Skip sub-prefixes
      if (prefix === 'agent:' && val.startsWith('to:')) continue
      if (prefix === 'msg:' && val.startsWith('priority:')) continue
      return val
    }
  }
  return undefined
}
