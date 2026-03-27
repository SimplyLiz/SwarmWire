/**
 * FileBoard — Local file-backed MessageBoard for inter-agent communication.
 *
 * Persists messages to a JSONL file (one JSON object per line, append-only).
 * No external dependencies — works without CognitiveVault, databases, or network.
 *
 * Usage:
 *   const board = new FileBoard()                       // .swarmwire/board.jsonl
 *   const board = new FileBoard({ path: '/tmp/board' }) // custom path
 *   await board.hydrate()                               // load prior messages
 *   board.post('agent-a', '*', 'Found a bug', { type: 'finding' })
 *   await board.flush()
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { MessageBoard } from '../core/messageboard.js'
import type { Message, PostOptions } from '../core/messageboard.js'

export interface FileBoardConfig {
  /** Path to the JSONL file (default: .swarmwire/board.jsonl) */
  path?: string
  /** Session ID for grouping (default: auto-generated) */
  sessionId?: string
  /** Whether to persist (default: true) */
  persist?: boolean
}

interface SerializedMessage {
  id: string
  from: string
  to: string
  content: string
  type: string
  priority: string
  channel?: string
  data?: unknown
  timestamp: number
  sessionId: string
}

export class FileBoard extends MessageBoard {
  private filePath: string
  private sessionId: string
  private shouldPersist: boolean
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(config: FileBoardConfig = {}) {
    super()
    this.filePath = resolve(config.path ?? '.swarmwire/board.jsonl')
    this.sessionId = config.sessionId ?? generateSessionId()
    this.shouldPersist = config.persist ?? true

    // Ensure directory exists
    if (this.shouldPersist) {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }
  }

  /**
   * Post a message. Appends to JSONL file in the background.
   */
  override post(from: string, to: string | '*', content: string, options: PostOptions = {}): Message {
    const msg = super.post(from, to, content, options)

    if (this.shouldPersist) {
      this.writeQueue = this.writeQueue
        .then(() => this.appendMessage(msg))
        .catch((err) => console.warn('[file-board] write failed:', err))
    }

    return msg
  }

  /**
   * Load messages from the JSONL file into the in-memory board.
   * Optionally filter by session ID.
   */
  async hydrate(sessionId?: string): Promise<number> {
    if (!existsSync(this.filePath)) return 0

    const filterSession = sessionId ?? undefined // undefined = load all
    let count = 0

    try {
      const content = readFileSync(this.filePath, 'utf-8')
      const lines = content.split('\n').filter((l) => l.trim())

      for (const line of lines) {
        try {
          const msg = JSON.parse(line) as SerializedMessage
          if (filterSession && msg.sessionId !== filterSession) continue

          super.post(msg.from, msg.to, msg.content, {
            type: msg.type as any,
            priority: msg.priority as any,
            channel: msg.channel,
            data: { ...(msg.data as object ?? {}), _hydrated: true, _fileId: msg.id },
          })
          count++
        } catch {
          // Skip malformed lines
        }
      }
    } catch (err) {
      console.warn('[file-board] hydrate failed:', err)
    }

    return count
  }

  /** Wait for all pending writes to complete. */
  async flush(): Promise<void> {
    await this.writeQueue
  }

  /** Get the session ID. */
  get session(): string {
    return this.sessionId
  }

  /** Get the file path. */
  get path(): string {
    return this.filePath
  }

  // --- Private ---

  private appendMessage(msg: Message): void {
    const serialized: SerializedMessage = {
      id: msg.id,
      from: msg.from,
      to: msg.to,
      content: msg.content,
      type: msg.type,
      priority: msg.priority,
      channel: msg.channel,
      data: msg.data,
      timestamp: msg.timestamp,
      sessionId: this.sessionId,
    }
    appendFileSync(this.filePath, JSON.stringify(serialized) + '\n')
  }
}

function generateSessionId(): string {
  const date = new Date().toISOString().slice(0, 10)
  const hex = Math.random().toString(16).slice(2, 6)
  return `${date}-${hex}`
}
