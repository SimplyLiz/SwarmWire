/**
 * Conflict detector — finds contradictions and disagreements in agent outputs.
 */

import type { Conflict } from '../types/execution.js'
import type { AgentOutput } from '../types/agent.js'

let conflictCounter = 0

export interface DetectorOptions {
  /** Minimum similarity below which outputs are considered contradictory (0-1). Default 0.3 */
  contradictionThreshold?: number
  /** Minimum agreement above which outputs are considered aligned (0-1). Default 0.8 */
  agreementThreshold?: number
}

/**
 * Detect conflicts between agent outputs.
 * Uses structural comparison for objects, text overlap for strings.
 */
export function detectConflicts(
  outputs: AgentOutput[],
  options: DetectorOptions = {},
): Conflict[] {
  const contradictionThreshold = options.contradictionThreshold ?? 0.3
  const conflicts: Conflict[] = []

  if (outputs.length < 2) return conflicts

  // Compare each pair
  for (let i = 0; i < outputs.length; i++) {
    for (let j = i + 1; j < outputs.length; j++) {
      const a = outputs[i]!
      const b = outputs[j]!
      const similarity = computeSimilarity(a.output, b.output)

      if (similarity < contradictionThreshold) {
        conflicts.push({
          id: `conflict_${++conflictCounter}`,
          type: 'contradiction',
          agentIds: [a.agentId, b.agentId],
          stepIds: [],
          description: `Agents ${a.agentName} and ${b.agentName} produced contradictory outputs (similarity: ${(similarity * 100).toFixed(0)}%)`,
          outputs: [a.output, b.output],
        })
      } else if (similarity < (options.agreementThreshold ?? 0.8)) {
        conflicts.push({
          id: `conflict_${++conflictCounter}`,
          type: 'disagreement',
          agentIds: [a.agentId, b.agentId],
          stepIds: [],
          description: `Agents ${a.agentName} and ${b.agentName} partially disagree (similarity: ${(similarity * 100).toFixed(0)}%)`,
          outputs: [a.output, b.output],
        })
      }
    }
  }

  return conflicts
}

/**
 * Compute similarity between two outputs.
 * Strings: Jaccard similarity on word sets.
 * Objects: key overlap + recursive value comparison.
 * Different types: 0.
 */
function computeSimilarity(a: unknown, b: unknown): number {
  if (a === b) return 1
  if (a == null || b == null) return 0

  const typeA = typeof a
  const typeB = typeof b

  if (typeA !== typeB) return 0

  if (typeA === 'string') {
    return jaccardSimilarity(a as string, b as string)
  }

  if (typeA === 'number' || typeA === 'boolean') {
    return a === b ? 1 : 0
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return arrayOverlap(a, b)
  }

  if (typeA === 'object') {
    return objectSimilarity(a as Record<string, unknown>, b as Record<string, unknown>)
  }

  return 0
}

function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))

  if (wordsA.size === 0 && wordsB.size === 0) return 1
  if (wordsA.size === 0 || wordsB.size === 0) return 0

  let intersection = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++
  }

  const union = wordsA.size + wordsB.size - intersection
  return union === 0 ? 0 : intersection / union
}

function arrayOverlap(a: unknown[], b: unknown[]): number {
  if (a.length === 0 && b.length === 0) return 1
  if (a.length === 0 || b.length === 0) return 0

  const maxLen = Math.max(a.length, b.length)
  let matchCount = 0

  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    matchCount += computeSimilarity(a[i], b[i])
  }

  return matchCount / maxLen
}

function objectSimilarity(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  const allKeys = new Set([...keysA, ...keysB])

  if (allKeys.size === 0) return 1

  let totalSim = 0
  for (const key of allKeys) {
    if (key in a && key in b) {
      totalSim += computeSimilarity(a[key], b[key])
    }
    // Missing key = 0 similarity for that field
  }

  return totalSim / allKeys.size
}
