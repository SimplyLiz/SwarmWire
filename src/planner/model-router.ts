/**
 * Intelligent 3-Tier Model Routing System
 * Routes tasks to appropriate model complexity levels based on task analysis
 * Inspired by Ruflo's intelligent model routing approach
 */

import type { Task } from '../types/task.js'
import type { ModelConfig, ModelTier } from '../types/provider.js'

// Task complexity indicators
export interface ComplexityIndicators {
  length: number          // Description length
  technicalTerms: number  // Count of technical/domain-specific terms
  structureClues: number  // Indicators of structured output needs
  reasoningDepth: number  // Estimated reasoning steps required
  ambiguity: number       // Vagueness or open-endedness score
}

// Routing decision result
export interface RoutingDecision {
  tier: ModelTier
  reason: string
  confidence: number      // 0-1 confidence in this routing decision
  estimatedCostCents: number
  estimatedLatencyMs: number
}

// Configuration for the 3-tier routing system
export interface ModelRoutingConfig {
  /** Cost per 1K tokens for each tier (in cents) */
  costPer1kTokens: Record<ModelTier, number>
  /** Base latency for each tier (in milliseconds) */
  baseLatencyMs: Record<ModelTier, number>
  /** Tokens per word estimation */
  tokensPerWord: number
  /** Thresholds for complexity scoring */
  complexityThresholds: {
    simpleToMedium: number
    mediumToComplex: number
  }
  /** Default model configurations for each tier */
  defaultModels: Partial<Record<ModelTier, ModelConfig>>
}

/**
 * Analyzes a task to determine its complexity level
 */
export function analyzeTaskComplexity(
  task: Task,
  _config: ModelRoutingConfig
): ComplexityIndicators {
  const description = task.description.toLowerCase()
  
  // Length indicator
  const length = description.length
  
  // Technical terms indicator (simple heuristic)
  const technicalTerms = [
    'algorithm', 'api', 'database', 'authentication', 'authorization',
    'encryption', 'framework', 'library', 'microservice', 'middleware',
    'protocol', 'refactor', 'architecture', 'scalability', 'security',
    'performance', 'optimization', 'integration', 'deployment', 'testing',
    'CI/CD', 'pipeline', 'container', 'docker', 'kubernetes', 'cloud',
    'AWS', 'Azure', 'GCP', 'React', 'Vue', 'Angular', 'Node.js', 'Python',
    'Java', 'TypeScript', 'JavaScript', 'SQL', 'NoSQL', 'REST', 'GraphQL',
    'microservices', 'distributed', 'concurrent', 'parallel', 'async',
    'await', 'promise', 'callback', 'closure', 'prototype', 'inheritance',
    'polymorphism', 'encapsulation', 'abstraction', 'interface', 'generic'
  ].filter(term => description.includes(term)).length
  
  // Structure clues (JSON, XML, SQL, etc.)
  const structureClues = [
    description.includes('json') ? 1 : 0,
    description.includes('schema') ? 1 : 0,
    description.includes('structure') ? 1 : 0,
    description.includes('format') ? 1 : 0,
    description.includes('table') ? 1 : 0,
    description.includes('query') ? 1 : 0,
    description.includes('select') ? 1 : 0,
    description.includes('insert') ? 1 : 0,
    description.includes('update') ? 1 : 0,
    description.includes('delete') ? 1 : 0
  ].reduce((sum, val) => sum + val, 0)
  
  // Reasoning depth indicators
  const reasoningDepth = [
    description.includes('analyze') ? 1 : 0,
    description.includes('compare') ? 1 : 0,
    description.includes('evaluate') ? 1 : 0,
    description.includes('assess') ? 1 : 0,
    description.includes('determine') ? 1 : 0,
    description.includes('calculate') ? 1 : 0,
    description.includes('compute') ? 1 : 0,
    description.includes('optimize') ? 1 : 0,
    description.includes('design') ? 1 : 0,
    description.includes('plan') ? 1 : 0,
    description.includes('strategy') ? 1 : 0,
    description.includes('approach') ? 1 : 0,
    description.includes('method') ? 1 : 0,
    description.includes('algorithm') ? 1 : 0
  ].reduce((sum, val) => sum + val, 0)
  
  // Ambiguity indicators (vague or open-ended terms)
  const ambiguity = [
    description.includes('maybe') ? 1 : 0,
    description.includes('perhaps') ? 1 : 0,
    description.includes('possibly') ? 1 : 0,
    description.includes('might') ? 1 : 0,
    description.includes('could') ? 1 : 0,
    description.includes('should') ? 1 : 0,
    description.includes('would') ? 1 : 0,
    description.includes('think') ? 1 : 0,
    description.includes('believe') ? 1 : 0,
    description.includes('feel') ? 1 : 0,
    description.includes('idea') ? 1 : 0,
    description.includes('suggestion') ? 1 : 0,
    description.includes('recommend') ? 1 : 0,
    description.includes('option') ? 1 : 0,
    description.includes('alternative') ? 1 : 0,
    description.includes('consider') ? 1 : 0,
    description.includes('explore') ? 1 : 0,
    description.includes('investigate') ? 1 : 0,
    description.includes('research') ? 1 : 0
  ].reduce((sum, val) => sum + val, 0)
  
  return {
    length,
    technicalTerms,
    structureClues,
    reasoningDepth,
    ambiguity
  }
}

