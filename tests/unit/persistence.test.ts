import { describe, it, expect } from 'vitest'
import { saveState, loadState, emptyState } from '../../src/persistence/store.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('Persistence', () => {
  it('saves and loads state from file', async () => {
    const state = emptyState()
    state.adaptiveRouterHistory.push({
      taskDomain: ['code'],
      taskDifficulty: 'medium',
      agentName: 'test-agent',
      model: 'test',
      provider: 'test',
      success: true,
      costCents: 5,
      durationMs: 500,
      qualityScore: 0.8,
      timestamp: Date.now(),
    })

    const path = join(tmpdir(), `swarmwire-test-${Date.now()}.json`)
    await saveState(state, path)

    const loaded = await loadState(path)
    expect(loaded).not.toBeNull()
    expect(loaded!.version).toBe('0.1.0')
    expect(loaded!.adaptiveRouterHistory.length).toBe(1)
    expect(loaded!.adaptiveRouterHistory[0]!.agentName).toBe('test-agent')
  })

  it('returns null for non-existent file', async () => {
    const loaded = await loadState('/tmp/swarmwire-nonexistent-12345.json')
    expect(loaded).toBeNull()
  })

  it('creates empty state', () => {
    const state = emptyState()
    expect(state.version).toBe('0.1.0')
    expect(state.adaptiveRouterHistory.length).toBe(0)
    expect(Object.keys(state.orchestratorSequences).length).toBe(0)
  })
})
