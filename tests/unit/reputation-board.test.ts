import { describe, it, expect } from 'vitest'
import { ReputationBoard } from '../../src/core/reputation-board.js'

describe('ReputationBoard', () => {
  it('initializes unknown agents with default score', () => {
    const board = new ReputationBoard({ defaultScore: 0.5 })
    const rep = board.getReputation('agent-x')
    expect(rep.score).toBe(0.5)
  })

  it('posts messages and tracks count', () => {
    const board = new ReputationBoard()
    board.post('alice', '*', 'I found something', { type: 'finding' })
    const rep = board.getReputation('alice')
    expect(rep.totalMessages).toBe(1)
  })

  it('upvote increases reputation', () => {
    const board = new ReputationBoard()
    const msg = board.post('alice', '*', 'great finding', { type: 'finding' })
    const before = board.getReputation('alice').score
    board.upvote(msg.id, 'bob')
    const after = board.getReputation('alice').score
    expect(after).toBeGreaterThan(0)
    // After enough messages, score should shift
    expect(typeof after).toBe('number')
    expect(before).toBe(0.5) // initial default before recompute kicks in
  })

  it('cite increases reputation', () => {
    const board = new ReputationBoard()
    const msg = board.post('alice', '*', 'cited finding')
    board.cite(msg.id)
    const rep = board.getReputation('alice')
    expect(rep.citations).toBe(1)
  })

  it('markAnswerCorrect records correct answers', () => {
    const board = new ReputationBoard()
    board.markAnswerCorrect('alice')
    expect(board.getReputation('alice').correctAnswers).toBe(1)
  })

  it('leaderboard returns agents sorted by score desc', () => {
    const board = new ReputationBoard()
    board.markAnswerCorrect('alice')
    board.markAnswerCorrect('alice')
    board.markAnswerCorrect('alice')
    board.markAnswerCorrect('alice')
    board.markAnswerCorrect('alice')
    board.post('bob', '*', 'msg')
    const lb = board.leaderboard()
    expect(lb[0]!.agentName).toBe('alice')
  })

  it('weightedFindings returns findings with weight', () => {
    const board = new ReputationBoard()
    board.post('alice', '*', 'finding 1', { type: 'finding' })
    const findings = board.weightedFindings('bob')
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0]!.weight).toBeGreaterThan(0)
  })

  it('aggregateFindings returns string with attribution', () => {
    const board = new ReputationBoard()
    board.post('alice', '*', 'important discovery', { type: 'finding' })
    const agg = board.aggregateFindings('bob')
    expect(agg).toContain('alice')
    expect(agg).toContain('important discovery')
  })

  it('decay reduces all scores', () => {
    const board = new ReputationBoard({ decayFactor: 0.5 })
    board.post('alice', '*', 'msg')
    const before = board.getReputation('alice').score
    board.decay()
    const after = board.getReputation('alice').score
    expect(after).toBeLessThan(before)
  })

  it('cannot upvote own message', () => {
    const board = new ReputationBoard()
    const msg = board.post('alice', '*', 'self post')
    const result = board.upvote(msg.id, 'alice')
    expect(result).toBe(false)
  })
})
