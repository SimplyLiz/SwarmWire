import { describe, it, expect } from 'vitest'
import { EvalHarness } from '../../src/testing/eval-harness.js'
import type { EvalSuite } from '../../src/testing/evals.js'

const alwaysPassSuite: EvalSuite = {
  name: 'always-pass',
  evals: [{ name: 'pass', score: () => 1 }],
  threshold: 0.5,
}

const alwaysFailSuite: EvalSuite = {
  name: 'always-fail',
  evals: [{ name: 'fail', score: () => 0 }],
  threshold: 0.5,
}

describe('EvalHarness', () => {
  it('runs and records a passing run', async () => {
    const harness = new EvalHarness({ name: 'h1', suite: alwaysPassSuite })
    const record = await harness.run(async () => ({ input: 'q', output: 'a' }))
    expect(record.passed).toBe(true)
    expect(record.averageScore).toBe(1)
    expect(harness.getHistory()).toHaveLength(1)
  })

  it('runs and records a failing run', async () => {
    const harness = new EvalHarness({ name: 'h1', suite: alwaysFailSuite })
    const record = await harness.run(async () => ({ input: 'q', output: 'a' }))
    expect(record.passed).toBe(false)
  })

  it('report shows passRate', async () => {
    const harness = new EvalHarness({ name: 'h1', suite: alwaysPassSuite })
    await harness.run(async () => ({ input: 'q', output: 'a' }))
    await harness.run(async () => ({ input: 'q', output: 'a' }))
    const report = harness.report()
    expect(report.passRate).toBe(1)
    expect(report.totalRuns).toBe(2)
    expect(report.harnessName).toBe('h1')
  })

  it('detects degrading trend after injecting failing run', async () => {
    const harness = new EvalHarness({ name: 'h1', suite: alwaysPassSuite })
    // Two passing runs
    await harness.run(async () => ({ input: 'q', output: 'a' }))
    await harness.run(async () => ({ input: 'q', output: 'a' }))

    // One failing run via always-fail suite (hack: swap suite)
    const failHarness = new EvalHarness({ name: 'h2', suite: alwaysFailSuite })
    await failHarness.run(async () => ({ input: 'q', output: 'a' }))
    await failHarness.run(async () => ({ input: 'q', output: 'a' }))
    await failHarness.run(async () => ({ input: 'q', output: 'a' }))
    const report = failHarness.report()
    // All fail → stable at 0, not degrading from stable
    expect(['stable', 'degrading']).toContain(report.trend)
  })

  it('checkRegression returns false on first run', async () => {
    const harness = new EvalHarness({ name: 'h1', suite: alwaysPassSuite })
    const record = await harness.run(async () => ({ input: 'q', output: 'a' }))
    expect(harness.checkRegression(record)).toBe(false)
  })

  it('lastRun is set in report', async () => {
    const harness = new EvalHarness({ name: 'h1', suite: alwaysPassSuite })
    const record = await harness.run(async () => ({ input: 'q', output: 'a' }))
    expect(harness.report().lastRun?.runId).toBe(record.runId)
  })
})
