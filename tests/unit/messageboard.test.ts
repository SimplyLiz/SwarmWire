import { describe, it, expect } from 'vitest'
import { MessageBoard } from '../../src/core/messageboard.js'

describe('MessageBoard', () => {
  it('posts and reads messages', () => {
    const board = new MessageBoard()
    board.post('agent-a', 'agent-b', 'Found a vulnerability in auth.ts', { type: 'finding' })

    const msgs = board.read('agent-b')
    expect(msgs.length).toBe(1)
    expect(msgs[0]!.from).toBe('agent-a')
    expect(msgs[0]!.content).toContain('vulnerability')
  })

  it('broadcasts to all agents', () => {
    const board = new MessageBoard()
    board.post('agent-a', '*', 'Important update for everyone', { type: 'status' })

    const msgsB = board.read('agent-b')
    const msgsC = board.read('agent-c')
    expect(msgsB.length).toBe(1)
    expect(msgsC.length).toBe(1)
  })

  it('does not show agent its own messages', () => {
    const board = new MessageBoard()
    board.post('agent-a', '*', 'My own broadcast')

    const msgs = board.read('agent-a')
    expect(msgs.length).toBe(0)
  })

  it('filters by type', () => {
    const board = new MessageBoard()
    board.post('a', '*', 'A finding', { type: 'finding' })
    board.post('a', '*', 'A warning', { type: 'warning' })
    board.post('a', '*', 'A status', { type: 'status' })

    const findings = board.read('b', { type: 'finding' })
    expect(findings.length).toBe(1)
    expect(findings[0]!.type).toBe('finding')
  })

  it('filters by channel', () => {
    const board = new MessageBoard()
    board.post('a', '*', 'Security issue', { channel: 'security' })
    board.post('a', '*', 'Performance note', { channel: 'perf' })

    const security = board.read('b', { channel: 'security' })
    expect(security.length).toBe(1)

    const channelMsgs = board.readChannel('security')
    expect(channelMsgs.length).toBe(1)
  })

  it('tracks unread messages (inbox)', () => {
    const board = new MessageBoard()
    board.post('a', 'b', 'First message')
    board.post('a', 'b', 'Second message')

    const inbox1 = board.inbox('b')
    expect(inbox1.length).toBe(2)

    // Reading marks as read
    const inbox2 = board.inbox('b')
    expect(inbox2.length).toBe(0) // Already read
  })

  it('filters unread only', () => {
    const board = new MessageBoard()
    board.post('a', 'b', 'Message 1')
    board.post('a', 'b', 'Message 2')

    board.read('b') // Marks all as read
    board.post('a', 'b', 'Message 3') // New unread

    const unread = board.read('b', { unreadOnly: true })
    expect(unread.length).toBe(1)
    expect(unread[0]!.content).toBe('Message 3')
  })

  it('collects all findings', () => {
    const board = new MessageBoard()
    board.post('researcher', '*', 'Found pattern X', { type: 'finding', data: { pattern: 'X' } })
    board.post('analyst', '*', 'Found issue Y', { type: 'finding', data: { issue: 'Y' } })
    board.post('reviewer', '*', 'Code looks clean', { type: 'status' })

    const findings = board.allFindings()
    expect(findings.length).toBe(2)
  })

  it('collects all warnings', () => {
    const board = new MessageBoard()
    board.post('security', '*', 'SQL injection risk', { type: 'warning' })
    board.post('perf', '*', 'N+1 query detected', { type: 'warning' })

    expect(board.allWarnings().length).toBe(2)
  })

  it('tracks question/answer threads', () => {
    const board = new MessageBoard()
    const q = board.post('a', 'b', 'Is this a real vulnerability?', { type: 'question' })
    board.post('b', 'a', 'Yes, confirmed CVE-2024-1234', { type: 'answer', data: { replyTo: q.id } })

    const thread = board.thread(q.id)
    expect(thread.length).toBe(2)
    expect(thread[0]!.type).toBe('question')
    expect(thread[1]!.type).toBe('answer')
  })

  it('finds open questions (unanswered)', () => {
    const board = new MessageBoard()
    const q1 = board.post('a', '*', 'How does auth work?', { type: 'question' })
    const q2 = board.post('a', '*', 'What is the rate limit?', { type: 'question' })

    // Answer q1 only
    board.post('b', 'a', 'It uses JWT', { type: 'answer', data: { replyTo: q1.id } })

    const open = board.openQuestions()
    expect(open.length).toBe(1)
    expect(open[0]!.id).toBe(q2.id)
  })

  it('handles priority messages', () => {
    const board = new MessageBoard()
    board.post('a', 'b', 'Normal update', { priority: 'normal' })
    board.post('a', 'b', 'CRITICAL: production down', { priority: 'urgent' })

    const urgent = board.urgent('b')
    expect(urgent.length).toBe(1)
    expect(urgent[0]!.content).toContain('CRITICAL')
  })

  it('provides stats', () => {
    const board = new MessageBoard()
    board.post('researcher', '*', 'Finding 1', { type: 'finding', channel: 'research' })
    board.post('reviewer', '*', 'Warning 1', { type: 'warning', priority: 'high' })

    const stats = board.stats()
    expect(stats.totalMessages).toBe(2)
    expect(stats.channels).toContain('research')
    expect(stats.byType.finding).toBe(1)
    expect(stats.byType.warning).toBe(1)
    expect(stats.byAgent.researcher).toBe(1)
  })

  it('respects maxMessages limit', () => {
    const board = new MessageBoard(5)
    for (let i = 0; i < 10; i++) {
      board.post('a', '*', `Message ${i}`)
    }
    expect(board.stats().totalMessages).toBe(5)
  })

  it('clears all messages', () => {
    const board = new MessageBoard()
    board.post('a', '*', 'test')
    board.clear()
    expect(board.stats().totalMessages).toBe(0)
  })

  it('works in agent context (integration)', async () => {
    // Simulate two agents communicating via the board during execution
    const board = new MessageBoard()
    const { createAgent } = await import('../../src/core/agent-factory.js')
    const { stubBoard } = await import('../../src/core/stub-board.js')

    // Agent A finds something and posts it
    board.post('researcher', '*', 'Found SQL injection in user_query()', {
      type: 'finding',
      priority: 'urgent',
      data: { file: 'db.ts', line: 42, severity: 'critical' },
    })

    // Agent B reads findings before doing its work
    const findings = board.read('reviewer', { type: 'finding' })
    expect(findings.length).toBe(1)
    expect(findings[0]!.data).toEqual({ file: 'db.ts', line: 42, severity: 'critical' })

    // Agent B asks a follow-up
    const q = board.post('reviewer', 'researcher', 'Is this in the ORM layer or raw SQL?', { type: 'question' })

    // Agent A answers
    board.post('researcher', 'reviewer', 'Raw SQL in a legacy endpoint', {
      type: 'answer',
      data: { replyTo: q.id },
    })

    // Full thread
    const thread = board.thread(q.id)
    expect(thread.length).toBe(2)
  })

  it('subscribe notifies on new messages', () => {
    const board = new MessageBoard()
    const received: string[] = []

    board.subscribe('agent-b', (msg) => {
      received.push(msg.content)
    })

    board.post('agent-a', 'agent-b', 'Hello')
    board.post('agent-a', '*', 'Broadcast')
    board.post('agent-c', 'agent-d', 'Not for B')

    expect(received).toEqual(['Hello', 'Broadcast'])
  })
})
