import { describe, it, expect } from 'vitest'
import { evalTrajectory, compareTrajectories } from '../../src/testing/trajectory-eval.js'
import type { Trajectory, TrajectoryStep } from '../../src/testing/trajectory-eval.js'

function makeStep(id: string, name: string, tools: string[] = [], retried = false): TrajectoryStep {
  return {
    stepId: id,
    stepName: name,
    agentName: 'agent',
    input: 'in',
    output: 'out',
    toolCalls: tools.map((t) => ({ toolName: t, input: {}, output: {}, durationMs: 10 })),
    durationMs: 100,
    tokenCount: 50,
    retried,
  }
}

function makeTrajectory(steps: TrajectoryStep[], success = true): Trajectory {
  return {
    id: 'traj1',
    goal: 'test goal',
    steps,
    finalOutput: success ? 'result' : null,
    success,
    totalTokens: steps.length * 50,
    totalDurationMs: steps.length * 100,
  }
}

describe('evalTrajectory', () => {
  it('returns score between 0 and 1', async () => {
    const traj = makeTrajectory([makeStep('s1', 'fetch'), makeStep('s2', 'process')])
    const result = await evalTrajectory(traj)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
  })

  it('perfect trajectory scores near 1', async () => {
    const traj = makeTrajectory([makeStep('s1', 'search'), makeStep('s2', 'summarize')])
    const result = await evalTrajectory(traj, {
      expectedSteps: ['search', 'summarize'],
      maxSteps: 2,
    })
    expect(result.score).toBeGreaterThan(0.7)
  })

  it('failed trajectory with no outcome scorer scores low', async () => {
    const traj = makeTrajectory([makeStep('s1', 'search')], false)
    const result = await evalTrajectory(traj)
    expect(result.breakdown.outcomeQuality).toBe(0)
  })

  it('backtracking lowers score', async () => {
    const noRetry = makeTrajectory([makeStep('s1', 'a'), makeStep('s2', 'b')])
    const withRetry = makeTrajectory([makeStep('s1', 'a', [], true), makeStep('s2', 'b')])
    const r1 = await evalTrajectory(noRetry)
    const r2 = await evalTrajectory(withRetry)
    expect(r1.breakdown.backtrackRate).toBeGreaterThan(r2.breakdown.backtrackRate)
  })

  it('custom outcome scorer is used', async () => {
    const traj = makeTrajectory([makeStep('s1', 'run')], false)
    const result = await evalTrajectory(traj, {
      outcomeScorer: () => 0.9,
    })
    expect(result.breakdown.outcomeQuality).toBe(0.9)
  })

  it('tool precision reflects expected tool calls', async () => {
    const traj = makeTrajectory([makeStep('s1', 'search', ['search_web', 'parse'])])
    const perfect = await evalTrajectory(traj, {
      expectedToolCalls: { s1: ['search_web', 'parse'] },
    })
    expect(perfect.breakdown.toolPrecision).toBe(1)

    const partial = await evalTrajectory(traj, {
      expectedToolCalls: { s1: ['search_web', 'parse', 'missing_tool'] },
    })
    expect(partial.breakdown.toolPrecision).toBeLessThan(1)
  })
})

describe('compareTrajectories', () => {
  it('picks better trajectory', async () => {
    const good = makeTrajectory([makeStep('s1', 'fast')], true)
    const bad = makeTrajectory([makeStep('s1', 'slow'), makeStep('s2', 'extra')], false)
    const result = await compareTrajectories(good, bad, { maxSteps: 1 })
    expect(result.better).toBe('a')
    expect(result.scoreA).toBeGreaterThan(result.scoreB)
  })

  it('reports tie when scores are equal', async () => {
    const traj = makeTrajectory([makeStep('s1', 'step')], true)
    const result = await compareTrajectories(traj, { ...traj, id: 'traj2' })
    expect(result.better).toBe('tie')
  })
})
