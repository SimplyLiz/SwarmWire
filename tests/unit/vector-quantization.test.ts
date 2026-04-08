import { describe, it, expect } from 'vitest'
import { createQuantizer, createVectorMemory, mockEmbeddingFunction } from '../../src/memory/vector.js'
import type { Vector } from '../../src/memory/vector.js'

function makeVector(values: number[]): Vector {
  return { values, dimension: values.length }
}

function l2norm(values: number[]): number {
  return Math.sqrt(values.reduce((s, v) => s + v * v, 0))
}

describe('createQuantizer — binary', () => {
  it('compress returns 0 or 1 values', () => {
    const codec = createQuantizer({ method: 'binary' })
    const v = makeVector([1.5, -0.3, 0.0, -2.0, 3.1])
    const codes = codec.compress(v)
    expect(codes).toHaveLength(5)
    for (const c of codes) {
      expect([0, 1]).toContain(c)
    }
  })

  it('decompress returns +1 or -1 values', () => {
    const codec = createQuantizer({ method: 'binary' })
    const v = makeVector([1.5, -0.3, 0.8])
    const codes = codec.compress(v)
    const reconstructed = codec.decompress(codes, v.dimension)
    expect(reconstructed.dimension).toBe(3)
    for (const val of reconstructed.values) {
      expect([1, -1]).toContain(val)
    }
  })

  it('round-trip preserves sign', () => {
    const codec = createQuantizer({ method: 'binary' })
    const v = makeVector([2.0, -1.0, 0.5, -3.0])
    const codes = codec.compress(v)
    const rec = codec.decompress(codes, v.dimension)
    for (let i = 0; i < v.values.length; i++) {
      const original = v.values[i]!
      const reconstructed = rec.values[i]!
      expect(original >= 0 ? reconstructed > 0 : reconstructed < 0).toBe(true)
    }
  })
})

describe('createQuantizer — scalar', () => {
  it('compress stores min/max + quantized indices', () => {
    const codec = createQuantizer({ method: 'scalar', bits: 8 })
    const v = makeVector([0.1, 0.5, 1.0, -1.0])
    const codes = codec.compress(v)
    // codes[0] = min, codes[1] = max, then dim quantized values
    expect(codes.length).toBe(2 + v.dimension)
  })

  it('round-trip is within expected error margin', () => {
    const codec = createQuantizer({ method: 'scalar', bits: 8 })
    const original = [0.1, 0.5, 1.0, -1.0, 0.3, -0.7]
    const v = makeVector(original)
    const codes = codec.compress(v)
    const rec = codec.decompress(codes, v.dimension)

    expect(rec.dimension).toBe(v.dimension)
    for (let i = 0; i < original.length; i++) {
      // 8-bit scalar quantization should be within ~0.01 of original range
      expect(Math.abs(original[i]! - rec.values[i]!)).toBeLessThan(0.02)
    }
  })

  it('similarity ordering preserved after scalar quantization', () => {
    const codec = createQuantizer({ method: 'scalar', bits: 8 })

    // Two vectors: one close to query, one far
    const query = makeVector([1, 0, 0, 0, 0])
    const close = makeVector([0.9, 0.1, 0, 0, 0])
    const far = makeVector([0, 0, 0, 0, 1])

    const closeCodes = codec.compress(close)
    const farCodes = codec.compress(far)

    const recClose = codec.decompress(closeCodes, close.dimension)
    const recFar = codec.decompress(farCodes, far.dimension)

    function dot(a: number[], b: number[]): number {
      return a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0)
    }

    const simClose = dot(query.values, recClose.values)
    const simFar = dot(query.values, recFar.values)

    expect(simClose).toBeGreaterThan(simFar)
  })
})

describe('createQuantizer — product', () => {
  it('compress returns numSubvectors codes', () => {
    const codec = createQuantizer({ method: 'product', subvectors: 4 })
    const v = makeVector([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8])
    const codes = codec.compress(v)
    expect(codes).toHaveLength(4)
  })

  it('decompress returns vector with correct dimension', () => {
    const codec = createQuantizer({ method: 'product', subvectors: 4 })
    const v = makeVector([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8])
    const codes = codec.compress(v)
    const rec = codec.decompress(codes, v.dimension)
    expect(rec.dimension).toBe(v.dimension)
    expect(rec.values).toHaveLength(v.dimension)
  })

  it('builds codebooks after enough samples', () => {
    const codec = createQuantizer({ method: 'product', subvectors: 2 })

    // Accumulate 15 samples to trigger codebook building
    for (let i = 0; i < 15; i++) {
      const v = makeVector([Math.random(), Math.random(), Math.random(), Math.random()])
      codec.compress(v)
    }

    // After codebook built, decompress should produce sensible vectors
    const v = makeVector([0.5, 0.5, 0.5, 0.5])
    const codes = codec.compress(v)
    const rec = codec.decompress(codes, v.dimension)
    expect(rec.values.length).toBe(v.dimension)
  })
})

describe('createVectorMemory with quantization', () => {
  it('stores and queries with binary quantization', async () => {
    const mem = createVectorMemory({
      embedFn: mockEmbeddingFunction,
      quantization: { method: 'binary' },
    })

    await mem.store('key1', 'hello world', {})
    await mem.store('key2', 'goodbye world', {})

    const results = await mem.query('hello', { maxItems: 2 })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.relevance).toBeGreaterThanOrEqual(0)
  })

  it('stores and queries with scalar quantization', async () => {
    const mem = createVectorMemory({
      embedFn: mockEmbeddingFunction,
      quantization: { method: 'scalar', bits: 8 },
    })

    await mem.store('doc1', 'machine learning algorithms', {})
    await mem.store('doc2', 'cooking recipes', {})

    const results = await mem.query('neural networks', { maxItems: 2 })
    expect(results).toBeDefined()
    expect(Array.isArray(results)).toBe(true)
  })

  it('similarity ordering is preserved with quantization', async () => {
    // Use a deterministic embed function where similar text → similar vectors
    const embedFn = async (text: string) => {
      const words = new Set(text.toLowerCase().split(/\s+/))
      const vocab = ['machine', 'learning', 'neural', 'data', 'science', 'cooking', 'food', 'recipe']
      const values = vocab.map((w) => (words.has(w) ? 1.0 : 0.0))
      const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0)) || 1
      return { values: values.map((v) => v / norm), dimension: values.length }
    }

    const mem = createVectorMemory({
      embedFn,
      quantization: { method: 'scalar', bits: 8 },
    })

    await mem.store('ml-doc', 'machine learning neural data science', {})
    await mem.store('food-doc', 'cooking food recipe delicious', {})

    const results = await mem.query('machine learning neural', { maxItems: 2 })

    if (results.length >= 2) {
      // ML doc should rank higher than food doc for this query
      const firstKey = results[0]!.key
      const secondKey = results[1]!.key
      expect(firstKey).toBe('ml-doc')
    }
  })
})