/**
 * Calculates a complexity score from indicators
 */
export function calculateComplexityScore(
  indicators: ComplexityIndicators,
  _config: ModelRoutingConfig
): number {
  // Normalize each indicator to 0-1 range (rough approximations)
  const normalizedLength = Math.min(1.0, indicators.length / 500) // 500 chars = max
  const normalizedTechnical = Math.min(1.0, indicators.technicalTerms / 10) // 10 terms = max
  const normalizedStructure = Math.min(1.0, indicators.structureClues / 5) // 5 clues = max
  const normalizedReasoning = Math.min(1.0, indicators.reasoningDepth / 10) // 10 depth = max
  const normalizedAmbiguity = Math.min(1.0, indicators.ambiguity / 10) // 10 ambiguity = max
  
  // Weighted combination (can be tuned)
  const score = 
    (normalizedLength * 0.2) +
    (normalizedTechnical * 0.25) +
    (normalizedStructure * 0.15) +
    (normalizedReasoning * 0.25) +
    (normalizedAmbiguity * 0.15)
  
  return Math.min(1.0, Math.max(0.0, score))
}

/**
 * Determines the appropriate model tier based on complexity score
 */
export function determineModelTier(
  complexityScore: number,
  config: ModelRoutingConfig
): ModelTier {
  if (complexityScore < config.complexityThresholds.simpleToMedium) {
    return 'cheap'
  } else if (complexityScore < config.complexityThresholds.mediumToComplex) {
    return 'standard'
  } else {
    return 'premium'
  }
}

/**
 * Estimates token count for a task
 */
export function estimateTokenCount(
  task: Task,
  config: ModelRoutingConfig
): number {
  // Base estimation: tokens per word * word count + overhead
  const wordCount = task.description.trim().split(/\s+/).length
  const baseTokens = wordCount * config.tokensPerWord
  
  // Add overhead for context, instructions, etc.
  const overhead = Math.max(50, baseTokens * 0.2) // At least 50 tokens or 20% overhead
  
  // Adjust based on expected output size (heuristic)
  const outputAdjustment = task.description.includes('generate') || 
                          task.description.includes('create') || 
                          task.description.includes('write') ? 100 : 0
  
  return Math.round(baseTokens + overhead + outputAdjustment)
}

/**
 * Estimates cost for running a task on a specific tier
 */
export function estimateCost(
  tokenCount: number,
  tier: ModelTier,
  config: ModelRoutingConfig
): number {
  const costPer1k = config.costPer1kTokens[tier] || 0
  return Math.round((tokenCount / 1000) * costPer1k)
}

/**
 * Estimates latency for running a task on a specific tier
 */
