import { describe, it, expect } from 'vitest'
import { RollbackManager } from '../../src/executor/rollback.js'

describe('RollbackManager', () => {
  it('creates a snapshot and retrieves it', () => {
    const mgr = new RollbackManager()
    const id = mgr.snapshot('exec1', 'step1', 'agent1', 'llm_call', { before: true })
    const snaps = mgr.getSnapshots('exec1')
    expect(snaps).toHaveLength(1)
    expect(snaps[0]!.id).toBe(id)
    expect(snaps[0]!.beforeState).toEqual({ before: true })
  })

  it('completes a snapshot with afterState', () => {
    const mgr = new RollbackManager()
    const id = mgr.snapshot('exec1', 'step1', 'agent1', 'llm_call', { before: true })
    mgr.complete(id, { after: true })
    const snap = mgr.getSnapshots('exec1')[0]!
    expect(snap.afterState).toEqual({ after: true })
  })

  it('rolls back a reversible snapshot', () => {
    const mgr = new RollbackManager()
    const id = mgr.snapshot('exec1', 'step1', 'agent1', 'llm_call', { val: 1 })
    const result = mgr.rollback(id)
    expect(result.restored).toBe(true)
    expect(mgr.getSnapshots('exec1')[0]!.reversed).toBe(true)
  })

  it('refuses to roll back a non-reversible snapshot', () => {
    const mgr = new RollbackManager()
    const id = mgr.snapshot('exec1', 'step1', 'agent1', 'file_write', {}, false)
    const result = mgr.rollback(id)
    expect(result.restored).toBe(false)
    expect(result.reason).toContain('not reversible')
  })

  it('returns not-found for missing snapshot', () => {
    const mgr = new RollbackManager()
    const result = mgr.rollback('nonexistent')
    expect(result.restored).toBe(false)
    expect(result.reason).toContain('not found')
  })

  it('undoExecution rolls back all reversible snapshots in reverse order', () => {
    const mgr = new RollbackManager()
    const id1 = mgr.snapshot('exec1', 'step1', 'agent1', 'llm_call', 'before1')
    const id2 = mgr.snapshot('exec1', 'step2', 'agent1', 'llm_call', 'before2')
    const results = mgr.undoExecution('exec1')
    expect(results).toHaveLength(2)
    // Reverse order — id2 first
    expect(results[0]!.snapshotId).toBe(id2)
    expect(results[1]!.snapshotId).toBe(id1)
    expect(results.every((r) => r.restored)).toBe(true)
  })

  it('clear removes all snapshots for an execution', () => {
    const mgr = new RollbackManager()
    mgr.snapshot('exec1', 'step1', 'agent1', 'llm_call', {})
    mgr.clear('exec1')
    expect(mgr.getSnapshots('exec1')).toHaveLength(0)
  })

  it('evicts oldest when maxSnapshots exceeded', () => {
    const mgr = new RollbackManager(3)
    const id1 = mgr.snapshot('exec1', 'step1', 'agent1', 'llm_call', 'a')
    mgr.snapshot('exec1', 'step2', 'agent1', 'llm_call', 'b')
    mgr.snapshot('exec1', 'step3', 'agent1', 'llm_call', 'c')
    mgr.snapshot('exec1', 'step4', 'agent1', 'llm_call', 'd')
    const snaps = mgr.getSnapshots('exec1')
    expect(snaps.some((s) => s.id === id1)).toBe(false)
    expect(snaps).toHaveLength(3)
  })
})
