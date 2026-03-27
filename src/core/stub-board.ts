/**
 * Board helpers — stub for no-board contexts, scoped view for real boards.
 */

import type { AgentBoard } from '../types/agent.js'
import type { MessageBoard } from './messageboard.js'

/** No-op board for contexts without a real MessageBoard. */
export function stubBoard(): AgentBoard {
  return {
    post() {},
    read() { return [] },
    inbox() { return [] },
    findings() { return [] },
    warnings() { return [] },
    reply() {},
  }
}

/** Create a real agent-scoped board view from a MessageBoard. */
export function scopedBoard(agentName: string, board: MessageBoard): AgentBoard {
  return {
    post(to, content, opts) {
      board.post(agentName, to, content, opts)
    },
    read(filter) {
      return board.read(agentName, filter as Parameters<typeof board.read>[1]).map((m) => ({
        id: m.id, from: m.from, content: m.content, type: m.type, data: m.data, timestamp: m.timestamp,
      }))
    },
    inbox() {
      return board.inbox(agentName).map((m) => ({
        id: m.id, from: m.from, content: m.content, type: m.type, data: m.data, timestamp: m.timestamp,
      }))
    },
    findings() {
      return board.allFindings().filter((m) => m.from !== agentName).map((m) => ({
        from: m.from, content: m.content, data: m.data,
      }))
    },
    warnings() {
      return board.allWarnings().filter((m) => m.from !== agentName).map((m) => ({
        from: m.from, content: m.content, data: m.data,
      }))
    },
    reply(questionId, content, data) {
      board.post(agentName, '*', content, {
        type: 'answer',
        data: { replyTo: questionId, ...((data && typeof data === 'object') ? data : { value: data }) },
      })
    },
  }
}
