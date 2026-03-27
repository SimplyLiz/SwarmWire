/**
 * Query Decomposition Router — route subtasks to cheapest capable models.
 *
 * Based on R2-Reasoner (arXiv:2603.04445): "84.46% API cost savings"
 * by breaking complex queries into subtasks and routing each independently.
 *
 * Strategy:
 * 1. Analyze query for decomposable subtasks
 * 2. Classify each subtask's complexity
 * 3. Route each to the cheapest model that can handle it
 * 4. Merge results
 */

import type { LlmResponse, ModelTier } from '../types/provider.js'
import type { ModelLadder, ModelRung } from './cascade-router.js'

export interface DecomposedQuery {
  original: string
  subtasks: Subtask[]
}

export interface Subtask {
  id: string
  description: string
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex'
  recommendedTier: ModelTier
  dependencies: string[]
}

export interface DecompositionResult {
  responses: SubtaskResponse[]
  totalCostCents: number
  /** Cost if we had sent the full query to the most expensive model */
  fullQueryCostEstimate: number
  savings: number
}

export interface SubtaskResponse {
  subtaskId: string
  response: LlmResponse
  model: string
  provider: string
  costCents: number
}

/**
 * Decompose a query into subtasks with complexity estimates.
 * Uses heuristic decomposition — no LLM call needed.
 */
export function decomposeQuery(text: string): DecomposedQuery {
  const subtasks: Subtask[] = []
  let counter = 0

  // Split on clear task boundaries
  const _patterns = [
    // Numbered lists: "1. do X  2. do Y"
    /(?:^|\n)\s*\d+[.)]\s+/g,
    // Bullet points
    /(?:^|\n)\s*[-*]\s+/g,
    // "First... then... finally..."
    /\b(first|then|next|after that|finally|also|additionally)\b/gi,
    // "and" connecting distinct tasks
    /\band\b(?=\s+(?:also|then|check|create|update|find|get|set|delete|analyze|compare|review))/gi,
  ]

  // Try to split on numbered/bulleted items first
  const numberedSplit = text.split(/(?:^|\n)\s*\d+[.)]\s+/).filter(Boolean)
  const bulletSplit = text.split(/(?:^|\n)\s*[-*]\s+/).filter(Boolean)

  let segments: string[]
  if (numberedSplit.length > 1) {
    segments = numberedSplit
  } else if (bulletSplit.length > 1) {
    segments = bulletSplit
  } else {
    // Split on sentence boundaries for long queries
    segments = text.length > 500
      ? text.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((s) => s.length > 20)
      : [text]
  }

  // If no decomposition found, return single task
  if (segments.length <= 1) {
    return {
      original: text,
      subtasks: [{
        id: 'task_0',
        description: text,
        complexity: classifyComplexity(text),
        recommendedTier: complexityToTier(classifyComplexity(text)),
        dependencies: [],
      }],
    }
  }

  for (const segment of segments) {
    const trimmed = segment.trim()
    if (trimmed.length < 10) continue

    const complexity = classifyComplexity(trimmed)
    const id = `task_${counter++}`

    subtasks.push({
      id,
      description: trimmed,
      complexity,
      recommendedTier: complexityToTier(complexity),
      dependencies: counter > 1 ? [`task_${counter - 2}`] : [],
    })
  }

  return { original: text, subtasks: subtasks.length > 0 ? subtasks : [{
    id: 'task_0',
    description: text,
    complexity: classifyComplexity(text),
    recommendedTier: complexityToTier(classifyComplexity(text)),
    dependencies: [],
  }] }
}

/**
 * Execute decomposed subtasks, routing each to the cheapest appropriate model.
 */
export async function executeDecomposed(
  decomposed: DecomposedQuery,
  ladder: ModelLadder,
  systemPrompt?: string,
): Promise<DecompositionResult> {
  const responses: SubtaskResponse[] = []
  let totalCostCents = 0

  // Group subtasks by tier to batch similar complexity
  const completed = new Map<string, SubtaskResponse>()

  for (const subtask of decomposed.subtasks) {
    // Check dependencies
    for (const dep of subtask.dependencies) {
      if (!completed.has(dep)) {
        // Dependency not met — this shouldn't happen with proper ordering
        break
      }
    }

    // Find cheapest model at the recommended tier
    const rung = findModelForTier(subtask.recommendedTier, ladder)
    if (!rung) continue

    // Build context from dependencies
    const depContext = subtask.dependencies
      .map((d) => completed.get(d))
      .filter(Boolean)
      .map((r) => r!.response.content)
      .join('\n\n')

    const prompt = depContext
      ? `Previous context:\n${depContext}\n\nTask: ${subtask.description}`
      : subtask.description

    try {
      const response = await rung.provider.chat({
        model: rung.model.model,
        systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: subtask.complexity === 'trivial' ? 256 : subtask.complexity === 'simple' ? 1024 : 4096,
      })

      const costCents = rung.provider.estimateCost(rung.model.model, response.inputTokens, response.outputTokens)
      totalCostCents += costCents

      const subtaskResponse: SubtaskResponse = {
        subtaskId: subtask.id,
        response,
        model: rung.model.model,
        provider: rung.provider.name,
        costCents,
      }

      responses.push(subtaskResponse)
      completed.set(subtask.id, subtaskResponse)
    } catch {
      // Skip failed subtasks
    }
  }

  // Estimate what full query to premium would cost
  const premiumRung = ladder.rungs[ladder.rungs.length - 1]
  const fullQueryCostEstimate = premiumRung
    ? premiumRung.costPer1kTokens * 4 // Rough: 4k tokens for a full query
    : totalCostCents

  return {
    responses,
    totalCostCents,
    fullQueryCostEstimate,
    savings: Math.max(0, fullQueryCostEstimate - totalCostCents),
  }
}

// ─── Helpers ───

function classifyComplexity(text: string): Subtask['complexity'] {
  const lower = text.toLowerCase()
  const wordCount = lower.split(/\s+/).length

  // Trivial: simple lookups, short queries
  if (wordCount < 15 && /\b(what is|define|list|name|get)\b/.test(lower)) return 'trivial'

  // Complex: analysis, comparison, multi-step reasoning
  if (/\b(analyze|compare|trade.?off|design|architect|evaluate|debate|security audit)\b/.test(lower)) return 'complex'
  if (wordCount > 100) return 'complex'

  // Moderate: some reasoning needed
  if (/\b(explain|how|why|implement|create|write|fix|review|summarize)\b/.test(lower)) return 'moderate'
  if (wordCount > 40) return 'moderate'

  return 'simple'
}

function complexityToTier(complexity: Subtask['complexity']): ModelTier {
  switch (complexity) {
    case 'trivial': return 'cheap'
    case 'simple': return 'cheap'
    case 'moderate': return 'standard'
    case 'complex': return 'premium'
  }
}

function findModelForTier(tier: ModelTier, ladder: ModelLadder): ModelRung | null {
  const tierOrder: ModelTier[] = ['cheap', 'standard', 'premium', 'reasoning']
  const tierIdx = tierOrder.indexOf(tier)

  // Find cheapest model at or above the target tier
  for (const rung of ladder.rungs) {
    if (tierOrder.indexOf(rung.tier) >= tierIdx) return rung
  }

  // Fallback to cheapest available
  return ladder.rungs[0] ?? null
}
