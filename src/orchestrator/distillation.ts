/**
 * Distillation Collector for Training Pairs
 * Collects successful agent executions and failures for model improvement
 * Ported from LLMRouter/FrugalRoute
 */

import type { AgentOutput } from '../types/agent.js'
import type { ExecutionResult } from '../types/execution.js'

export interface TrainingPair {
  id: string
  prompt: string
  response: string
  agentId: string
  capability: string
  qualityScore: number
  collectedAt: number
  epistemicState: 'SUPPORTED' | 'HYPOTHESIS' | 'CONTESTED'
}

export interface CorrectionPair {
  id: string
  prompt: string
  localResponse: string
  cloudResponse: string
  localAgentId: string
  cloudAgentId: string
  capability: string
  failureType: 'hallucination' | 'format' | 'reasoning' | 'knowledge'
  collectedAt: number
  epistemicState: 'SUPPORTED' | 'HYPOTHESIS' | 'CONTESTED'
}

export class DistillationCollector {
  private trainingPairs = new Map<string, TrainingPair>()
  private correctionPairs = new Map<string, CorrectionPair>()

  collectTrainingPair(
    prompt: string,
    output: AgentOutput,
    agentId: string,
    capability: string,
    qualityScore: number,
    epistemicState: 'SUPPORTED' | 'HYPOTHESIS' | 'CONTESTED' = 'HYPOTHESIS'
  ): string {
    const id = `pair_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    
    const pair: TrainingPair = {
      id,
      prompt,
      response: typeof output.output === 'string' ? output.output : JSON.stringify(output.output),
      agentId,
      capability,
      qualityScore,
      collectedAt: Date.now(),
      epistemicState,
    }

    this.trainingPairs.set(id, pair)
    return id
  }

  collectCorrectionPair(
    prompt: string,
    localOutput: AgentOutput,
    cloudOutput: AgentOutput,
    localAgentId: string,
    cloudAgentId: string,
    capability: string,
    failureType: 'hallucination' | 'format' | 'reasoning' | 'knowledge',
    epistemicState: 'SUPPORTED' | 'HYPOTHESIS' | 'CONTESTED' = 'HYPOTHESIS'
  ): string {
    const id = `correction_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    
    const pair: CorrectionPair = {
      id,
      prompt,
      localResponse: typeof localOutput.output === 'string' ? localOutput.output : JSON.stringify(localOutput.output),
      cloudResponse: typeof cloudOutput.output === 'string' ? cloudOutput.output : JSON.stringify(cloudOutput.output),
      localAgentId,
      cloudAgentId,
      capability,
      failureType,
      collectedAt: Date.now(),
      epistemicState,
    }

    this.correctionPairs.set(id, pair)
    return id
  }

  getTrainingPairs(state?: 'SUPPORTED' | 'HYPOTHESIS' | 'CONTESTED'): TrainingPair[] {
    if (!state) return [...this.trainingPairs.values()]
    return [...this.trainingPairs.values()].filter(p => p.epistemicState === state)
  }

  getCorrectionPairs(): CorrectionPair[] {
    return [...this.correctionPairs.values()]
  }

  getPairsForDistillation(): Array<{ prompt: string; response: string; quality: number }> {
    const pairs: Array<{ prompt: string; response: string; quality: number }> = []

    for (const pair of this.trainingPairs.values()) {
      if (pair.epistemicState === 'SUPPORTED' || pair.epistemicState === 'HYPOTHESIS') {
        pairs.push({
          prompt: pair.prompt,
          response: pair.response,
          quality: pair.qualityScore,
        })
      }
    }

    return pairs
  }

  getCorrectionPairsForDistillation(): Array<{
    prompt: string
    input: string
    output: string
    failureType: string
  }> {
    return [...this.correctionPairs.values()].map(p => ({
    prompt: p.prompt,
    input: p.localResponse,
    output: p.cloudResponse,
    failureType: p.failureType,
  }))
  }

  promoteToSupported(pairId: string): boolean {
    const pair = this.trainingPairs.get(pairId)
    if (!pair) return false
    pair.epistemicState = 'SUPPORTED'
    return true
  }

  invalidate(pairId: string): boolean {
    return this.trainingPairs.delete(pairId)
  }

  getStats() {
    const supported = [...this.trainingPairs.values()].filter(p => p.epistemicState === 'SUPPORTED').length
    const hypothesis = [...this.trainingPairs.values()].filter(p => p.epistemicState === 'HYPOTHESIS').length
    const contested = [...this.trainingPairs.values()].filter(p => p.epistemicState === 'CONTESTED').length

    return {
      trainingPairs: this.trainingPairs.size,
      correctionPairs: this.correctionPairs.size,
      supported,
      hypothesis,
      contested,
    }
  }

  clear(): void {
    this.trainingPairs.clear()
    this.correctionPairs.clear()
  }
}

/**
 * Collect from execution result
 */
export function collectFromExecution(
  collector: DistillationCollector,
  result: ExecutionResult,
  agentId: string,
  capability: string
): void {
  for (const output of result.agentOutputs) {
    if (output.status === 'completed' && !output.error) {
      collector.collectTrainingPair(
        typeof result.plan.task.input === 'string' ? result.plan.task.input : JSON.stringify(result.plan.task.input),
        output,
        agentId,
        capability,
        result.confidence,
        result.confidence >= 0.9 ? 'SUPPORTED' : result.confidence >= 0.5 ? 'HYPOTHESIS' : 'CONTESTED'
      )
    }
  }
}