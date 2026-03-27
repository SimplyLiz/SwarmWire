/**
 * MessageBoard — inter-agent communication layer.
 *
 * Sits alongside the DAG execution flow. While the DAG handles structured
 * data flow (step output → next step input), the MessageBoard enables
 * ad-hoc communication:
 *
 * - Direct messages between agents
 * - Broadcast findings to all agents in the swarm
 * - Topic-based channels for domain-specific discussion
 * - Priority messages for urgent findings
 *
 * Inspired by Gas Town's mail/nudge system, but designed for
 * in-process swarm execution rather than cross-process tmux sessions.
 */

export interface Message {
  id: string
  from: string
  to: string | '*'
  channel?: string
  priority: 'normal' | 'high' | 'urgent'
  type: MessageType
  content: string
  data?: unknown
  timestamp: number
  readBy: Set<string>
}

export type MessageType =
  | 'finding'        // Agent discovered something useful
  | 'warning'        // Agent found a problem or dead end
  | 'question'       // Agent needs input from another
  | 'answer'         // Response to a question
  | 'coordination'   // Scheduling/strategy message
  | 'status'         // Progress update
  | 'custom'         // User-defined

export interface PostOptions {
  channel?: string
  priority?: Message['priority']
  type?: MessageType
  data?: unknown
}

export type MessageHandler = (message: Message) => void | Promise<void>

let msgCounter = 0

/**
 * MessageBoard — shared communication space for agents in a swarm.
 *
 * Usage in agent execute():
 * ```
 * async execute(input, ctx) {
 *   // Read what other agents found
 *   const findings = ctx.board.read('my-agent', { type: 'finding' })
 *
 *   // Share a discovery
 *   ctx.board.post('my-agent', '*', 'Found a critical security issue in auth module', {
 *     type: 'finding',
 *     priority: 'urgent',
 *     data: { file: 'auth.ts', line: 42 }
 *   })
 *
 *   // Ask another agent
 *   ctx.board.post('my-agent', 'security-expert', 'Is this a real vulnerability?', {
 *     type: 'question'
 *   })
 *
 *   // Read responses
 *   const answers = ctx.board.read('my-agent', { type: 'answer', from: 'security-expert' })
 * }
 * ```
 */
export class MessageBoard {
  private messages: Message[] = []
  private channels = new Map<string, Message[]>()
  private handlers = new Map<string, MessageHandler[]>()
  private maxMessages: number

  constructor(maxMessages = 10_000) {
    this.maxMessages = maxMessages
  }

