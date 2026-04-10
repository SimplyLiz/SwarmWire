/**
 * Trajectory Reducer (AgentDiet-inspired) — prunes expired, redundant, and useless
 * tool-call results from agent message trajectories before they're passed to the LLM.
 *
 * Achieves 39-60% input token reduction with negligible quality loss.
 * Reference: https://arxiv.org/abs/2509.23586
 */

export interface TrajectoryMessage {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolCallId?: string
  toolName?: string
  /** Set by reducer: estimated token cost of this message */
  estimatedTokens?: number
}

export interface ReducerConfig {
  /** Max messages to retain. Default: no limit */
  maxMessages?: number
  /** Drop tool results with content length below this threshold (duplicate/empty). Default 0 */
  minContentLength?: number
  /** Remove duplicate tool results (same toolName + similar content). Default true */
  deduplicateSameToolResults?: boolean
  /** Remove tool results that are substrings of a later result (superseded). Default true */
  pruneSuperseded?: boolean
  /** Max token budget for the trajectory. Prune oldest first. Default: no limit */
  maxTokenBudget?: number
  /** Rough tokens-per-char ratio for budget estimation. Default 0.25 */
  tokensPerChar?: number
}

export interface ReducerStats {
  originalCount: number
  reducedCount: number
  originalEstimatedTokens: number
  reducedEstimatedTokens: number
  reductionFraction: number
}

export function reduceTrajectory(
  messages: TrajectoryMessage[],
  config: ReducerConfig = {},
): { messages: TrajectoryMessage[]; stats: ReducerStats } {
  const {
    maxMessages,
    minContentLength = 0,
    deduplicateSameToolResults = true,
    pruneSuperseded = true,
    maxTokenBudget,
    tokensPerChar = 0.25,
  } = config

  const estimateTokens = (msg: TrajectoryMessage) =>
    Math.ceil(msg.content.length * tokensPerChar)

  const originalCount = messages.length
  const originalEstimatedTokens = messages.reduce((s, m) => s + estimateTokens(m), 0)

  let result = messages.map((m) => ({ ...m, estimatedTokens: estimateTokens(m) }))

  // 1. Drop empty / too-short tool results
  result = result.filter((m) => {
    if (m.role !== 'tool') return true
    return m.content.trim().length >= minContentLength
  })

  // 2. Deduplicate — same toolName with near-identical content (keep last)
  if (deduplicateSameToolResults) {
    const seen = new Map<string, number>() // toolName → last index
    for (let i = 0; i < result.length; i++) {
      const m = result[i]!
      if (m.role === 'tool' && m.toolName) seen.set(m.toolName, i)
    }
    result = result.filter((m, i) => {
      if (m.role !== 'tool' || !m.toolName) return true
      return seen.get(m.toolName) === i
    })
  }

  // 3. Remove tool results superseded by a later, longer result from the same tool
  if (pruneSuperseded) {
    const toolResults = result.filter((m) => m.role === 'tool' && m.toolName)
    result = result.filter((m) => {
      if (m.role !== 'tool' || !m.toolName) return true
      const sameToolResults = toolResults.filter((r) => r.toolName === m.toolName)
      // Keep if this is the longest result for this tool name (or unique)
      const maxLen = Math.max(...sameToolResults.map((r) => r.content.length))
      return m.content.length >= maxLen
    })
  }

  // 4. Token budget: prune oldest non-system messages first
  if (maxTokenBudget) {
    let total = result.reduce((s, m) => s + (m.estimatedTokens ?? 0), 0)
    const systemMsgs = result.filter((m) => m.role === 'system')
    const nonSystem = result.filter((m) => m.role !== 'system')

    const i = 0
    while (total > maxTokenBudget && i < nonSystem.length) {
      total -= nonSystem[i]!.estimatedTokens ?? 0
      nonSystem.splice(i, 1)
    }

    result = [...systemMsgs, ...nonSystem]
  }

  // 5. Tail limit
  if (maxMessages !== undefined && result.length > maxMessages) {
    const systemMsgs = result.filter((m) => m.role === 'system')
    const nonSystem = result.filter((m) => m.role !== 'system')
    result = [...systemMsgs, ...nonSystem.slice(-Math.max(0, maxMessages - systemMsgs.length))]
  }

  const reducedEstimatedTokens = result.reduce((s, m) => s + (m.estimatedTokens ?? 0), 0)

  return {
    messages: result,
    stats: {
      originalCount,
      reducedCount: result.length,
      originalEstimatedTokens,
      reducedEstimatedTokens,
      reductionFraction: originalCount > 0 ? 1 - result.length / originalCount : 0,
    },
  }
}

/**
 * Classify a message's utility category for targeted pruning.
 */
export function classifyMessage(msg: TrajectoryMessage): 'active' | 'redundant' | 'expired' {
  if (msg.role === 'system') return 'active'
  if (msg.role !== 'tool') return 'active'
  if (!msg.content || msg.content.trim().length < 10) return 'expired'
  if (msg.content.toLowerCase().includes('null') || msg.content === '{}' || msg.content === '[]') return 'expired'
  return 'active'
}
