/**
 * Hook system types — lifecycle hooks for SwarmWire execution events.
 */

export type HookEvent =
  | 'PreToolCall'
  | 'PostToolCall'
  | 'PreEdit'
  | 'PostEdit'
  | 'PreRead'
  | 'PostRead'
  | 'PreCommand'
  | 'PostCommand'
  | 'PreTask'
  | 'PostTask'
  | 'SessionStart'
  | 'SessionEnd'
  | 'AgentSpawn'
  | 'AgentTerminate'
  | 'StepStart'
  | 'StepComplete'
  | 'StepError'
  | 'PlanCreated'
  | 'ExecutionStart'
  | 'ExecutionComplete'
  | 'MemoryStore'
  | 'MemoryQuery'
  | 'LlmCall'
  | 'LlmResponse'
  | 'ToolRegister'
  | 'ConflictDetected'
  | 'ConsensusReached'

export const HookPriority = {
  Critical: 1000,
  High: 100,
  Normal: 50,
  Low: 10,
  Background: 1,
} as const

export type HookPriority = typeof HookPriority[keyof typeof HookPriority]

export interface HookContext {
  event: HookEvent
  payload: unknown
  timestamp: number
  executionId?: string
  stepId?: string
  agentName?: string
}

export type HookFn = (ctx: HookContext) => void | Promise<void>

export interface HookRegistration {
  id: string
  event: HookEvent
  handler: HookFn
  priority: number
  silent?: boolean
}

export interface HookStats {
  event: HookEvent
  callCount: number
  totalDurationMs: number
  avgDurationMs: number
  errorCount: number
}