  /**
   * Post a message to the board.
   * @param from - Sender agent name
   * @param to - Recipient agent name, or '*' for broadcast
   * @param content - Message text
   * @param options - Priority, type, channel, attached data
   */
  post(from: string, to: string | '*', content: string, options: PostOptions = {}): Message {
    const message: Message = {
      id: `msg_${++msgCounter}`,
      from,
      to,
      channel: options.channel,
      priority: options.priority ?? 'normal',
      type: options.type ?? 'custom',
      content,
      data: options.data,
      timestamp: Date.now(),
      readBy: new Set(),
    }

    this.messages.push(message)

    // Add to channel index
    if (message.channel) {
      const channelMsgs = this.channels.get(message.channel) ?? []
      channelMsgs.push(message)
      this.channels.set(message.channel, channelMsgs)
    }

    // Evict old messages if over limit
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages)
    }

    // Notify handlers
    this.notifyHandlers(message)

    return message
  }

  /**
   * Read messages for a specific agent.
   * Messages addressed to the agent or broadcast ('*').
   * Marks messages as read.
   */
  read(agentName: string, filter?: MessageFilter): Message[] {
    let msgs = this.messages.filter((m) =>
      m.to === agentName || m.to === '*'
    )

    // Don't show agent its own messages
    msgs = msgs.filter((m) => m.from !== agentName)

    if (filter) {
      if (filter.type) msgs = msgs.filter((m) => m.type === filter.type)
      if (filter.from) msgs = msgs.filter((m) => m.from === filter.from)
      if (filter.channel) msgs = msgs.filter((m) => m.channel === filter.channel)
      if (filter.priority) msgs = msgs.filter((m) => m.priority === filter.priority)
      if (filter.unreadOnly) msgs = msgs.filter((m) => !m.readBy.has(agentName))
      if (filter.since) msgs = msgs.filter((m) => m.timestamp >= filter.since!)
    }

    // Mark as read
    for (const m of msgs) m.readBy.add(agentName)

    return msgs
  }

  /**
   * Read messages from a specific channel.
   */
  readChannel(channel: string, agentName?: string): Message[] {
    const msgs = this.channels.get(channel) ?? []
    if (agentName) {
      for (const m of msgs) m.readBy.add(agentName)
    }
    return msgs
  }

  /**
   * Read unread messages for an agent (inbox).
   */
  inbox(agentName: string): Message[] {
    return this.read(agentName, { unreadOnly: true })
  }

  /**
   * Get urgent messages for an agent.
   */
  urgent(agentName: string): Message[] {
    return this.read(agentName, { priority: 'urgent', unreadOnly: true })
  }

  /**
   * Subscribe to messages matching a filter.
   * Handler is called on every new matching message.
   */
  subscribe(agentName: string, handler: MessageHandler, filter?: MessageFilter): void {
    const wrappedHandler: MessageHandler = (msg) => {
      if (msg.from === agentName) return // Don't notify self
      if (msg.to !== agentName && msg.to !== '*') return
      if (filter?.type && msg.type !== filter.type) return
      if (filter?.channel && msg.channel !== filter.channel) return
      if (filter?.priority && msg.priority !== filter.priority) return
      handler(msg)
    }

    const existing = this.handlers.get(agentName) ?? []
    existing.push(wrappedHandler)
    this.handlers.set(agentName, existing)
  }

  /**
   * Get a thread — a question and all its answers.
   */
  thread(questionId: string): Message[] {
    const question = this.messages.find((m) => m.id === questionId)
    if (!question) return []

    const answers = this.messages.filter((m) =>
      m.type === 'answer' && m.data && (m.data as { replyTo?: string }).replyTo === questionId
    )

    return [question, ...answers]
  }

  /**
   * Get board stats.
   */
  stats(): BoardStats {
    const byType = new Map<string, number>()
    const byAgent = new Map<string, number>()
    const byPriority = new Map<string, number>()

    for (const m of this.messages) {
      byType.set(m.type, (byType.get(m.type) ?? 0) + 1)
      byAgent.set(m.from, (byAgent.get(m.from) ?? 0) + 1)
      byPriority.set(m.priority, (byPriority.get(m.priority) ?? 0) + 1)
    }

    return {
      totalMessages: this.messages.length,
      channels: [...this.channels.keys()],
      byType: Object.fromEntries(byType),
      byAgent: Object.fromEntries(byAgent),
      byPriority: Object.fromEntries(byPriority),
    }
  }

  /**
   * Get all findings posted by agents — useful for synthesis.
   */
  allFindings(): Message[] {
    return this.messages.filter((m) => m.type === 'finding')
  }

  /**
   * Get all warnings — useful for risk assessment.
   */
  allWarnings(): Message[] {
    return this.messages.filter((m) => m.type === 'warning')
  }

  /**
   * Get all unresolved questions.
   */
  openQuestions(): Message[] {
    const questions = this.messages.filter((m) => m.type === 'question')
    return questions.filter((q) => {
      const answers = this.messages.filter((m) =>
        m.type === 'answer' && m.data && (m.data as { replyTo?: string }).replyTo === q.id
      )
      return answers.length === 0
    })
  }

  /**
   * Clear all messages.
   */
  clear(): void {
    this.messages = []
    this.channels.clear()
  }

  /**
   * Export messages for persistence or debugging.
   */
  export(): Message[] {
    return this.messages.map((m) => ({
      ...m,
      readBy: new Set(m.readBy),
    }))
  }

  private notifyHandlers(message: Message): void {
    for (const [_agentName, handlers] of this.handlers) {
      for (const handler of handlers) {
        try {
          handler(message)
        } catch {
          // Don't let handler errors break messaging
        }
      }
    }
  }
}

export interface MessageFilter {
  type?: MessageType
  from?: string
  channel?: string
  priority?: Message['priority']
  unreadOnly?: boolean
  since?: number
}

export interface BoardStats {
  totalMessages: number
  channels: string[]
  byType: Record<string, number>
  byAgent: Record<string, number>
  byPriority: Record<string, number>
}
