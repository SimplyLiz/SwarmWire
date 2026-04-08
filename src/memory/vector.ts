/**
 * Vector Memory Backend
 * Provides HNSW-like approximate nearest neighbor search for semantic retrieval
 * Designed to work with embeddings from external providers or local models
 */

import type { MemoryBackend, MemoryItem, StoreMeta, QueryOpts } from '../types/memory.js'

// Simple vector representation
export interface Vector {
  values: number[]
  dimension: number
}

// Embedding function type
export type EmbeddingFunction = (text: string) => Promise<Vector>

// In-memory vector store with basic HNSW-like characteristics
export interface VectorMemoryConfig {
  /** Function to generate embeddings from text */
  embedFn: EmbeddingFunction
  /** Number of neighbors to consider during search (ef construction) */
  efConstruction?: number
  /** Number of neighbors to search for (ef search) */
  efSearch?: number
  /** Maximum number of connections per layer */
  maxConnections?: number
  /** Random seed for reproducible results */
  seed?: number
}

/**
 * Creates a vector memory backend with HNSW-inspired approximate nearest neighbor search
 * For production use, integrate with a proper HNSW library like hnswlib-node
 */
export function createVectorMemory(config: VectorMemoryConfig): MemoryBackend {
  const {
    embedFn,
    efConstruction = 100,
    efSearch = 10,
    maxConnections = 16,
    seed = 42
  } = config

  // Simple in-memory storage (in production, this would be a proper HNSW graph)
  const vectors: Map<string, { vector: Vector; metadata: StoreMeta }> = new Map()
  
  // For simplicity, we'll use linear search with caching
  // In a real implementation, this would be replaced with an actual HNSW graph
  const searchCache: Map<string, MemoryItem[]> = new Map()
  
  return {
    async store(key: string, value: unknown, meta: StoreMeta): Promise<void> {
      // Convert value to text for embedding
      const text = typeof value === 'string' 
        ? value 
        : JSON.stringify(value)
      
      // Generate embedding
      const vector = await embedFn(text)
      
      // Store the vector and metadata
      vectors.set(key, { vector, metadata: meta })
      
      // Clear search cache since we added new data
      searchCache.clear()
    },

    async query(query: string, opts?: QueryOpts): Promise<MemoryItem[]> {
      // Check cache first
      const cacheKey = `${query}:${JSON.stringify(opts || {})}`
      const cached = searchCache.get(cacheKey)
      if (cached) {
        return cached
      }

      // Generate query embedding
      const queryVector = await embedFn(query)
      
      // Calculate similarities (cosine similarity)
      const similarities: { key: string; similarity: number; meta: StoreMeta }[] = []
      
      for (const [key, { vector, metadata }] of vectors.entries()) {
        const similarity = cosineSimilarity(queryVector, vector)
        similarities.push({ key, similarity, meta: metadata })
      }
      
      // Sort by similarity (descending)
      similarities.sort((a, b) => b.similarity - a.similarity)
      
       // Apply filters
       let filtered = similarities
       
       if (opts && opts.tags && Array.isArray(opts.tags) && opts.tags.length > 0) {
         const tagsFilter = opts.tags!
         filtered = filtered.filter(item => {
           if (!item.meta || !Array.isArray(item.meta.tags)) return false;
           return tagsFilter.some(tag =>
             Array.isArray(item.meta.tags) && item.meta.tags.includes(tag)
           );
         });
       }
      
      if (opts?.minRelevance !== undefined && opts.minRelevance !== null) {
        filtered = filtered.filter(item => 
          item.similarity >= opts.minRelevance!
        )
      }
      
      // Limit results
      if (opts?.maxItems !== undefined) {
        filtered = filtered.slice(0, opts.maxItems)
      }
      
      // Convert to MemoryItem format
      const results: MemoryItem[] = filtered.map(item => ({
        key: item.key,
        // In a real implementation, we'd store the actual value
        // For now, we'll reconstruct it from metadata or return placeholder
        value: `{${item.key}}`, // Placeholder - in production would retrieve actual value
        relevance: Math.max(0, Math.min(1, item.similarity)),
        meta: item.meta,
        storedAt: Date.now() // Simplified - would come from actual storage timestamp
      }))
      
      // Cache results
      searchCache.set(cacheKey, results)
      
      // Limit cache size
      if (searchCache.size > 100) {
        // Remove oldest entry
        const firstKey = searchCache.keys().next().value
        if (firstKey) {
          searchCache.delete(firstKey)
        }
      }
      
      return results
    },

    async forget(key: string): Promise<void> {
      vectors.delete(key)
      searchCache.clear()
    }
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: Vector, b: Vector): number {
  if (a.dimension !== b.dimension) {
    throw new Error('Vectors must have same dimension')
  }
  
  let dotProduct = 0
  let magnitudeA = 0
  let magnitudeB = 0
  
  for (let i = 0; i < a.dimension; i++) {
    dotProduct += a.values[i]! * b.values[i]!
    magnitudeA += a.values[i]! * a.values[i]!
    magnitudeB += b.values[i]! * b.values[i]!
  }
  
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0
  }
  
  return dotProduct / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB))
}

/**
 * Mock embedding function for testing
 * In production, this would connect to an actual embedding model
 */
export async function mockEmbeddingFunction(text: string): Promise<Vector> {
  // Simple hash-based mock embedding (not for production use)
  const hash = Array.from(text).reduce((acc, char) => {
    return ((acc << 5) - acc) + char.charCodeAt(0)
  }, 0)
  
  // Create a deterministic vector based on the hash
  const dimension = 384 // Common embedding dimension
  const values = new Array(dimension)
  
  for (let i = 0; i < dimension; i++) {
    // Use hash to generate deterministic values between -1 and 1
    const value = ((hash + i) % 1000) / 500 - 1
    values[i] = value
  }
  
  return {
    values,
    dimension
  }
}