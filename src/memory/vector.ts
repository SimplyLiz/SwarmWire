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

// ---------------------------------------------------------------------------
// Quantization
// ---------------------------------------------------------------------------

export interface QuantizationConfig {
  method: 'binary' | 'scalar' | 'product'
  /** Scalar quantization bits. Default 8. */
  bits?: number
  /** Product quantization sub-vectors. Default 8. */
  subvectors?: number
}

export interface VectorCodec {
  compress(v: Vector): number[]
  decompress(codes: number[], dim: number): Vector
}

export function createQuantizer(config: QuantizationConfig): VectorCodec {
  switch (config.method) {
    case 'binary':
      return createBinaryCodec()
    case 'scalar':
      return createScalarCodec(config.bits ?? 8)
    case 'product':
      return createProductCodec(config.subvectors ?? 8)
    default:
      throw new Error(`Unknown quantization method: ${String(config.method)}`)
  }
}

function createBinaryCodec(): VectorCodec {
  return {
    compress(v: Vector): number[] {
      return v.values.map((x) => (x >= 0 ? 1 : 0))
    },
    decompress(codes: number[], dim: number): Vector {
      const values = codes.slice(0, dim).map((c) => (c === 1 ? 1 : -1))
      return { values, dimension: dim }
    },
  }
}

function createScalarCodec(bits: number): VectorCodec {
  const levels = Math.pow(2, bits) - 1
  return {
    compress(v: Vector): number[] {
      const vals = v.values
      let min = Infinity
      let max = -Infinity
      for (const x of vals) {
        if (x < min) min = x
        if (x > max) max = x
      }
      const range = max - min || 1
      const quantized = vals.map((x) => Math.round(((x - min) / range) * levels))
      return [min, max, ...quantized]
    },
    decompress(codes: number[], dim: number): Vector {
      const min = codes[0]!
      const max = codes[1]!
      const range = max - min || 1
      const quantized = codes.slice(2, 2 + dim)
      const values = quantized.map((q) => min + (q / levels) * range)
      return { values, dimension: dim }
    },
  }
}

function createProductCodec(numSubvectors: number): VectorCodec {
  // Lazy codebook: Map<subIdx, centroids[]>
  const codebooks: Map<number, number[][]> = new Map()
  const sampleBuffer: Map<number, number[][]> = new Map()
  const MIN_SAMPLES = 10
  const MAX_CENTROIDS = 16 // keep init fast in tests
  const MAX_ITER = 10

  function getSubDim(dim: number, subIdx: number): [number, number] {
    const subDim = Math.ceil(dim / numSubvectors)
    const start = subIdx * subDim
    const end = Math.min(start + subDim, dim)
    return [start, end]
  }

  function kMeans(vecs: number[][], k: number): number[][] {
    const actualK = Math.min(k, vecs.length)
    // Initialize with first k unique vectors
    const centroids: number[][] = []
    for (const v of vecs) {
      if (centroids.length >= actualK) break
      if (!centroids.some((c) => c.every((x, i) => x === v[i]!))) {
        centroids.push([...v])
      }
    }
    while (centroids.length < actualK) {
      centroids.push([...(vecs[0] ?? [])])
    }

    for (let iter = 0; iter < MAX_ITER; iter++) {
      const clusters: number[][][] = Array.from({ length: actualK }, () => [])
      for (const v of vecs) {
        let best = 0
        let bestDist = Infinity
        for (let ci = 0; ci < centroids.length; ci++) {
          let dist = 0
          const c = centroids[ci]!
          for (let d = 0; d < v.length; d++) dist += (v[d]! - c[d]!) ** 2
          if (dist < bestDist) { bestDist = dist; best = ci }
        }
        clusters[best]!.push(v)
      }
      let changed = false
      for (let ci = 0; ci < actualK; ci++) {
        const cluster = clusters[ci]!
        if (cluster.length === 0) continue
        const newCentroid = new Array<number>(cluster[0]!.length).fill(0)
        for (const v of cluster) for (let d = 0; d < v.length; d++) newCentroid[d]! += v[d]!
        for (let d = 0; d < newCentroid.length; d++) newCentroid[d]! /= cluster.length
        if (!newCentroid.every((x, i) => x === centroids[ci]![i]!)) changed = true
        centroids[ci] = newCentroid
      }
      if (!changed) break
    }
    return centroids
  }

  function buildCodebookIfReady(subIdx: number): void {
    const samples = sampleBuffer.get(subIdx) ?? []
    if (samples.length < MIN_SAMPLES) return
    if (codebooks.has(subIdx)) return // already built
    const centroids = kMeans(samples, MAX_CENTROIDS)
    codebooks.set(subIdx, centroids)
  }

  function findNearestCentroid(sub: number[], centroids: number[][]): number {
    let best = 0
    let bestDist = Infinity
    for (let ci = 0; ci < centroids.length; ci++) {
      let dist = 0
      const c = centroids[ci]!
      for (let d = 0; d < sub.length; d++) dist += (sub[d]! - c[d]!) ** 2
      if (dist < bestDist) { bestDist = dist; best = ci }
    }
    return best
  }

  return {
    compress(v: Vector): number[] {
      const dim = v.dimension
      const codes: number[] = []

      for (let si = 0; si < numSubvectors; si++) {
        const [start, end] = getSubDim(dim, si)
        const sub = v.values.slice(start, end)

        // Accumulate samples
        const samples = sampleBuffer.get(si) ?? []
        samples.push(sub)
        sampleBuffer.set(si, samples)

        buildCodebookIfReady(si)

        const centroids = codebooks.get(si)
        if (!centroids) {
          // Not enough samples yet — store raw-as-codebook with code=0
          if (!codebooks.has(si)) {
            codebooks.set(si, [sub])
          }
          codes.push(0)
        } else {
          codes.push(findNearestCentroid(sub, centroids))
        }
      }

      return codes
    },

    decompress(codes: number[], dim: number): Vector {
      const values: number[] = []

      for (let si = 0; si < numSubvectors; si++) {
        const [start, end] = getSubDim(dim, si)
        const subDim = end - start
        const centroids = codebooks.get(si)
        const code = codes[si] ?? 0

        if (!centroids) {
          values.push(...new Array<number>(subDim).fill(0))
        } else {
          const centroid = centroids[code] ?? centroids[0]!
          // centroid may be shorter than subDim if dim changed
          for (let d = 0; d < subDim; d++) {
            values.push(centroid[d] ?? 0)
          }
        }
      }

      return { values: values.slice(0, dim), dimension: dim }
    },
  }
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
  /** Optional quantization to compress stored vectors */
  quantization?: QuantizationConfig
}

