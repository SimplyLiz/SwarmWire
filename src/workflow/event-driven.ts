/**
 * Event-Driven Workflows — runtime-emergent topology.
 * Steps subscribe to typed events rather than a fixed DAG.
 */

export interface FlowEvent {
  type: string
  payload: unknown
  sourceStep?: string
  timestamp: number
}

export interface FlowContext {
  sessionId?: string
  emit(type: string, payload: unknown): void
  getHistory(): FlowEvent[]
  metadata: Record<string, unknown>
}

export type FlowStepHandler = (
  event: FlowEvent,
  ctx: FlowContext,
) => Promise<FlowEvent | FlowEvent[] | null>

export interface FlowStepDef {
  name: string
  handles: string[]
  handler: FlowStepHandler
  concurrent?: boolean
}

export interface EventFlowConfig {
  steps: FlowStepDef[]
  /** Max events before stopping. Default 1000 */
  maxEvents?: number
  /** Max concurrent step executions. Default 5 */
  maxConcurrent?: number
}

export interface EventFlowResult {
  processed: number
  history: FlowEvent[]
  errors: Error[]
}

export class EventFlow {
  private readonly steps: FlowStepDef[]
  private readonly maxEvents: number
  private readonly maxConcurrent: number
  private readonly externalHandlers: Map<string, Array<(event: FlowEvent) => void>> = new Map()

  constructor(config: EventFlowConfig) {
    this.steps = [...config.steps]
    this.maxEvents = config.maxEvents ?? 1000
    this.maxConcurrent = config.maxConcurrent ?? 5
  }

  addStep(step: FlowStepDef): void {
    this.steps.push(step)
  }

  on(eventType: string, handler: (event: FlowEvent) => void): void {
    const list = this.externalHandlers.get(eventType) ?? []
    list.push(handler)
    this.externalHandlers.set(eventType, list)
  }

  async run(initialEvents: FlowEvent[]): Promise<EventFlowResult> {
    const queue: FlowEvent[] = [...initialEvents]
    const history: FlowEvent[] = []
    const errors: Error[] = []
    let processed = 0
    let running = 0

    const emit = (type: string, payload: unknown, sourceStep?: string): void => {
      queue.push({ type, payload, sourceStep, timestamp: Date.now() })
    }

    while (queue.length > 0 && processed < this.maxEvents) {
      const event = queue.shift()!
      history.push(event)
      processed++

      // Notify external subscribers
      for (const handler of this.externalHandlers.get(event.type) ?? []) {
        try { handler(event) } catch { /* ignore */ }
      }

      // Find matching steps
      const matching = this.steps.filter((s) => s.handles.includes(event.type))
      if (matching.length === 0) continue

      const ctx: FlowContext = {
        emit: (type, payload) => emit(type, payload, undefined),
        getHistory: () => [...history],
        metadata: {},
      }

      // Execute concurrent steps up to limit
      const toRun = matching.slice(0, Math.max(1, this.maxConcurrent - running))
      const promises = toRun.map(async (step) => {
        running++
        try {
          const result = await step.handler(event, ctx)
          if (result) {
            const resultEvents = Array.isArray(result) ? result : [result]
            for (const e of resultEvents) {
              queue.push({ ...e, sourceStep: step.name, timestamp: e.timestamp ?? Date.now() })
            }
          }
        } catch (err) {
          errors.push(err instanceof Error ? err : new Error(String(err)))
        } finally {
          running--
        }
      })

      await Promise.all(promises)
    }

    return { processed, history, errors }
  }
}
