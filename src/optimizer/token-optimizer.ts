/**
 * Token Optimization System
 * Reduces token usage through pattern caching, context compression, and smart batching
 * Inspired by Ruflo's token optimization approach
 */

import type { MemoryBackend } from '../types/memory.js'

export interface CachedPattern {
  pattern: string
  embedding: number[]
  usageCount: number
  lastUsed: number
  tokenSavings: number
}

export interface TokenOptimizerConfig {
  memoryBackend: MemoryBackend
  maxCachedPatterns?: number
  similarityThreshold?: number
  enableCompression?: boolean
  compressionTarget?: number
  maxContextSize?: number
}

export function createTokenOptimizer(config: TokenOptimizerConfig) {
  const {
    memoryBackend,
    maxCachedPatterns = 1000,
    similarityThreshold = 0.8,
    enableCompression = true,
    compressionTarget = 0.3,
    maxContextSize = 2000
  } = config

  const patternCache: Map<string, CachedPattern> = new Map()
  let stats = { hits: 0, misses: 0, compressionSavings: 0, patternSavings: 0 }

  function findRelevantPatterns(query: string): CachedPattern[] {
    return Array.from(patternCache.values())
      .filter((p: CachedPattern) => 
        p.pattern.toLowerCase().includes(query.toLowerCase()) ||
        query.toLowerCase().includes(p.pattern.toLowerCase())
      )
      .filter((p: CachedPattern) => simpleSimilarity(p.pattern, query) >= similarityThreshold)
      .sort((a: CachedPattern, b: CachedPattern) => b.usageCount - a.usageCount)
  }

  function hashString(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i)
      hash = hash & hash
    }
    return Math.abs(hash).toString(36)
  }

  function simpleHashToVector(hash: string): number[] {
    const vec: number[] = []
    for (let i = 0; i < Math.min(hash.length, 10); i++) {
      vec.push((hash.charCodeAt(i) - 97) / 26)
    }
    while (vec.length < 10) vec.push(0.5)
    return vec
  }

  function simpleSimilarity(a: string, b: string): number {
    const setA = new Set(a.toLowerCase()), setB = new Set(b.toLowerCase())
    const intersection = new Set([...setA].filter(x => setB.has(x)))
    const union = new Set([...setA, ...setB])
    return union.size === 0 ? 0 : intersection.size / union.size
  }

  return {
    async getCompactContext(query: string): Promise<{ context: string; tokensSaved: number }> {
      const cachedPatterns = findRelevantPatterns(query)
      if (cachedPatterns.length > 0) {
        const patternContext = cachedPatterns.map((p: CachedPattern) => p.pattern).join('\n---\n')
        stats.hits += cachedPatterns.length
        const tokensSaved = cachedPatterns.reduce((sum: number, p: CachedPattern) => sum + p.tokenSavings, 0)
        stats.patternSavings += tokensSaved
        return { context: patternContext, tokensSaved }
      }
      stats.misses++
      return { context: query, tokensSaved: 0 }
    },

    async storePattern(pattern: string, _context: string, estimatedTokenSavings = 100): Promise<void> {
      const patternId = hashString(pattern)
      const cachedPattern: CachedPattern = {
        pattern, embedding: simpleHashToVector(patternId), usageCount: 1, lastUsed: Date.now(), tokenSavings: estimatedTokenSavings
      }
      await memoryBackend.store(`pattern_${patternId}`, cachedPattern, { tags: ['token-pattern'] })
      patternCache.set(patternId, cachedPattern)
      if (patternCache.size > maxCachedPatterns) {
        let lruKey = '', lruTime = Infinity
        for (const [key, p] of patternCache) {
          if (p.lastUsed < lruTime) { lruTime = p.lastUsed; lruKey = key }
        }
        if (lruKey) { patternCache.delete(lruKey); await memoryBackend.forget(`pattern_${lruKey}`) }
      }
    },

    async optimizePrompt(prompt: string): Promise<{ optimized: string; tokensSaved: number }> {
      if (!enableCompression || prompt.length < maxContextSize) return { optimized: prompt, tokensSaved: 0 }
      let optimized = prompt.replace(/\s+/g, ' ').trim()
      const replacements: [string, string][] = [['please', 'pls'], ['thank you', 'thx'], ['the', 't'], ['and', '&'], ['to', '2'], ['for', '4'], ['you', 'u'], ['are', 'r'], ['be', 'b'], ['will', 'll']]
      const originalLength = optimized.length
      for (const [from, to] of replacements) { optimized = optimized.split(from).join(to) }
      const compressionRatio = optimized.length / originalLength
      const tokensSaved = Math.max(0, Math.round((originalLength - optimized.length) / 4))
      if (compressionRatio <= compressionTarget) { stats.compressionSavings += tokensSaved; return { optimized, tokensSaved } }
      return { optimized: prompt, tokensSaved: 0 }
    },

    getOptimalBatchSize(operationCount: number, similarity: number): number {
      const baseSize = Math.min(10, Math.max(2, Math.round(operationCount * 0.3)))
      const similarityFactor = 1 + (similarity - 0.5) * 2
      return Math.min(20, Math.max(2, Math.round(baseSize * similarityFactor)))
    },

    getStats() {
      const total = stats.hits + stats.misses
      return { ...stats, hitRate: total > 0 ? stats.hits / total : 0, totalRequests: total }
    },

    resetStats() { stats = { hits: 0, misses: 0, compressionSavings: 0, patternSavings: 0 } }
  }
}

export const defaultTokenOptimizerConfig = (memoryBackend: MemoryBackend): TokenOptimizerConfig => ({
  memoryBackend, maxCachedPatterns: 1000, similarityThreshold: 0.8, enableCompression: true, compressionTarget: 0.3, maxContextSize: 2000
})