/**
 * Creates a vector memory backend with HNSW-inspired approximate nearest neighbor search
 * For production use, integrate with a proper HNSW library like hnswlib-node
 */
// Internal stored entry — may be raw vector or quantized representation
interface StoredEntry {
  raw?: Vector
  quantized?: { compressed: number[]; dim: number }
  metadata: StoreMeta
}

export function createVectorMemory(config: VectorMemoryConfig): MemoryBackend {
  const {
    embedFn,
    efConstruction = 100,
    efSearch = 10,
    maxConnections = 16,
    seed = 42,
  } = config

  // Create quantizer once if configured
  const codec = config.quantization ? createQuantizer(config.quantization) : null

  // Suppress unused variable warnings from original defaults
  void efConstruction; void efSearch; void maxConnections; void seed

  // Simple in-memory storage (in production, this would be a proper HNSW graph)
  const vectors: Map<string, StoredEntry> = new Map()

  // For simplicity, we'll use linear search with caching
  const searchCache: Map<string, MemoryItem[]> = new Map()

  return {
    async store(key: string, value: unknown, meta: StoreMeta): Promise<void> {
      // Convert value to text for embedding
      const text = typeof value === 'string'
        ? value
        : JSON.stringify(value)

      // Generate embedding
      const vector = await embedFn(text)

      const entry: StoredEntry = { metadata: meta }
      if (codec) {
        entry.quantized = { compressed: codec.compress(vector), dim: vector.dimension }
      } else {
        entry.raw = vector
      }

      // Store the vector and metadata
      vectors.set(key, entry)

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

      for (const [key, entry] of vectors.entries()) {
        // Decompress if quantized
        let storedVector: Vector
        if (entry.quantized && codec) {
          storedVector = codec.decompress(entry.quantized.compressed, entry.quantized.dim)
        } else if (entry.raw) {
          storedVector = entry.raw
        } else {
          continue
        }

        const similarity = cosineSimilarity(queryVector, storedVector)
        similarities.push({ key, similarity, meta: entry.metadata })
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
        value: `{${item.key}}`, // Placeholder
        relevance: Math.max(0, Math.min(1, item.similarity)),
        meta: item.meta,
        storedAt: Date.now()
      }))

      // Cache results
      searchCache.set(cacheKey, results)

      // Limit cache size
      if (searchCache.size > 100) {
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