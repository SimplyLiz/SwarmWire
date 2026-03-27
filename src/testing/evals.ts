/**
 * Evals Framework — automated quality metrics for agent outputs.
 *
 * Run against Record/Replay fixtures for CI/CD.
 * Eval suites with pass/fail thresholds.
 *
 * Integrates with vitest/jest: run evals as test cases.
 */

export interface Eval<TInput = unknown, TOutput = unknown> {
  name: string
  description?: string
  /** The metric function. Returns 0-1 score. */
  score(input: TInput, output: TOutput, context?: EvalContext): Promise<number> | number
}

export interface EvalContext {
  /** Expected output for comparison (ground truth) */
  expected?: unknown
  /** Previous output from a prior run (for regression testing) */
  previous?: unknown
  /** Agent name that produced the output */
  agentName?: string
  /** Execution metadata */
  metadata?: Record<string, unknown>
}

export interface EvalSuite<TInput = unknown, TOutput = unknown> {
  name: string
  evals: Eval<TInput, TOutput>[]
  /** Minimum average score to pass. Default 0.7 */
  threshold?: number
  /** Minimum score per individual eval. Default: no per-eval minimum */
  perEvalThreshold?: number
}

export interface EvalResult {
  evalName: string
  score: number
  passed: boolean
  details?: string
}

export interface SuiteResult {
  suiteName: string
  averageScore: number
  passed: boolean
  results: EvalResult[]
  failedEvals: string[]
  duration: number
}

/**
 * Run a single eval against an input/output pair.
 */
export async function runEval<TInput, TOutput>(
  eval_: Eval<TInput, TOutput>,
  input: TInput,
  output: TOutput,
  context?: EvalContext,
  threshold = 0.7,
): Promise<EvalResult> {
  const score = await eval_.score(input, output, context)
  return {
    evalName: eval_.name,
    score,
    passed: score >= threshold,
  }
}

/**
 * Run an eval suite against an input/output pair.
 */
export async function runEvalSuite<TInput, TOutput>(
  suite: EvalSuite<TInput, TOutput>,
  input: TInput,
  output: TOutput,
  context?: EvalContext,
): Promise<SuiteResult> {
  const threshold = suite.threshold ?? 0.7
  const perThreshold = suite.perEvalThreshold
  const start = performance.now()

  const results: EvalResult[] = []
  for (const eval_ of suite.evals) {
    const result = await runEval(eval_, input, output, context, perThreshold ?? 0)
    results.push(result)
  }

  const averageScore = results.length > 0
    ? results.reduce((s, r) => s + r.score, 0) / results.length
    : 0

  const failedEvals = perThreshold
    ? results.filter((r) => r.score < perThreshold).map((r) => r.evalName)
    : []

  return {
    suiteName: suite.name,
    averageScore,
    passed: averageScore >= threshold && failedEvals.length === 0,
    results,
    failedEvals,
    duration: performance.now() - start,
  }
}

/**
 * Run an eval suite against multiple test cases.
 */
export async function runEvalBatch<TInput, TOutput>(
  suite: EvalSuite<TInput, TOutput>,
  cases: Array<{ input: TInput; output: TOutput; expected?: unknown }>,
): Promise<{ suiteResults: SuiteResult[]; overallScore: number; overallPassed: boolean }> {
  const suiteResults: SuiteResult[] = []

  for (const testCase of cases) {
    const result = await runEvalSuite(suite, testCase.input, testCase.output, { expected: testCase.expected })
    suiteResults.push(result)
  }

  const overallScore = suiteResults.length > 0
    ? suiteResults.reduce((s, r) => s + r.averageScore, 0) / suiteResults.length
    : 0

  return {
    suiteResults,
    overallScore,
    overallPassed: suiteResults.every((r) => r.passed),
  }
}

// ─── Built-in Evals ───

/** Checks that output is not empty/null/undefined */
export function nonEmpty(): Eval {
  return {
    name: 'non-empty',
    score(_input, output) {
      if (output === null || output === undefined) return 0
      if (typeof output === 'string' && output.trim().length === 0) return 0
      if (Array.isArray(output) && output.length === 0) return 0
      return 1
    },
  }
}

/** Checks output length is within expected range */
export function lengthCheck(minChars = 10, maxChars = 50000): Eval<unknown, string> {
  return {
    name: 'length-check',
    score(_input, output) {
      if (typeof output !== 'string') return 0
      if (output.length < minChars) return output.length / minChars
      if (output.length > maxChars) return maxChars / output.length
      return 1
    },
  }
}

/** Checks if output contains expected keywords */
export function containsKeywords(keywords: string[]): Eval<unknown, string> {
  return {
    name: 'contains-keywords',
    score(_input, output) {
      if (typeof output !== 'string') return 0
      const lower = output.toLowerCase()
      const found = keywords.filter((kw) => lower.includes(kw.toLowerCase()))
      return keywords.length > 0 ? found.length / keywords.length : 1
    },
  }
}

/** Checks if JSON output matches expected schema structure */
export function schemaMatch(requiredKeys: string[]): Eval<unknown, unknown> {
  return {
    name: 'schema-match',
    score(_input, output) {
      if (typeof output !== 'object' || output === null) return 0
      const keys = Object.keys(output)
      const found = requiredKeys.filter((k) => keys.includes(k))
      return requiredKeys.length > 0 ? found.length / requiredKeys.length : 1
    },
  }
}

/** Compares output to expected (ground truth) using string similarity */
export function similarityToExpected(threshold = 0.7): Eval {
  return {
    name: 'similarity-to-expected',
    score(_input, output, context) {
      if (!context?.expected) return 0.5 // No expected = neutral
      const outStr = typeof output === 'string' ? output : JSON.stringify(output)
      const expStr = typeof context.expected === 'string' ? context.expected : JSON.stringify(context.expected)
      return jaccardSimilarity(outStr, expStr)
    },
  }
}

/** Regression check — output should be at least as good as previous run */
export function noRegression(): Eval {
  return {
    name: 'no-regression',
    score(_input, output, context) {
      if (!context?.previous) return 1 // No previous = pass
      const outStr = typeof output === 'string' ? output : JSON.stringify(output)
      const prevStr = typeof context.previous === 'string' ? context.previous : JSON.stringify(context.previous)
      // If output is at least as long and shares significant content, it's not a regression
      const sim = jaccardSimilarity(outStr, prevStr)
      const lengthRatio = outStr.length / Math.max(1, prevStr.length)
      return Math.min(1, sim * 0.7 + Math.min(1, lengthRatio) * 0.3)
    },
  }
}

/** Checks for common hallucination patterns */
export function noHallucination(): Eval<unknown, string> {
  return {
    name: 'no-hallucination',
    score(_input, output) {
      if (typeof output !== 'string') return 0.5
      const markers = [
        /as of my (?:last )?(?:knowledge )?(?:cutoff|training)/i,
        /I (?:don't|do not) have (?:access|information)/i,
        /I cannot (?:verify|confirm|access)/i,
        /(?:hypothetically|in theory)\b/i,
        /I (?:believe|think|assume) (?:this|that) (?:might|could|may)\b/i,
      ]
      const hits = markers.filter((m) => m.test(output))
      return Math.max(0, 1 - hits.length * 0.25)
    },
  }
}

function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))
  if (wordsA.size === 0 && wordsB.size === 0) return 1
  let intersection = 0
  for (const w of wordsA) if (wordsB.has(w)) intersection++
  const union = wordsA.size + wordsB.size - intersection
  return union === 0 ? 0 : intersection / union
}
