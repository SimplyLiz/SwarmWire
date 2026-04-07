/**
 * A/B Testing Engine for Agent Comparison
 * Routes a percentage of traffic to variant agents and compares against baseline
 * Ported from LLMRouter/FrugalRoute
 */

import type { Agent } from '../types/agent.js'

export interface Experiment {
  id: string
  name: string
  /** Which capability this experiment applies to (or "all") */
  capability: string | 'all'
  /** Baseline agent ID (the current production agent) */
  baselineAgentId: string
  /** Variant agent ID (the challenger) */
  variantAgentId: string
  /** Percentage of traffic routed to variant (0-100) */
  variantPercent: number
  /** Whether the experiment is active */
  enabled: boolean
  /** When the experiment was created */
  createdAt: string
  /** Optional end date */
  endsAt?: string
  /** Minimum sample size before results are meaningful */
  minSamples: number
}

export interface ArmMetrics {
  agentId: string
  requests: number
  totalLatencyMs: number
  totalCostCents: number
  totalInputTokens: number
  totalOutputTokens: number
  totalConfidence: number
  evaluatedCount: number
  successCount: number
  failureCount: number
}

export interface ExperimentResults {
  experiment: Experiment
  baseline: ArmMetrics
  variant: ArmMetrics
  significantSamples: boolean
  comparison: {
    latencyDiffMs: number
    costDiffCents: number
    qualityDiffPercent: number
    recommendation: 'variant' | 'baseline' | 'inconclusive'
    reason: string
  }
}

function emptyArm(agentId: string): ArmMetrics {
  return {
    agentId,
    requests: 0,
    totalLatencyMs: 0,
    totalCostCents: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalConfidence: 0,
    evaluatedCount: 0,
    successCount: 0,
    failureCount: 0,
  }
}

export class ABTestingEngine {
  private experiments = new Map<string, Experiment>()
  private baselineMetrics = new Map<string, ArmMetrics>()
  private variantMetrics = new Map<string, ArmMetrics>()

  create(experiment: Experiment): void {
    this.experiments.set(experiment.id, experiment)
    this.baselineMetrics.set(experiment.id, emptyArm(experiment.baselineAgentId))
    this.variantMetrics.set(experiment.id, emptyArm(experiment.variantAgentId))
  }

  get(id: string): Experiment | undefined {
    return this.experiments.get(id)
  }

  list(): Experiment[] {
    return [...this.experiments.values()]
  }

  assign(capability: string): { experimentId: string; arm: 'baseline' | 'variant'; agentId: string } | null {
    for (const exp of this.experiments.values()) {
      if (!exp.enabled) continue
      if (exp.endsAt && new Date(exp.endsAt) < new Date()) continue
      if (exp.capability !== 'all' && exp.capability !== capability) continue

      const arm = Math.random() * 100 < exp.variantPercent ? 'variant' : 'baseline'
      const agentId = arm === 'variant' ? exp.variantAgentId : exp.baselineAgentId

      return { experimentId: exp.id, arm, agentId }
    }

    return null
  }

  record(
    experimentId: string,
    arm: 'baseline' | 'variant',
    metrics: {
      latencyMs: number
      costCents: number
      inputTokens: number
      outputTokens: number
      confidence?: number
      success?: boolean
    },
  ): void {
    const metricsMap = arm === 'baseline' ? this.baselineMetrics : this.variantMetrics
    const armMetrics = metricsMap.get(experimentId)
    if (!armMetrics) return

    armMetrics.requests++
    armMetrics.totalLatencyMs += metrics.latencyMs
    armMetrics.totalCostCents += metrics.costCents
    armMetrics.totalInputTokens += metrics.inputTokens
    armMetrics.totalOutputTokens += metrics.outputTokens

    if (metrics.confidence != null) {
      armMetrics.totalConfidence += metrics.confidence
      armMetrics.evaluatedCount++
      if (metrics.success) {
        armMetrics.successCount++
      } else {
        armMetrics.failureCount++
      }
    }
  }

