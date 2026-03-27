/**
 * Stub board for contexts that don't have a full MessageBoard (debate, blackboard, evolving).
 */

import type { AgentBoard } from '../types/agent.js'

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
