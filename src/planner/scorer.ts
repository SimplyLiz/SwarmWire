/**
 * TaskScorer — classifies task difficulty and recommends execution mode.
 */

import type { Task, TaskScore, TaskFactors, TaskDifficulty } from '../types/task.js'
import type { ModelTier } from '../types/provider.js'

/** Heuristic keywords that indicate higher complexity */
const COMPLEXITY_SIGNALS = {
  high: ['compare', 'analyze', 'design', 'architect', 'evaluate', 'trade-off', 'tradeoff', 'debate', 'security', 'optimize'],
  medium: ['research', 'investigate', 'review', 'summarize', 'explain', 'refactor', 'implement'],
  low: ['list', 'find', 'get', 'fetch', 'read', 'convert', 'format', 'translate'],
}

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  code: ['code', 'function', 'class', 'api', 'bug', 'test', 'refactor', 'typescript', 'javascript', 'python'],
  security: ['security', 'vulnerability', 'auth', 'encrypt', 'permission', 'xss', 'injection'],
  data: ['data', 'database', 'sql', 'query', 'schema', 'migration', 'etl'],
  infra: ['deploy', 'docker', 'kubernetes', 'ci/cd', 'pipeline', 'terraform', 'aws', 'gcp'],
  research: ['research', 'paper', 'study', 'survey', 'literature', 'state-of-the-art'],
}

export function scoreTask(task: Task): TaskScore {
  const text = `${task.description} ${typeof task.input === 'string' ? task.input : ''}`.toLowerCase()
  const factors = computeFactors(text)
  const difficulty = classifyDifficulty(factors)
  const domain = detectDomains(text)

  return {
    difficulty,
    risk: difficulty === 'complex' ? 'high' : difficulty === 'hard' ? 'medium' : 'low',
    domain,
    freshnessNeed: task.freshness ?? 'relaxed',
    recommendedMode: difficulty === 'complex' || difficulty === 'hard' ? 'swarm' : 'deep',
    estimatedAgents: estimateAgents(difficulty),
    estimatedTokens: estimateTokens(difficulty),
    modelTier: recommendTier(difficulty),
    factors,
  }
}

function computeFactors(text: string): TaskFactors {
  const wordCount = text.split(/\s+/).length
  const _sentenceCount = text.split(/[.!?]+/).filter(Boolean).length

  // Input complexity — longer, more structured = more complex
  const inputComplexity = Math.min(1, wordCount / 200)

  // Domain specificity — how many domain keywords found
  const domainHits = Object.values(DOMAIN_KEYWORDS).flat().filter((kw) => text.includes(kw)).length
  const domainSpecificity = Math.min(1, domainHits / 5)

  // Reasoning depth — complexity signals
  const highHits = COMPLEXITY_SIGNALS.high.filter((s) => text.includes(s)).length
  const medHits = COMPLEXITY_SIGNALS.medium.filter((s) => text.includes(s)).length
  const reasoningDepth = Math.min(1, (highHits * 0.3 + medHits * 0.15))

  // Output structure — heuristic: multi-step, comparison, etc.
  const structureSignals = ['table', 'list', 'compare', 'pros and cons', 'step by step', 'architecture', 'diagram']
  const structureHits = structureSignals.filter((s) => text.includes(s)).length
  const outputStructure = Math.min(1, structureHits / 3)

  // Context required — mentions of external systems, prior work, etc.
  const contextSignals = ['existing', 'current', 'our', 'codebase', 'repo', 'previous', 'history', 'context']
  const contextHits = contextSignals.filter((s) => text.includes(s)).length
  const contextRequired = Math.min(1, contextHits / 3)

  return {
    inputComplexity: round(inputComplexity),
    domainSpecificity: round(domainSpecificity),
    reasoningDepth: round(reasoningDepth),
    outputStructure: round(outputStructure),
    contextRequired: round(contextRequired),
  }
}

function classifyDifficulty(factors: TaskFactors): TaskDifficulty {
  const avg = (factors.inputComplexity + factors.domainSpecificity + factors.reasoningDepth + factors.outputStructure + factors.contextRequired) / 5
  if (avg >= 0.6) return 'complex'
  if (avg >= 0.4) return 'hard'
  if (avg >= 0.2) return 'medium'
  return 'easy'
}

function detectDomains(text: string): string[] {
  const found: string[] = []
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) found.push(domain)
  }
  return found.length > 0 ? found : ['general']
}

function estimateAgents(difficulty: TaskDifficulty): number {
  switch (difficulty) {
    case 'easy': return 1
    case 'medium': return 1
    case 'hard': return 3
    case 'complex': return 5
  }
}

function estimateTokens(difficulty: TaskDifficulty): number {
  switch (difficulty) {
    case 'easy': return 2_000
    case 'medium': return 8_000
    case 'hard': return 30_000
    case 'complex': return 80_000
  }
}

function recommendTier(difficulty: TaskDifficulty): ModelTier {
  switch (difficulty) {
    case 'easy': return 'cheap'
    case 'medium': return 'standard'
    case 'hard': return 'standard'
    case 'complex': return 'premium'
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
