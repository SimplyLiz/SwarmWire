import { describe, it, expect } from 'vitest'
import { packContext, estimateTokens, sourceFromStepOutput } from '../../src/context/packer.js'
import type { ContextSource } from '../../src/context/packer.js'

describe('Context Packer', () => {
  it('packs sources within token budget', () => {
    const sources: ContextSource[] = [
      { type: 'evidence', id: 'e1', content: 'First evidence about the topic', tokenEstimate: 100, relevance: 0.9 },
      { type: 'evidence', id: 'e2', content: 'Second evidence with more detail', tokenEstimate: 200, relevance: 0.7 },
      { type: 'step_output', id: 's1', content: 'Previous step result', tokenEstimate: 150, relevance: 0.8 },
    ]

    const bundle = packContext(sources, { maxTokens: 300 })
    expect(bundle.tokenEstimate).toBeLessThanOrEqual(300)
    expect(bundle.sources.length).toBeLessThanOrEqual(3)
    expect(bundle.content.length).toBeGreaterThan(0)
  })

  it('prioritizes by relevance by default', () => {
    const sources: ContextSource[] = [
      { type: 'evidence', id: 'low', content: 'low relevance', tokenEstimate: 100, relevance: 0.3 },
      { type: 'evidence', id: 'high', content: 'high relevance', tokenEstimate: 100, relevance: 0.9 },
    ]

    const bundle = packContext(sources, { maxTokens: 100 })
    expect(bundle.sources[0]!.id).toBe('high')
  })

  it('respects maxPerSource truncation', () => {
    const sources: ContextSource[] = [
      { type: 'raw', id: 'big', content: 'a'.repeat(10000), tokenEstimate: 2500, relevance: 1.0 },
    ]

    const bundle = packContext(sources, { maxTokens: 5000, maxPerSource: 500 })
    expect(bundle.sources[0]!.tokenEstimate).toBe(500)
  })

  it('filters by source type', () => {
    const sources: ContextSource[] = [
      { type: 'evidence', id: 'e1', content: 'evidence', tokenEstimate: 50, relevance: 0.9 },
      { type: 'memory', id: 'm1', content: 'memory', tokenEstimate: 50, relevance: 0.8 },
      { type: 'raw', id: 'r1', content: 'raw', tokenEstimate: 50, relevance: 0.7 },
    ]

    const bundle = packContext(sources, { maxTokens: 1000, includeTypes: ['evidence', 'memory'] })
    expect(bundle.sources.length).toBe(2)
    expect(bundle.sources.every((s) => s.type !== 'raw')).toBe(true)
  })

  it('handles empty sources', () => {
    const bundle = packContext([], { maxTokens: 1000 })
    expect(bundle.sources.length).toBe(0)
    expect(bundle.tokenEstimate).toBe(0)
  })
})

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    const tokens = estimateTokens('hello world this is a test')
    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(100)
  })
})

describe('sourceFromStepOutput', () => {
  it('creates a source from string output', () => {
    const source = sourceFromStepOutput('step1', 'some result')
    expect(source.type).toBe('step_output')
    expect(source.id).toBe('step1')
    expect(source.content).toBe('some result')
    expect(source.relevance).toBe(0.8)
  })

  it('creates a source from object output', () => {
    const source = sourceFromStepOutput('step2', { key: 'value' })
    expect(source.content).toContain('key')
    expect(source.tokenEstimate).toBeGreaterThan(0)
  })
})
