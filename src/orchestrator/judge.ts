/**
 * Judge Agent for Quality Evaluation
 * Evaluates agent outputs for quality and determines if cloud correction is needed
 * Ported from LLMRouter/FrugalRoute
 */

import type { Agent, AgentOutput } from '../types/agent.js'
import type { ExecutionResult } from '../types/execution.js'

export interface JudgeConfig {
  evaluateCapabilities: string[]
  skipCapabilities: string[]
  highConfidence: number
  lowConfidence: number
}

export const DEFAULT_JUDGE_CONFIG: JudgeConfig = {
  evaluateCapabilities: ['reasoning', 'coding', 'summarization'],
  skipCapabilities: ['formatting', 'extraction', 'classification'],
  highConfidence: 0.9,
  lowConfidence: 0.5,
}

export interface JudgeVerdict {
  confidence: number
  epistemicState: 'SUPPORTED' | 'HYPOTHESIS' | 'CONTESTED'
  needsCorrection: boolean
  reason: string
}

export class JudgeAgent {
  private config: JudgeConfig
  private judgeModel?: Agent

  constructor(judgeModel?: Agent, config: JudgeConfig = DEFAULT_JUDGE_CONFIG) {
    this.judgeModel = judgeModel
    this.config = config
  }

  shouldEvaluate(capability?: string): boolean {
    if (!capability) return false
    if (this.config.skipCapabilities.includes(capability)) return false
    return this.config.evaluateCapabilities.includes(capability)
  }

  async evaluate(
    output: AgentOutput,
    originalPrompt: string,
    capability?: string,
  ): Promise<JudgeVerdict> {
    const confidence = this.scoreStructuralConfidence(output, capability)

    if (
      this.judgeModel &&
      confidence > this.config.lowConfidence &&
      confidence < this.config.highConfidence
    ) {
      const llmScore = await this.runLlmEvaluation(output, originalPrompt)
      if (llmScore !== null) {
        return {
          confidence: confidence * 0.4 + llmScore * 0.6,
          epistemicState: this.mapToEpistemicState(confidence),
          needsCorrection: confidence < this.config.lowConfidence,
          reason: `Blended confidence (structural: ${(confidence * 0.4).toFixed(2)}, LLM: ${(llmScore * 0.6).toFixed(2)})`,
        }
      }
    }

    let reason: string
    if (confidence >= this.config.highConfidence) {
      reason = 'High confidence — auto-accepted'
    } else if (confidence >= this.config.lowConfidence) {
      reason = `Moderate confidence (${confidence.toFixed(2)}) — saved as hypothesis for verification`
    } else {
      reason = `Low confidence (${confidence.toFixed(2)}) — needs correction`
    }

    return {
      confidence,
      epistemicState: this.mapToEpistemicState(confidence),
      needsCorrection: confidence < this.config.lowConfidence,
      reason,
    }
  }

  private scoreStructuralConfidence(output: AgentOutput, capability?: string, promptLength = 0): number {
    let score = 0.5

    if (output.status === 'completed') {
      score += 0.2
    } else if (output.status === 'skipped') {
      score -= 0.1
    }

    if (output.error) {
      score -= 0.3
    }

    const outputStr = typeof output.output === 'string' ? output.output : JSON.stringify(output.output)
    if (outputStr && outputStr.length > 0) {
      score += 0.1

      const hasErrors = /error|exception|failed|undefined|null/i.test(outputStr)
      const hasSuspicious = /I don't know|I cannot|I'm not sure/i.test(outputStr)
      
      if (hasErrors) score -= 0.15
      if (hasSuspicious) score -= 0.1
    }

    if (capability === 'coding') {
      const hasCode = /function|const|let|var|class|import|export|return/.test(outputStr)
      if (hasCode) score += 0.1
    }

    if (capability === 'summarization') {
      if (outputStr.length > 50 && promptLength > 0 && outputStr.length < promptLength * 0.8) {
        score += 0.1
      }
    }

    return Math.max(0, Math.min(1, score))
  }

  private mapToEpistemicState(confidence: number): 'SUPPORTED' | 'HYPOTHESIS' | 'CONTESTED' {
    if (confidence >= this.config.highConfidence) return 'SUPPORTED'
    if (confidence >= this.config.lowConfidence) return 'HYPOTHESIS'
    return 'CONTESTED'
  }

  private async runLlmEvaluation(output: AgentOutput, originalPrompt: string): Promise<number | null> {
    if (!this.judgeModel) return null

    try {
      const result = await (this.judgeModel.execute as any)(
        `Rate the following response on a scale of 0 to 10 for accuracy, completeness, and helpfulness. Reply with only a number.\n\nOriginal prompt: ${originalPrompt}\n\nResponse to evaluate: ${typeof output.output === 'string' ? output.output : JSON.stringify(output.output)}`,
        {
          executionId: `judge_${Date.now()}`,
          budgetRemaining: { maxCostCents: 1 },
          llm: async () => '5',
          tool: async (_name: string, _input: unknown): Promise<unknown> => null,
          trace: () => {},
          getStepOutput: () => undefined,
          board: {
            post: () => {},
            read: () => [],
            inbox: () => [],
            findings: () => [],
            warnings: () => [],
            reply: () => {},
          },
        }
      )

      const score = Number.parseFloat(String(result).trim())
      if (!Number.isNaN(score) && score >= 0 && score <= 10) {
        return score / 10
      }
    } catch {
      // Fall back to structural only
    }

    return null
  }
}

/**
 * Evaluate an entire execution result
 */
export async function evaluateExecution(
  result: ExecutionResult,
  judge: JudgeAgent,
  capability?: string,
): Promise<{
  overallConfidence: number
  verdicts: Map<string, JudgeVerdict>
  needsCorrection: boolean
}> {
  const verdicts = new Map<string, JudgeVerdict>()
  let totalConfidence = 0
  let evaluated = 0

  for (const output of result.allResults) {
    if (judge.shouldEvaluate(capability)) {
      const verdict = await judge.evaluate(output, '', capability)
      verdicts.set(output.agentId, verdict)
      totalConfidence += verdict.confidence
      evaluated++
    }
  }

  const overallConfidence = evaluated > 0 ? totalConfidence / evaluated : 0.5

  return {
    overallConfidence,
    verdicts,
    needsCorrection: overallConfidence < DEFAULT_JUDGE_CONFIG.lowConfidence,
  }
}