  getResults(experimentId: string): ExperimentResults | null {
    const experiment = this.experiments.get(experimentId)
    if (!experiment) return null

    const baseline = this.baselineMetrics.get(experimentId)
    const variant = this.variantMetrics.get(experimentId)
    if (!baseline || !variant) return null

    const significantSamples = baseline.requests >= experiment.minSamples && variant.requests >= experiment.minSamples
    const comparison = this.compareArms(baseline, variant, significantSamples)

    return { experiment, baseline, variant, significantSamples, comparison }
  }

  stop(experimentId: string): boolean {
    const exp = this.experiments.get(experimentId)
    if (!exp) return false
    exp.enabled = false
    return true
  }

  delete(experimentId: string): boolean {
    this.baselineMetrics.delete(experimentId)
    this.variantMetrics.delete(experimentId)
    return this.experiments.delete(experimentId)
  }

  private compareArms(
    baseline: ArmMetrics,
    variant: ArmMetrics,
    significant: boolean,
  ): ExperimentResults['comparison'] {
    if (!significant || baseline.requests === 0 || variant.requests === 0) {
      return {
        latencyDiffMs: 0,
        costDiffCents: 0,
        qualityDiffPercent: 0,
        recommendation: 'inconclusive',
        reason: 'Insufficient samples for comparison',
      }
    }

    const baselineAvgLatency = baseline.totalLatencyMs / baseline.requests
    const variantAvgLatency = variant.totalLatencyMs / variant.requests
    const latencyDiffMs = variantAvgLatency - baselineAvgLatency

    const baselineAvgCost = baseline.totalCostCents / baseline.requests
    const variantAvgCost = variant.totalCostCents / variant.requests
    const costDiffCents = variantAvgCost - baselineAvgCost

    const baselineQuality = baseline.evaluatedCount > 0 ? baseline.successCount / baseline.evaluatedCount : 0
    const variantQuality = variant.evaluatedCount > 0 ? variant.successCount / variant.evaluatedCount : 0
    const qualityDiffPercent = (variantQuality - baselineQuality) * 100

    let recommendation: 'variant' | 'baseline' | 'inconclusive'
    let reason: string

    if (qualityDiffPercent >= -5 && costDiffCents < -0.01) {
      recommendation = 'variant'
      reason = `Variant is cheaper (${costDiffCents.toFixed(2)}c/req) with comparable quality (${qualityDiffPercent > 0 ? '+' : ''}${qualityDiffPercent.toFixed(1)}%)`
    } else if (qualityDiffPercent > 5) {
      recommendation = 'variant'
      reason = `Variant has better quality (+${qualityDiffPercent.toFixed(1)}%)`
    } else if (qualityDiffPercent < -5) {
      recommendation = 'baseline'
      reason = `Baseline has better quality (variant is ${qualityDiffPercent.toFixed(1)}%)`
    } else if (costDiffCents > 0.01) {
      recommendation = 'baseline'
      reason = `Baseline is cheaper (variant costs +${costDiffCents.toFixed(2)}c/req)`
    } else {
      recommendation = 'inconclusive'
      reason = 'No significant difference between arms'
    }

    return { latencyDiffMs, costDiffCents, qualityDiffPercent, recommendation, reason }
  }
}

export function createExperiment(config: {
  name: string
  capability: string | 'all'
  baselineAgentId: string
  variantAgentId: string
  variantPercent?: number
  minSamples?: number
  endsAt?: string
}): Experiment {
  return {
    id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: config.name,
    capability: config.capability,
    baselineAgentId: config.baselineAgentId,
    variantAgentId: config.variantAgentId,
    variantPercent: config.variantPercent ?? 10,
    enabled: true,
    createdAt: new Date().toISOString(),
    endsAt: config.endsAt,
    minSamples: config.minSamples ?? 30,
  }
}