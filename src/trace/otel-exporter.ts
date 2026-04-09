/**
 * OTel Auto-Exporter — pushes SwarmWire traces to an OTLP/HTTP endpoint
 * automatically after each execution, without requiring manual plumbing.
 *
 * Wraps toOTelSpans + toOTLPJson and handles HTTP POST to your collector
 * (Jaeger, Tempo, OTEL Collector, Honeycomb, etc.).
 *
 * Uses the built-in Node.js `fetch` (Node 18+). No extra dependencies.
 */

import type { ExecutionResult } from '../types/execution.js'
import { toOTelSpans, toOTLPJson } from './otel.js'
import type { OTelExportConfig } from './otel.js'

export interface OTelExporterConfig extends OTelExportConfig {
  /**
   * OTLP/HTTP traces endpoint.
   * Typical values:
   *   http://localhost:4318/v1/traces          (OTEL Collector default)
   *   https://api.honeycomb.io/v1/traces       (Honeycomb)
   */
  endpoint: string
  /** Additional HTTP headers (e.g. API keys). */
  headers?: Record<string, string>
  /** Timeout per export request in ms. Default 5000. */
  timeoutMs?: number
  /** If true, log export errors to console. Default false. */
  logErrors?: boolean
}

export interface ExportResult {
  ok: boolean
  statusCode?: number
  error?: string
  durationMs: number
}

/**
 * Export a single ExecutionResult to an OTLP endpoint.
 */
export async function exportToOTLP(
  result: ExecutionResult,
  config: OTelExporterConfig,
): Promise<ExportResult> {
  const start = Date.now()
  const spans = toOTelSpans(result, config)
  const body = toOTLPJson(spans, config)

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs ?? 5000)

    let response: Response
    try {
      response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...config.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    const ok = response.ok
    if (!ok && config.logErrors) {
      console.error(`[swarmwire/otel] Export failed: ${response.status} ${response.statusText}`)
    }

    return { ok, statusCode: response.status, durationMs: Date.now() - start }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (config.logErrors) {
      console.error(`[swarmwire/otel] Export error: ${message}`)
    }
    return { ok: false, error: message, durationMs: Date.now() - start }
  }
}

/**
 * Create an auto-exporter that can be attached to swarm event hooks.
 *
 * Usage:
 * ```typescript
 * const exporter = createOTelExporter({ endpoint: 'http://localhost:4318/v1/traces', serviceName: 'my-app' })
 * swarm.on('execution:complete', (result) => exporter.export(result))
 * ```
 */
export function createOTelExporter(config: OTelExporterConfig): {
  export(result: ExecutionResult): Promise<ExportResult>
  exportSync(result: ExecutionResult): void
} {
  return {
    async export(result: ExecutionResult): Promise<ExportResult> {
      return exportToOTLP(result, config)
    },

    /** Fire-and-forget variant — useful in event handlers where you don't await. */
    exportSync(result: ExecutionResult): void {
      void exportToOTLP(result, config)
    },
  }
}

/**
 * Wrap executePlan to auto-export after every run.
 * Returns the same ExecutionResult so it's transparent to callers.
 */
export function withOTelExport<T>(
  executeFn: () => Promise<ExecutionResult<T>>,
  config: OTelExporterConfig,
): Promise<ExecutionResult<T>> {
  return executeFn().then(async (result) => {
    await exportToOTLP(result as ExecutionResult, config)
    return result
  })
}
