import { describe, it, expect } from 'vitest'
import { SessionManager } from '../../src/session/index.js'

describe('SessionManager', () => {
  it('creates a session', () => {
    const mgr = new SessionManager()
    const sess = mgr.create('chat1')
    expect(sess.name).toBe('chat1')
    expect(sess.archived).toBe(false)
    expect(sess.messages).toHaveLength(0)
  })

  it('retrieves by id and name', () => {
    const mgr = new SessionManager()
    const sess = mgr.create('chat1')
    expect(mgr.get(sess.id)).toBe(sess)
    expect(mgr.get('chat1')).toBe(sess)
  })

  it('returns undefined for missing session', () => {
    const mgr = new SessionManager()
    expect(mgr.get('ghost')).toBeUndefined()
  })

  it('lists sessions, excluding archived by default', () => {
    const mgr = new SessionManager()
    const s1 = mgr.create('s1')
    const s2 = mgr.create('s2')
    mgr.archive(s2.id)
    expect(mgr.list()).toHaveLength(1)
    expect(mgr.list(true)).toHaveLength(2)
  })

  it('records messages', () => {
    const mgr = new SessionManager()
    const sess = mgr.create('chat1')
    mgr.record(sess.id, 'hello', 'world')
    expect(sess.messages).toHaveLength(2)
    expect(sess.messages[0]!.role).toBe('user')
    expect(sess.messages[1]!.role).toBe('assistant')
  })

  it('getContext returns formatted history', () => {
    const mgr = new SessionManager()
    const sess = mgr.create('chat1')
    mgr.record(sess.id, 'hello', 'hi there')
    const ctx = mgr.getContext(sess.id)
    expect(ctx).toContain('User: hello')
    expect(ctx).toContain('Assistant: hi there')
  })

  it('getContext returns empty string for empty session', () => {
    const mgr = new SessionManager()
    const sess = mgr.create('chat1')
    expect(mgr.getContext(sess.id)).toBe('')
  })

  it('getContext respects maxMessages limit', () => {
    const mgr = new SessionManager({ maxMessages: 2 })
    const sess = mgr.create('chat1')
    for (let i = 0; i < 5; i++) mgr.record(sess.id, `q${i}`, `a${i}`)
    const ctx = mgr.getContext(sess.id)
    // Only last 2 messages (= 1 user + 1 assistant pair actually stored per record call, 10 total, limit=2 means last 2 lines)
    const lines = ctx.trim().split('\n').filter(Boolean)
    expect(lines.length).toBeLessThanOrEqual(2)
  })

  it('deletes a session', () => {
    const mgr = new SessionManager()
    const sess = mgr.create('chat1')
    expect(mgr.delete(sess.id)).toBe(true)
    expect(mgr.get(sess.id)).toBeUndefined()
  })

  it('initialContext is stored on session', () => {
    const mgr = new SessionManager()
    const sess = mgr.create('chat1', { userId: '42' })
    expect(sess.context).toEqual({ userId: '42' })
  })
})
