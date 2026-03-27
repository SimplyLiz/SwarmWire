/**
 * SSE Transport — stream SwarmWire events to HTTP clients via Server-Sent Events.
 *
 * Bridges swarm.stream() AsyncGenerator to standard SSE format.
 * Works with any Node.js HTTP framework (Express, Fastify, native http).
 */

import type { ServerResponse } from 'node:http'
import type { SwarmEvent } from '../types/pattern.js'

/**
 * Write SSE headers to a response. Call this before piping events.
 */
export function sseHeaders(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  })
}

/**
 * Send a single SSE event.
 */
export function sseEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/**
 * Pipe a swarm.stream() AsyncGenerator to an SSE response.
 *
 * Usage with native http:
 *   const server = http.createServer(async (req, res) => {
 *     sseHeaders(res)
 *     const result = await pipeToSSE(swarm.stream(task), res)
 *     sseEvent(res, 'done', { output: result.output, cost: result.cost })
 *     res.end()
 *   })
 */
export async function pipeToSSE<T>(
  stream: AsyncGenerator<SwarmEvent, import('../types/execution.js').ExecutionResult<T>, undefined>,
  res: ServerResponse,
  options?: PipeOptions,
): Promise<import('../types/execution.js').ExecutionResult<T>> {
  const heartbeatMs = options?.heartbeatMs ?? 15_000
  const includeTrace = options?.includeTrace ?? false

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n')
  }, heartbeatMs)

  try {
    let result: import('../types/execution.js').ExecutionResult<T> | undefined

    while (true) {
      const { value, done } = await stream.next()

      if (done) {
        result = value as import('../types/execution.js').ExecutionResult<T>
        break
      }

      const event = value as SwarmEvent

      // Map SwarmEvent types to SSE event names
      sseEvent(res, event.type, formatEvent(event, includeTrace))
    }

    // Send final result
    if (result) {
      sseEvent(res, 'result', {
        output: result.output,
        confidence: result.confidence,
        partial: result.partial,
        cost: {
          totalCostCents: result.cost.totalCostCents,
          totalTokens: result.cost.totalTokens,
          totalLatencyMs: result.cost.totalLatencyMs,
          budgetUsed: result.cost.budgetUsed,
        },
        agentCount: result.agentOutputs.length,
        messageCount: result.messages.length,
      })
    }

    return result!
  } finally {
    clearInterval(heartbeat)
  }
}

export interface PipeOptions {
  /** Heartbeat interval to keep connection alive (ms). Default 15000 */
  heartbeatMs?: number
  /** Include full trace data in events. Default false (reduces bandwidth) */
  includeTrace?: boolean
}

function formatEvent(event: SwarmEvent, includeTrace: boolean): Record<string, unknown> {
  switch (event.type) {
    case 'step:start':
      return { stepId: event.stepId, agentName: event.agentName }
    case 'step:complete':
      return { stepId: event.stepId, agentName: event.agentName, durationMs: event.durationMs, costCents: event.costCents }
    case 'step:error':
      return { stepId: event.stepId, agentName: event.agentName, error: event.error }
    case 'budget:warning':
      return { usage: event.usage }
    case 'budget:exhausted':
      return {}
    case 'plan:created':
      return { planId: event.planId, steps: event.steps }
    case 'execution:complete':
      return { durationMs: event.durationMs, costCents: event.costCents }
    default:
      return event as Record<string, unknown>
  }
}
