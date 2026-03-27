import { describe, it, expect } from 'vitest'
import { runEval, runEvalSuite, runEvalBatch, nonEmpty, lengthCheck, containsKeywords, schemaMatch, similarityToExpected, noRegression, noHallucination } from '../../src/testing/evals.js'

describe('Evals: Built-in metrics', () => {
  it('nonEmpty: fails on empty', async () => {
    expect((await runEval(nonEmpty(), 'q', '')).score).toBe(0)
    expect((await runEval(nonEmpty(), 'q', null)).score).toBe(0)
    expect((await runEval(nonEmpty(), 'q', 'content')).score).toBe(1)
    expect((await runEval(nonEmpty(), 'q', [])).score).toBe(0)
    expect((await runEval(nonEmpty(), 'q', ['item'])).score).toBe(1)
  })

  it('lengthCheck: scores by length range', async () => {
    const eval_ = lengthCheck(10, 100)
    expect((await runEval(eval_, 'q', 'short')).score).toBeLessThan(1) // Below min
    expect((await runEval(eval_, 'q', 'This is a good length response')).score).toBe(1) // In range
    expect((await runEval(eval_, 'q', 'x'.repeat(200))).score).toBeLessThan(1) // Above max
  })

  it('containsKeywords: partial match scoring', async () => {
    const eval_ = containsKeywords(['typescript', 'generics', 'safety'])
    const result = await runEval(eval_, 'q', 'TypeScript generics are powerful')
    expect(result.score).toBeCloseTo(0.67, 1) // 2/3 keywords found (safety is missing)
  })

  it('schemaMatch: checks required keys', async () => {
    const eval_ = schemaMatch(['name', 'score', 'reason'])
    expect((await runEval(eval_, 'q', { name: 'x', score: 5, reason: 'y' })).score).toBe(1)
    expect((await runEval(eval_, 'q', { name: 'x' })).score).toBeCloseTo(0.33, 1) // 1/3
    expect((await runEval(eval_, 'q', 'not an object')).score).toBe(0)
  })

  it('similarityToExpected: compares to ground truth', async () => {
    const eval_ = similarityToExpected()
    const result = await runEval(eval_, 'q', 'TypeScript is great for large apps', { expected: 'TypeScript is great for large applications' })
    expect(result.score).toBeGreaterThan(0.5)
  })

  it('noHallucination: detects hallucination markers', async () => {
    const eval_ = noHallucination()
    expect((await runEval(eval_, 'q', 'TypeScript generics work by...')).score).toBe(1)
    expect((await runEval(eval_, 'q', "As of my last knowledge cutoff, I don't have access to real-time information about this")).score).toBeLessThan(0.7)
  })

  it('noRegression: passes when no previous', async () => {
    expect((await runEval(noRegression(), 'q', 'output')).score).toBe(1)
  })
})

describe('Evals: Suite runner', () => {
  it('runs suite with threshold', async () => {
    const suite = {
      name: 'quality',
      evals: [nonEmpty(), lengthCheck(5, 1000)],
      threshold: 0.8,
    }

    const pass = await runEvalSuite(suite, 'question', 'A good detailed response here')
    expect(pass.passed).toBe(true)
    expect(pass.averageScore).toBeGreaterThan(0.8)

    const fail = await runEvalSuite(suite, 'question', '')
    expect(fail.passed).toBe(false)
  })

  it('respects perEvalThreshold', async () => {
    const suite = {
      name: 'strict',
      evals: [nonEmpty(), containsKeywords(['required-keyword'])],
      threshold: 0.5,
      perEvalThreshold: 0.9,
    }

    const result = await runEvalSuite(suite, 'q', 'Has content but no required keyword')
    expect(result.failedEvals).toContain('contains-keywords')
  })
})

describe('Evals: Batch runner', () => {
  it('runs suite against multiple test cases', async () => {
    const suite = {
      name: 'batch-test',
      evals: [nonEmpty(), lengthCheck(5, 1000)],
      threshold: 0.7,
    }

    const batch = await runEvalBatch(suite, [
      { input: 'q1', output: 'Good response' },
      { input: 'q2', output: 'Another good one' },
      { input: 'q3', output: '' }, // This one fails
    ])

    expect(batch.suiteResults.length).toBe(3)
    expect(batch.overallPassed).toBe(false) // One failed
    expect(batch.overallScore).toBeGreaterThan(0) // But not zero
  })
})
