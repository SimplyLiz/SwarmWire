import { describe, it, expect } from 'vitest'
import { Blackboard } from '../../src/patterns/blackboard.js'

describe('Blackboard', () => {
  it('writes and reads entries', () => {
    const board = new Blackboard()
    board.write('agent1', 1, { analysis: 'good' })
    board.write('agent2', 1, { review: 'approved' })

    const state = board.read()
    expect(state.entries.length).toBe(2)
    expect(state.merged).toEqual({ analysis: 'good', review: 'approved' })
  })

  it('latest write per key wins in merge', () => {
    const board = new Blackboard()
    board.write('agent1', 1, { score: 5 })
    board.write('agent1', 2, { score: 8 })

    const state = board.read()
    expect(state.merged.score).toBe(8)
  })

  it('reads entries by round', () => {
    const board = new Blackboard()
    board.write('a1', 1, 'round1')
    board.write('a2', 1, 'round1')
    board.write('a1', 2, 'round2')

    expect(board.readRound(1).length).toBe(2)
    expect(board.readRound(2).length).toBe(1)
  })

  it('reads latest entry from specific agent', () => {
    const board = new Blackboard()
    board.write('a1', 1, 'first')
    board.write('a1', 2, 'second')

    const entry = board.readAgent('a1')
    expect(entry?.data).toBe('second')
    expect(entry?.round).toBe(2)
  })

  it('handles non-object values', () => {
    const board = new Blackboard()
    board.write('a1', 1, 'string value')
    board.write('a2', 1, 42)

    const state = board.read()
    expect(state.merged.a1).toBe('string value')
    expect(state.merged.a2).toBe(42)
  })
})
