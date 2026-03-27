/**
 * Task — what needs to be done.
 * Typed input/output with budget constraints.
 */

import type { Budget } from './budget.js'
import type { z } from 'zod'

export type TaskDifficulty = 'easy' | 'medium' | 'hard' | 'complex'

export interface Task<TInput = unknown, TOutput = unknown> {
  id: string
  description: string
  input: TInput
  budget: Budget
  deadline?: Date
  difficulty?: TaskDifficulty
  domain?: string[]
  freshness?: 'strict' | 'relaxed' | 'archival'
  outputSchema?: z.ZodSchema<TOutput>
}

export interface TaskScore {
  difficulty: TaskDifficulty
  risk: 'low' | 'medium' | 'high'
  domain: string[]
  freshnessNeed: 'strict' | 'relaxed' | 'archival'
  recommendedMode: 'deep' | 'swarm'
  estimatedAgents: number
  estimatedTokens: number
  modelTier: 'cheap' | 'standard' | 'premium' | 'reasoning'
  factors: TaskFactors
}

export interface TaskFactors {
  inputComplexity: number
  domainSpecificity: number
  reasoningDepth: number
  outputStructure: number
  contextRequired: number
}
