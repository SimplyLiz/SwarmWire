import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileBoard } from '../../src/adapters/file-board.js'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), 'swarmwire-test-' + Date.now())
const testFile = join(testDir, 'board.jsonl')

describe('FileBoard', () => {
  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  })

  it('posts messages and persists to file', async () => {
    const board = new FileBoard({ path: testFile, sessionId: 'test-session' })

    board.post('agent-a', '*', 'Hello world', { type: 'status' })
    board.post('agent-b', 'agent-a', 'Got it', { type: 'answer', priority: 'high' })
    await board.flush()

    expect(existsSync(testFile)).toBe(true)

    // Read messages back
    const board2 = new FileBoard({ path: testFile, sessionId: 'test-session' })
    const count = await board2.hydrate()
    expect(count).toBe(2)

    const msgs = board2.read('agent-a')
    expect(msgs.some((m) => m.content === 'Got it')).toBe(true)
  })

  it('hydrates only matching session', async () => {
    const board1 = new FileBoard({ path: testFile, sessionId: 'session-1' })
    board1.post('a', '*', 'From session 1', { type: 'finding' })
    await board1.flush()

    const board2 = new FileBoard({ path: testFile, sessionId: 'session-2' })
    board2.post('b', '*', 'From session 2', { type: 'finding' })
    await board2.flush()

    const board3 = new FileBoard({ path: testFile })
    const count = await board3.hydrate('session-1')
    expect(count).toBe(1)
  })

  it('works without persist (in-memory only)', () => {
    const board = new FileBoard({ persist: false })
    board.post('a', '*', 'Ephemeral', { type: 'status' })

    const msgs = board.read('b')
    expect(msgs.length).toBe(1)
    expect(msgs[0].content).toBe('Ephemeral')
    expect(existsSync(board.path)).toBe(false)
  })

  it('auto-generates session ID', () => {
    const board = new FileBoard({ path: testFile })
    expect(board.session).toMatch(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{4}$/)
  })

  it('survives malformed lines in file', async () => {
    const { appendFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(testDir, { recursive: true })
    appendFileSync(testFile, '{"id":"m1","from":"a","to":"*","content":"ok","type":"finding","priority":"normal","timestamp":1,"sessionId":"s1"}\n')
    appendFileSync(testFile, 'this is not json\n')
    appendFileSync(testFile, '{"id":"m2","from":"b","to":"*","content":"also ok","type":"warning","priority":"high","timestamp":2,"sessionId":"s1"}\n')

    const board = new FileBoard({ path: testFile })
    const count = await board.hydrate('s1')
    expect(count).toBe(2) // skips malformed line
  })
})
