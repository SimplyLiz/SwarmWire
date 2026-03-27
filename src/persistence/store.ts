/**
 * Cross-session persistence — save/load SwarmWire state to disk or memory backend.
 * Persists: adaptive router history, orchestrator sequences, agent scores.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { MemoryBackend } from '../types/memory.js'
import type { ExecutionRecord } from '../planner/adaptive-router.js'

export interface SwarmWireState {
  version: string
  savedAt: number
  adaptiveRouterHistory: ExecutionRecord[]
  orchestratorSequences: Record<string, Array<{ agentOrder: string[]; avgQuality: number; avgCostCents: number; uses: number }>>
}

/**
 * Save SwarmWire state to a JSON file.
 */
export async function saveState(state: SwarmWireState, filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8')
}

/**
 * Load SwarmWire state from a JSON file.
 */
export async function loadState(filePath: string): Promise<SwarmWireState | null> {
  try {
    const content = await readFile(filePath, 'utf-8')
    return JSON.parse(content) as SwarmWireState
  } catch {
    return null
  }
}

/**
 * Save state to a memory backend (e.g., ANCS).
 */
export async function saveStateToMemory(state: SwarmWireState, memory: MemoryBackend, key = 'swarmwire:state'): Promise<void> {
  await memory.store(key, state, { tags: ['swarmwire', 'state'] })
}

/**
 * Load state from a memory backend.
 */
export async function loadStateFromMemory(memory: MemoryBackend, key = 'swarmwire:state'): Promise<SwarmWireState | null> {
  const items = await memory.query(key, { maxItems: 1 })
  if (items.length === 0) return null
  return items[0]!.value as SwarmWireState
}

/**
 * Create an empty state object.
 */
export function emptyState(): SwarmWireState {
  return {
    version: '0.1.0',
    savedAt: Date.now(),
    adaptiveRouterHistory: [],
    orchestratorSequences: {},
  }
}
