/**
 * Conflict resolver — resolves detected conflicts using configurable strategies.
 */

import type { Conflict, ConflictResolution } from '../types/execution.js'
import type { AgentOutput } from '../types/agent.js'
import type { ConflictStrategy } from '../types/pattern.js'

/**
 * Resolve a conflict using the specified strategy.
 */
export function resolveConflict(
  conflict: Conflict,
  outputs: AgentOutput[],
  strategy: ConflictStrategy,
): ConflictResolution {
  switch (strategy) {
    case 'vote':
      return resolveByVote(conflict, outputs)
    case 'evidence_weight':
      return resolveByEvidenceWeight(conflict, outputs)
    case 'escalate':
      return resolveByEscalation(conflict)
  }
}

/**
 * Resolve conflicts between multiple outputs by finding the majority.
 * Groups similar outputs and picks the largest group.
 */
function resolveByVote(conflict: Conflict, outputs: AgentOutput[]): ConflictResolution {
  const relevant = outputs.filter((o) => conflict.agentIds.includes(o.agentId))
  if (relevant.length === 0) {
    return { method: 'vote', confidence: 0 }
  }

  // Simple: pick the output that appears most frequently (by string comparison)
  const votes = new Map<string, { count: number; agentId: string; output: unknown }>()
  for (const out of relevant) {
    const key = JSON.stringify(out.output)
    const existing = votes.get(key)
    if (existing) {
      existing.count++
    } else {
      votes.set(key, { count: 1, agentId: out.agentId, output: out.output })
    }
  }

  let best = { count: 0, agentId: '', output: undefined as unknown }
  for (const v of votes.values()) {
    if (v.count > best.count) best = v
  }

  const confidence = relevant.length > 0 ? best.count / relevant.length : 0

  return {
    method: 'vote',
    winner: best.agentId,
    reasoning: `${best.count}/${relevant.length} agents agreed`,
    confidence,
  }
}

/**
 * Resolve by evidence weight — prefer agents with more context/tool usage.
 * Proxy: agents that used more tokens likely processed more evidence.
 */
function resolveByEvidenceWeight(conflict: Conflict, outputs: AgentOutput[]): ConflictResolution {
  const relevant = outputs.filter((o) => conflict.agentIds.includes(o.agentId))
  if (relevant.length === 0) {
    return { method: 'evidence_weight', confidence: 0 }
  }

  // Weight by total tokens (proxy for evidence processed)
  let bestAgent = relevant[0]!
  let bestWeight = 0

  for (const out of relevant) {
    const weight = out.cost.totalTokens
    if (weight > bestWeight) {
      bestWeight = weight
      bestAgent = out
    }
  }

  const totalWeight = relevant.reduce((s, o) => s + o.cost.totalTokens, 0)
  const confidence = totalWeight > 0 ? bestWeight / totalWeight : 0.5

  return {
    method: 'evidence_weight',
    winner: bestAgent.agentId,
    reasoning: `Agent ${bestAgent.agentName} processed the most evidence (${bestWeight} tokens)`,
    confidence,
  }
}

/**
 * Escalation — don't auto-resolve, flag for human review.
 */
function resolveByEscalation(conflict: Conflict): ConflictResolution {
  return {
    method: 'escalate',
    reasoning: `Conflict escalated for review: ${conflict.description}`,
    confidence: 0,
  }
}
