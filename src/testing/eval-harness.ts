/**
 * Eval Harness — named harnesses with run history, pass-rate tracking, and regression detection.
 * Builds on the existing runEvalSuite / EvalSuite primitives.
 */

import { runEvalSuite } from './evals.js'
import type { EvalSuite, EvalResult, EvalContext } from './evals.js'
import type { MemoryBackend } from '../types/memory.js'

export interface HarnessConfig {
  name: string
  suite: EvalSuite
  /** Minimum pass rate to consider the harness "green". Default 0.8 */
  greenThreshold?: number
  storage?: MemoryBackend
}

export interface HarnessRunRecord {
  runId: string
  timestamp: number
  averageScore: number
  passed: boolean
  results: EvalResult[]
  input: unknown
  output: unknown
}

export interface HarnessReport {
  harnessName: string
  totalRuns: number
  passRate: number
  lastRun?: HarnessRunRecord
  trend: 'improving' | 'stable' | 'degrading'
  regressions: string[]
}

export class EvalHarness {
  private readonly config: HarnessConfig
  private readonly history: HarnessRunRecord[] = []

  constructor(config: HarnessConfig) {
    this.config = config
  }

  async run(
    execFn: () => Promise<{ input: unknown; output: unknown }>,
    context?: EvalContext,
  ): Promise<HarnessRunRecord> {
    const { input, output } = await execFn()
    const suiteResult = await runEvalSuite(this.config.suite, input, output, context)

    const record: HarnessRunRecord = {
      runId: `run_${Date.now().toString(36)}`,
      timestamp: Date.now(),
      averageScore: suiteResult.averageScore,
      passed: suiteResult.passed,
      results: suiteResult.results,
      input,
      output,
    }

    this.history.push(record)

    if (this.config.storage) {
      void this.config.storage.store(
        `harness:${this.config.name}:${record.runId}`,
        JSON.stringify(record),
        { tags: ['harness', this.config.name] },
      )
    }

    return record
  }

  report(): HarnessReport {
    const total = this.history.length
    const passRate = total > 0 ? this.history.filter((r) => r.passed).length / total : 0
    const lastRun = this.history[this.history.length - 1]
    const regressions = lastRun ? this.getRegression(lastRun) : []

    return {
      harnessName: this.config.name,
      totalRuns: total,
      passRate,
      lastRun,
      trend: this.computeTrend(),
      regressions,
    }
  }

  getHistory(): HarnessRunRecord[] {
    return [...this.history]
  }

  checkRegression(current: HarnessRunRecord): boolean {
    return this.getRegression(current).length > 0
  }

  private getRegression(current: HarnessRunRecord): string[] {
    const prev = this.history[this.history.length - 2]
    if (!prev) return []

    const prevByName = new Map(prev.results.map((r) => [r.evalName, r.score]))
    return current.results
      .filter((r) => {
        const prevScore = prevByName.get(r.evalName)
        return prevScore !== undefined && r.score < prevScore - 0.05
      })
      .map((r) => r.evalName)
  }

  private computeTrend(): 'improving' | 'stable' | 'degrading' {
    if (this.history.length < 3) return 'stable'

    const recent = this.history.slice(-3).map((r) => r.averageScore)
    const first = recent[0]!
    const last = recent[recent.length - 1]!
    const delta = last - first

    if (delta > 0.05) return 'improving'
    if (delta < -0.05) return 'degrading'
    return 'stable'
  }
}
