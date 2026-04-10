/**
 * Self-Learning Memory System
 * Combines pattern learning with retention mechanisms to prevent catastrophic forgetting
 * Inspired by Ruflo's SONA + EWC++ approach
 */

import type { MemoryBackend, MemoryItem, StoreMeta, QueryOpts } from '../types/memory.js'

// Pattern storage for learning which agents work best for which tasks
export interface LearningPattern {
  taskDescription: string
  agentRole: string
  successScore: number  // 0-1 scale
  executionCount: number
  lastUsed: number
  confidence: number    // Grows with repeated success
}

// Elastic Weight Consolidation metadata to prevent forgetting
export interface EWCMetadata {
  patternId: string
  importance: number    // How important this pattern is (0-1)
  accumulatedError: number // Tracks how much learning this pattern has resisted
}

export interface SelfLearningMemoryConfig {
  /** Base memory backend for storage */
  backend: MemoryBackend
  /** Learning rate for pattern updates (0-1) */
  learningRate?: number
  /** Importance decay rate (0-1) */
  importanceDecay?: number
  /** Minimum confidence to consider a pattern reliable */
  minConfidence?: number
  /** EWC strength - higher = more resistant to forgetting */
  ewcStrength?: number
}

/**
 * Self-learning memory wrapper that enhances any backend with learning capabilities
 */
export function createSelfLearningMemory(config: SelfLearningMemoryConfig): MemoryBackend {
  const {
    backend,
    learningRate = 0.1,
    importanceDecay = 0.01,
    minConfidence: _minConfidence = 0.7,
    ewcStrength = 0.9
  } = config

  // Internal storage for learning patterns and EWC metadata
  const learningPatterns: Map<string, LearningPattern> = new Map()
  const ewcMetadata: Map<string, EWCMetadata> = new Map()

  return {
    async store(key: string, value: unknown, meta: StoreMeta): Promise<void> {
      // Store the original value
      await backend.store(key, value, meta)

      // If this is a learning pattern, update our internal tracking
      if (meta.tags?.includes('learning-pattern')) {
        await updateLearningPattern(key, value as LearningPattern, meta)
      }
    },

    async query(query: string, opts?: QueryOpts): Promise<MemoryItem[]> {
      // First, try to get results from the backend
      const results = await backend.query(query, opts)

      // Enhance results with learning-based ranking
      return enhanceResultsWithLearning(results, query)
    },

    async forget(key: string): Promise<void> {
      // Forget from backend
      await backend.forget(key)

      // Clean up internal tracking
      learningPatterns.delete(key)
      ewcMetadata.delete(key)
    }
  }

  /**
   * Update a learning pattern based on new execution results
   */
  async function updateLearningPattern(
    patternId: string,
    pattern: LearningPattern,
    _meta: StoreMeta
  ): Promise<void> {
    const existing = learningPatterns.get(patternId)

    if (existing) {
      // Apply Elastic Weight Consolidation to prevent forgetting
      const ewc = ewcMetadata.get(patternId) ?? {
        patternId,
        importance: 0.5,
        accumulatedError: 0
      }

      // Calculate error between existing knowledge and new observation
      const error = Math.abs(existing.successScore - pattern.successScore)
      
      // Update importance based on ewc strength and error
      ewc.importance = Math.min(1.0, ewc.importance + (ewcStrength * error))
      ewc.accumulatedError += error
      
      // Update pattern with weighted average (respecting importance)
      const weight = 1.0 - ewc.importance
      pattern.successScore = 
        (existing.successScore * (1 - weight * learningRate)) + 
        (pattern.successScore * weight * learningRate)
      
      pattern.executionCount += existing.executionCount
      pattern.confidence = Math.min(1.0, pattern.confidence + 0.1)
      
      ewcMetadata.set(patternId, ewc)
    } else {
      // New pattern - assign initial importance
      ewcMetadata.set(patternId, {
        patternId,
        importance: 0.5,
        accumulatedError: 0
      })
    }

    // Update execution metadata
    pattern.lastUsed = Date.now()
    learningPatterns.set(patternId, pattern)
  }

  /**
   * Enhance query results with learning-based ranking
   */
  function enhanceResultsWithLearning(
    results: MemoryItem[],
    query: string
  ): MemoryItem[] {
    return results.map(item => {
      // Check if this item matches any learned patterns
      let relevanceBoost = 0
      
      for (const [, pattern] of learningPatterns.entries()) {
        // Simple similarity check - in production would use embeddings
        if (
          pattern.taskDescription.toLowerCase().includes(query.toLowerCase()) ||
          query.toLowerCase().includes(pattern.taskDescription.toLowerCase())
        ) {
          // Boost relevance based on pattern success and confidence
          const boost = pattern.successScore * pattern.confidence * 0.3
          relevanceBoost = Math.max(relevanceBoost, boost)
        }
      }

      // Apply decay to old patterns
      const ageInDays = (Date.now() - item.storedAt) / (1000 * 60 * 60 * 24)
      const decayFactor = Math.exp(-importanceDecay * ageInDays)
      
      return {
        ...item,
        relevance: Math.min(1.0, item.relevance + relevanceBoost) * decayFactor
      }
    }).sort((a, b) => b.relevance - a.relevance) // Sort by relevance descending
  }

}