export function estimateLatency(
  tokenCount: number,
  tier: ModelTier,
  config: ModelRoutingConfig
): number {
  const baseLatency = config.baseLatencyMs[tier] || 0
  // Latency grows with token count but with diminishing returns
  const tokenFactor = Math.log10(Math.max(1, tokenCount / 100))
  return Math.round(baseLatency * (1 + tokenFactor * 0.5))
}

/**
 * Main model routing function that determines the best model for a task
 */
export function routeTaskToModel(
  task: Task,
  availableModels: { [key in ModelTier]?: ModelConfig[] },
  config: ModelRoutingConfig
): RoutingDecision {
  // Analyze task complexity
  const indicators = analyzeTaskComplexity(task, config)
  const complexityScore = calculateComplexityScore(indicators, config)
  
  // Determine appropriate tier
  const tier = determineModelTier(complexityScore, config)
  
  // Estimate token count
  const tokenCount = estimateTokenCount(task, config)
  
  // Estimate cost and latency
  const estimatedCost = estimateCost(tokenCount, tier, config)
  const estimatedLatency = estimateLatency(tokenCount, tier, config)
  
  // Determine routing confidence based on how clear-cut the decision is
  let confidence = 0.8 // Base confidence
  
  // Increase confidence if score is far from thresholds
  const distanceToSimpleThreshold = Math.abs(complexityScore - config.complexityThresholds.simpleToMedium)
  const distanceToMediumThreshold = Math.abs(complexityScore - config.complexityThresholds.mediumToComplex)
  const minDistance = Math.min(distanceToSimpleThreshold, distanceToMediumThreshold)
  
  // Closer to threshold = less confident
  confidence = Math.min(0.95, 0.6 + (minDistance * 0.8))
  
  // Generate reason string
  let reason = ''
  switch (tier) {
    case 'cheap':
      reason = `Task complexity score ${complexityScore.toFixed(2)} suggests simple task suitable for ${tier} model`
      break
    case 'standard':
      reason = `Task complexity score ${complexityScore.toFixed(2)} suggests moderate task suitable for ${tier} model`
      break
    case 'premium':
      reason = `Task complexity score ${complexityScore.toFixed(2)} suggests complex task suitable for ${tier} model`
      break
  }
  
  // Add specific indicators if they were strong contributors
  const strongIndicators = []
  if (indicators.technicalTerms > 5) strongIndicators.push('technical content')
  if (indicators.reasoningDepth > 5) strongIndicators.push('reasoning requirements')
  if (indicators.structureClues > 3) strongIndicators.push('structural requirements')
  if (indicators.length > 300) strongIndicators.push('detailed description')
  
  if (strongIndicators.length > 0) {
    reason += ` (strong indicators: ${strongIndicators.join(', ')})`
  }
  
  return {
    tier,
    reason,
    confidence,
    estimatedCostCents: estimatedCost,
    estimatedLatencyMs: estimatedLatency
  }
}

/**
 * Default configuration for the 3-tier routing system
 */
export const defaultModelRoutingConfig: ModelRoutingConfig = {
  costPer1kTokens: {
    cheap: 0.5,      // ~$0.005 per 1K tokens
    standard: 9.0,   // ~$0.09 per 1K tokens
    premium: 45.0,   // ~$0.45 per 1K tokens
    reasoning: 25.0  // ~$0.25 per 1K tokens
  },
  baseLatencyMs: {
    cheap: 500,      // ~500ms base latency
    standard: 2000,  // ~2s base latency
    premium: 5000,   // ~5s base latency
    reasoning: 3000  // ~3s base latency
  },
  tokensPerWord: 1.3, // Rough approximation: 1.3 tokens per word
  complexityThresholds: {
    simpleToMedium: 0.3,
    mediumToComplex: 0.7
  },
  defaultModels: {
    cheap: { provider: 'openai', model: 'gpt-3.5-turbo' },
    standard: { provider: 'openai', model: 'gpt-4' },
    premium: { provider: 'openai', model: 'gpt-4-turbo' },
    reasoning: { provider: 'openai', model: 'gpt-4' } // Using GPT-4 for reasoning tasks
  }
}