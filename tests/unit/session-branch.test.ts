import { describe, it, expect } from 'vitest'
import { BranchManager } from '../../src/session/branch.js'
import type { Session } from '../../src/session/index.js'

function makeSession(id: string, messages: number = 4): Session {
  return {
    id,
    name: `session-${id}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: Array.from({ length: messages }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `message ${i}`,
      timestamp: Date.now() + i * 1000,
    })),
    context: {},
    archived: false,
  }
}

describe('BranchManager', () => {
  it('forks a session at a given index', () => {
    const manager = new BranchManager()
    const session = makeSession('root')
    const branch = manager.fork(session, 2)
    expect(branch.parentId).toBe('root')
    expect(branch.messages).toHaveLength(3) // messages 0, 1, 2
  })

  it('branch starts with copy of messages up to fork point', () => {
    const manager = new BranchManager()
    const session = makeSession('root')
    const branch = manager.fork(session, 1)
    expect(branch.messages[0]!.content).toBe('message 0')
    expect(branch.messages[1]!.content).toBe('message 1')
    expect(branch.messages).toHaveLength(2)
  })

  it('appending to branch does not affect original', () => {
    const manager = new BranchManager()
    const session = makeSession('root')
    const branch = manager.fork(session, 1)
    manager.appendMessage(branch.id, { role: 'user', content: 'new turn', timestamp: Date.now() })
    expect(session.messages).toHaveLength(4)
    expect(manager.getBranch(branch.id)!.messages).toHaveLength(3)
  })

  it('listBranches returns all children', () => {
    const manager = new BranchManager()
    const session = makeSession('root')
    manager.fork(session, 1, 'branch-a')
    manager.fork(session, 2, 'branch-b')
    const branches = manager.listBranches('root')
    expect(branches).toHaveLength(2)
  })

  it('delete removes a branch', () => {
    const manager = new BranchManager()
    const session = makeSession('root')
    const branch = manager.fork(session, 1)
    const deleted = manager.deleteBranch(branch.id)
    expect(deleted).toBe(true)
    expect(manager.getBranch(branch.id)).toBeUndefined()
    expect(manager.listBranches('root')).toHaveLength(0)
  })

  it('merge appends branch messages to target', () => {
    const manager = new BranchManager()
    const session = makeSession('root')
    const branch = manager.fork(session, 1)
    manager.appendMessage(branch.id, { role: 'user', content: 'branch-only turn', timestamp: Date.now() })

    const target = makeSession('target-root')
    target.messages = session.messages.slice(0, 2)
    const merged = manager.merge(branch.id, target)
    expect(merged).toHaveLength(1)
    expect(merged[0]!.content).toBe('branch-only turn')
  })

  it('diff returns messages unique to each branch', () => {
    const manager = new BranchManager()
    const session = makeSession('root')
    const branchA = manager.fork(session, 1)
    const branchB = manager.fork(session, 1)
    manager.appendMessage(branchA.id, { role: 'user', content: 'only in A', timestamp: Date.now() })
    manager.appendMessage(branchB.id, { role: 'user', content: 'only in B', timestamp: Date.now() })

    const { onlyInA, onlyInB } = manager.diff(branchA.id, branchB.id)
    expect(onlyInA[0]!.content).toBe('only in A')
    expect(onlyInB[0]!.content).toBe('only in B')
  })

  it('throws when maxBranches exceeded', () => {
    const manager = new BranchManager({ maxBranchesPerSession: 2 })
    const session = makeSession('root')
    manager.fork(session, 0)
    manager.fork(session, 1)
    expect(() => manager.fork(session, 2)).toThrow()
  })

  it('buildTree includes root and all children', () => {
    const manager = new BranchManager()
    const session = makeSession('root')
    manager.fork(session, 0, 'child-1')
    manager.fork(session, 1, 'child-2')

    const allSessions = new Map([[session.id, session]])
    const tree = manager.buildTree(session, allSessions)
    expect(tree.rootId).toBe('root')
    expect(tree.children.get('root')!.length).toBe(2)
  })
})
