/**
 * Session / Thread Management — persistent named conversations across swarm.run() calls.
 */

import type { MemoryBackend } from '../types/memory.js'

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  executionId?: string
  costCents?: number
}

export interface Session {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  messages: ConversationMessage[]
  context: Record<string, unknown>
  archived: boolean
}

export interface SessionConfig {
  storage?: MemoryBackend
  /** Max messages to retain in active context window. Default 20 */
  maxMessages?: number
}

export class SessionManager {
  private readonly sessions: Map<string, Session> = new Map()
  private readonly byName: Map<string, string> = new Map()
  private readonly config: SessionConfig

  constructor(config: SessionConfig = {}) {
    this.config = config
  }

  create(name: string, initialContext: Record<string, unknown> = {}): Session {
    const id = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const now = Date.now()
    const session: Session = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      messages: [],
      context: initialContext,
      archived: false,
    }
    this.sessions.set(id, session)
    this.byName.set(name, id)
    return session
  }

  get(idOrName: string): Session | undefined {
    return this.sessions.get(idOrName) ?? this.sessions.get(this.byName.get(idOrName) ?? '')
  }

  list(includeArchived = false): Session[] {
    const all = [...this.sessions.values()]
    return includeArchived ? all : all.filter((s) => !s.archived)
  }

  archive(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    session.archived = true
    session.updatedAt = Date.now()
    return true
  }

  delete(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    this.byName.delete(session.name)
    this.sessions.delete(id)
    return true
  }

  record(
    sessionId: string,
    userMessage: string,
    assistantMessage: string,
    meta: { executionId?: string; costCents?: number } = {},
  ): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const now = Date.now()
    session.messages.push({ role: 'user', content: userMessage, timestamp: now, ...meta })
    session.messages.push({ role: 'assistant', content: assistantMessage, timestamp: now, ...meta })
    session.updatedAt = now

    if (this.config.storage) {
      void this.config.storage.store(sessionId, JSON.stringify(session), { tags: ['session'] })
    }
  }

  /** Format session history for prepending to a task input. */
  getContext(sessionId: string, maxMessages?: number): string {
    const session = this.sessions.get(sessionId)
    if (!session || session.messages.length === 0) return ''

    const limit = maxMessages ?? this.config.maxMessages ?? 20
    const messages = session.messages.slice(-limit)

    return messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n') + '\n'
  }

  async flush(): Promise<void> {
    if (!this.config.storage) return
    for (const session of this.sessions.values()) {
      await this.config.storage.store(session.id, JSON.stringify(session), { tags: ['session'] })
    }
  }

  async hydrate(): Promise<void> {
    if (!this.config.storage) return
    const items = await this.config.storage.query('session', { tags: ['session'], maxItems: 1000 })
    for (const item of items) {
      try {
        const session = JSON.parse(item.value as string) as Session
        this.sessions.set(session.id, session)
        this.byName.set(session.name, session.id)
      } catch {
        // Skip malformed entries
      }
    }
  }
}
