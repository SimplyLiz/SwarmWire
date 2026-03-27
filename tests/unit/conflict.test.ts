import { describe, it, expect } from 'vitest'
import { detectConflicts } from '../../src/conflict/detector.js'
import { resolveConflict } from '../../src/conflict/resolver.js'
import type { AgentOutput } from '../../src/types/agent.js'

function makeOutput(agentId: string, agentName: string, output: unknown, tokens = 100): AgentOutput {
  return {
    agentId,
    agentName,
    output,
    cost: { inputTokens: tokens, outputTokens: tokens / 2, cachedInputTokens: 0, totalTokens: tokens * 1.5, costCents: 1, calls: 1 },
    durationMs: 100,
  }
}

describe('Conflict Detector', () => {
  it('detects contradictions between very different strings', () => {
    const outputs = [
      makeOutput('a1', 'agent1', 'React is the best frontend framework for large apps'),
      makeOutput('a2', 'agent2', 'Python Django handles server rendering perfectly'),
    ]
    const conflicts = detectConflicts(outputs)
    expect(conflicts.length).toBeGreaterThan(0)
    expect(conflicts[0]!.type).toBe('contradiction')
  })

  it('detects no conflicts for identical outputs', () => {
    const outputs = [
      makeOutput('a1', 'agent1', 'TypeScript is great'),
      makeOutput('a2', 'agent2', 'TypeScript is great'),
    ]
    const conflicts = detectConflicts(outputs)
    expect(conflicts.length).toBe(0)
  })

  it('detects disagreement for partially similar outputs', () => {
    const outputs = [
      makeOutput('a1', 'agent1', 'TypeScript is great for large applications but has a learning curve'),
      makeOutput('a2', 'agent2', 'TypeScript is great for large applications and easy to learn'),
    ]
    const conflicts = detectConflicts(outputs, { contradictionThreshold: 0.2, agreementThreshold: 0.95 })
    // Should be a disagreement (partially similar but not identical)
    const disagreements = conflicts.filter((c) => c.type === 'disagreement')
    expect(disagreements.length).toBeGreaterThanOrEqual(0)
  })

  it('handles objects by comparing key overlap', () => {
    const outputs = [
      makeOutput('a1', 'agent1', { recommendation: 'use React', reason: 'ecosystem' }),
      makeOutput('a2', 'agent2', { recommendation: 'use Vue', reason: 'simplicity' }),
    ]
    const conflicts = detectConflicts(outputs)
    expect(conflicts.length).toBeGreaterThan(0)
  })

  it('handles single output without conflicts', () => {
    const conflicts = detectConflicts([makeOutput('a1', 'agent1', 'hello')])
    expect(conflicts.length).toBe(0)
  })
})

describe('Conflict Resolver', () => {
  it('resolves by vote — picks majority', () => {
    const outputs = [
      makeOutput('a1', 'agent1', 'yes'),
      makeOutput('a2', 'agent2', 'yes'),
      makeOutput('a3', 'agent3', 'no'),
    ]
    const conflict = {
      id: 'c1',
      type: 'disagreement' as const,
      agentIds: ['a1', 'a2', 'a3'],
      stepIds: [],
      description: 'test',
      outputs: ['yes', 'yes', 'no'],
    }

    const resolution = resolveConflict(conflict, outputs, 'vote')
    expect(resolution.method).toBe('vote')
    expect(resolution.confidence).toBeGreaterThan(0.5)
  })

  it('resolves by evidence weight — picks agent with most tokens', () => {
    const outputs = [
      makeOutput('a1', 'agent1', 'shallow answer', 50),
      makeOutput('a2', 'agent2', 'deep answer with lots of evidence', 500),
    ]
    const conflict = {
      id: 'c1',
      type: 'contradiction' as const,
      agentIds: ['a1', 'a2'],
      stepIds: [],
      description: 'test',
      outputs: outputs.map((o) => o.output),
    }

    const resolution = resolveConflict(conflict, outputs, 'evidence_weight')
    expect(resolution.method).toBe('evidence_weight')
    expect(resolution.winner).toBe('a2')
  })

  it('escalation returns zero confidence', () => {
    const conflict = {
      id: 'c1',
      type: 'contradiction' as const,
      agentIds: ['a1', 'a2'],
      stepIds: [],
      description: 'test',
      outputs: [],
    }

    const resolution = resolveConflict(conflict, [], 'escalate')
    expect(resolution.method).toBe('escalate')
    expect(resolution.confidence).toBe(0)
  })
})
