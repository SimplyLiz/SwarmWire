/**
 * Hooks — lifecycle hook registry for SwarmWire.
 */

export { HookRegistry } from './registry.js'
export { HookPriority } from './types.js'
export type {
  HookEvent,
  HookFn,
  HookContext,
  HookRegistration,
  HookStats,
} from './types.js'

import type { SwarmEvent } from '../types/pattern.js'
import type { HookEvent } from './types.js'
import { HookRegistry } from './registry.js'

/**
 * Bridges SwarmEvent emissions to the HookRegistry.
 * Returns a handler you can pass as `emitEvent` to any pattern or executePlan.
 */
export function bridgeSwarmEvents(registry: HookRegistry): (event: SwarmEvent) => void {
  const mapping: Partial<Record<SwarmEvent['type'], HookEvent>> = {
    'step:start': 'StepStart',
    'step:complete': 'StepComplete',
    'step:error': 'StepError',
    'plan:created': 'PlanCreated',
    'execution:complete': 'ExecutionComplete',
    'conflict:detected': 'ConflictDetected',
  }

  return (event: SwarmEvent) => {
    const hookEvent = mapping[event.type]
    if (hookEvent) {
      // Fire and forget — bridge is sync
      void registry.emit(hookEvent, event)
    }
  }
}
