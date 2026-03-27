/**
 * Context packer — builds token-optimized bundles from evidence and step results.
 * Shareable across agents in a swarm.
 */

export interface ContextBundle {
  id: string
  content: string
  tokenEstimate: number
  sources: ContextSource[]
  createdAt: number
  ttlMs?: number
}

export interface ContextSource {
  type: 'step_output' | 'evidence' | 'memory' | 'raw'
  id: string
  content: string
  tokenEstimate: number
  relevance: number
}

export interface PackOptions {
  maxTokens: number
  /** Prioritize by: relevance (default), recency, or source type */
  prioritize?: 'relevance' | 'recency' | 'type'
  /** Include only these source types */
  includeTypes?: ContextSource['type'][]
  /** Truncate individual sources to this many tokens */
  maxPerSource?: number
}

let bundleCounter = 0

/**
 * Pack sources into a token-optimal bundle.
 * Selects and orders sources to maximize value within the token budget.
 */
export function packContext(sources: ContextSource[], options: PackOptions): ContextBundle {
  const { maxTokens, prioritize = 'relevance', maxPerSource } = options

  // Filter by type
  let filtered = options.includeTypes
    ? sources.filter((s) => options.includeTypes!.includes(s.type))
    : sources

  // Truncate individual sources
  if (maxPerSource) {
    filtered = filtered.map((s) => {
      if (s.tokenEstimate <= maxPerSource) return s
      const ratio = maxPerSource / s.tokenEstimate
      const truncatedContent = s.content.slice(0, Math.floor(s.content.length * ratio))
      return { ...s, content: truncatedContent, tokenEstimate: maxPerSource }
    })
  }

  // Sort by priority
  const sorted = [...filtered].sort((a, b) => {
    switch (prioritize) {
      case 'relevance':
        return b.relevance - a.relevance
      case 'recency':
        // Higher ID = more recent (convention)
        return b.id.localeCompare(a.id)
      case 'type': {
        const typeOrder: Record<string, number> = { evidence: 0, memory: 1, step_output: 2, raw: 3 }
        return (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9)
      }
    }
  })

  // Greedy selection within budget
  const selected: ContextSource[] = []
  let totalTokens = 0

  for (const source of sorted) {
    if (totalTokens + source.tokenEstimate > maxTokens) continue
    selected.push(source)
    totalTokens += source.tokenEstimate
  }

  const content = selected.map((s) => {
    const header = `[${s.type}:${s.id}] (relevance: ${(s.relevance * 100).toFixed(0)}%)`
    return `${header}\n${s.content}`
  }).join('\n\n---\n\n')

  return {
    id: `ctx_${++bundleCounter}_${Date.now().toString(36)}`,
    content,
    tokenEstimate: totalTokens,
    sources: selected,
    createdAt: Date.now(),
  }
}

/**
 * Estimate token count from text.
 * Rough heuristic: ~4 chars per token for English text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Create a ContextSource from a step output.
 */
export function sourceFromStepOutput(stepId: string, output: unknown, relevance = 0.8): ContextSource {
  const content = typeof output === 'string' ? output : JSON.stringify(output, null, 2)
  return {
    type: 'step_output',
    id: stepId,
    content,
    tokenEstimate: estimateTokens(content),
    relevance,
  }
}
