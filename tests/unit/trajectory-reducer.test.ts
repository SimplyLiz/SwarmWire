import { describe, it, expect } from 'vitest'
import { reduceTrajectory, classifyMessage } from '../../src/executor/trajectory-reducer.js'
import type { TrajectoryMessage } from '../../src/executor/trajectory-reducer.js'

function msg(role: TrajectoryMessage['role'], content: string, toolName?: string): TrajectoryMessage {
  return { role, content, toolName }
}

describe('reduceTrajectory', () => {
  it('returns messages unchanged when nothing to prune', () => {
    const messages = [
      msg('user', 'hello'),
      msg('assistant', 'response'),
    ]
    const { messages: result, stats } = reduceTrajectory(messages)
    expect(result).toHaveLength(2)
    expect(stats.reductionFraction).toBe(0)
  })

  it('drops empty tool results', () => {
    const messages = [
      msg('user', 'go'),
      msg('tool', '', 'search'),
      msg('assistant', 'done'),
    ]
    const { messages: result } = reduceTrajectory(messages, { minContentLength: 1 })
    expect(result.some((m) => m.role === 'tool' && m.content === '')).toBe(false)
  })

  it('deduplicates tool results — keeps last', () => {
    const messages = [
      msg('tool', 'old result', 'fetch'),
      msg('tool', 'new result', 'fetch'),
      msg('assistant', 'ok'),
    ]
    const { messages: result } = reduceTrajectory(messages, { deduplicateSameToolResults: true })
    const toolMsgs = result.filter((m) => m.role === 'tool')
    expect(toolMsgs).toHaveLength(1)
    expect(toolMsgs[0]!.content).toBe('new result')
  })

  it('prunes superseded tool results — keeps longest', () => {
    const messages = [
      msg('tool', 'short', 'search'),
      msg('tool', 'much longer result that supersedes', 'search'),
      msg('assistant', 'done'),
    ]
    const { messages: result } = reduceTrajectory(messages, {
      deduplicateSameToolResults: false,
      pruneSuperseded: true,
    })
    const toolMsgs = result.filter((m) => m.role === 'tool')
    expect(toolMsgs).toHaveLength(1)
    expect(toolMsgs[0]!.content).toBe('much longer result that supersedes')
  })

  it('respects token budget — prunes oldest non-system first', () => {
    const messages = [
      msg('system', 'you are a helper'),
      msg('user', 'A'.repeat(100)),
      msg('assistant', 'B'.repeat(100)),
    ]
    const { messages: result } = reduceTrajectory(messages, {
      maxTokenBudget: 10,
      tokensPerChar: 1,
    })
    // System message should survive
    expect(result.some((m) => m.role === 'system')).toBe(true)
  })

  it('respects maxMessages tail limit', () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      msg('user', `msg ${i}`),
    )
    const { messages: result } = reduceTrajectory(messages, { maxMessages: 3 })
    expect(result).toHaveLength(3)
    expect(result[2]!.content).toBe('msg 9')
  })

  it('stats reflect actual reduction', () => {
    const messages = [
      msg('tool', 'a', 'x'),
      msg('tool', 'a', 'x'),
      msg('assistant', 'ok'),
    ]
    const { stats } = reduceTrajectory(messages)
    expect(stats.originalCount).toBe(3)
    expect(stats.reducedCount).toBeLessThanOrEqual(3)
    expect(stats.reductionFraction).toBeGreaterThanOrEqual(0)
  })
})

describe('classifyMessage', () => {
  it('classifies system messages as active', () => {
    expect(classifyMessage(msg('system', 'instructions'))).toBe('active')
  })

  it('classifies null tool results as expired', () => {
    expect(classifyMessage(msg('tool', 'null'))).toBe('expired')
  })

  it('classifies short tool results as expired', () => {
    expect(classifyMessage(msg('tool', 'ok'))).toBe('expired')
  })

  it('classifies substantive tool results as active', () => {
    expect(classifyMessage(msg('tool', 'This is a meaningful result with content'))).toBe('active')
  })
})
