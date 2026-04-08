/**
 * HookRegistry — manages lifecycle hooks and emits events sequentially by priority.
 */

import type { HookEvent, HookFn, HookRegistration, HookStats, HookContext } from './types.js'
import { HookPriority } from './types.js'

let idCounter = 0
function nextId(): string {
  return `hook_${++idCounter}_${Date.now().toString(36)}`
}

export class HookRegistry {
  private handlers: Map<HookEvent, HookRegistration[]> = new Map()
  private stats: Map<HookEvent, HookStats> = new Map()
  private suppressErrors: boolean

  constructor(config: Partial<{ suppressErrors: boolean }> = {}) {
    this.suppressErrors = config.suppressErrors ?? false
  }

  register(
    event: HookEvent,
    handler: HookFn,
    priority: number = HookPriority.Normal,
    silent?: boolean,
  ): string {
    const id = nextId()
    const registration: HookRegistration = { id, event, handler, priority, silent }

    const existing = this.handlers.get(event) ?? []
    // Insert in priority-descending order
    let insertIdx = existing.length
    for (let i = 0; i < existing.length; i++) {
      if ((existing[i]!.priority) < priority) {
        insertIdx = i
        break
      }
    }
    existing.splice(insertIdx, 0, registration)
    this.handlers.set(event, existing)

    return id
  }

  unregister(id: string): boolean {
    for (const [event, regs] of this.handlers.entries()) {
      const idx = regs.findIndex((r) => r.id === id)
      if (idx !== -1) {
        regs.splice(idx, 1)
        this.handlers.set(event, regs)
        return true
      }
    }
    return false
  }

  async emit(
    event: HookEvent,
    payload: unknown,
    meta?: Pick<HookContext, 'executionId' | 'stepId' | 'agentName'>,
  ): Promise<void> {
    const regs = this.handlers.get(event) ?? []

    const ctx: HookContext = {
      event,
      payload,
      timestamp: Date.now(),
      ...meta,
    }

    // Ensure stats entry exists
    if (!this.stats.has(event)) {
      this.stats.set(event, {
        event,
        callCount: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
        errorCount: 0,
      })
    }
    const stat = this.stats.get(event)!

    for (const reg of regs) {
      const start = Date.now()
      try {
        await reg.handler(ctx)
        const dur = Date.now() - start
        stat.callCount++
        stat.totalDurationMs += dur
        stat.avgDurationMs = stat.totalDurationMs / stat.callCount
      } catch (err) {
        stat.errorCount++
        const dur = Date.now() - start
        stat.totalDurationMs += dur
        stat.callCount++
        stat.avgDurationMs = stat.totalDurationMs / stat.callCount

        if (!reg.silent && !this.suppressErrors) {
          throw err
        }
        // silent or suppressErrors — swallow
      }
    }
  }

  getStats(): HookStats[] {
    return Array.from(this.stats.values())
  }

  listHandlers(event: HookEvent): HookRegistration[] {
    return this.handlers.get(event) ?? []
  }

  clear(event?: HookEvent): void {
    if (event !== undefined) {
      this.handlers.delete(event)
    } else {
      this.handlers.clear()
    }
  }
}
