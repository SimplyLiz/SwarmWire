/**
 * OpenTelemetry export — convert SwarmWire traces to OTEL spans.
 * Follows emerging gen_ai semantic conventions.
 */

import type { ExecutionResult, ExecutionTrace, TraceSpan } from '../types/execution.js'

/** OTEL-compatible span (simplified — can be fed to any OTEL exporter) */
export interface OTelSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: 'internal' | 'client'
  startTimeUnixNano: number
  endTimeUnixNano: number
  attributes: OTelAttribute[]
  status: { code: 'OK' | 'ERROR'; message?: string }
}

export interface OTelAttribute {
  key: string
  value: { stringValue?: string; intValue?: number; doubleValue?: number; boolValue?: boolean }
}

export interface OTelExportConfig {
  serviceName: string
  serviceVersion?: string
}

/**
 * Convert an ExecutionResult's trace into OTEL spans.
 */
export function toOTelSpans(result: ExecutionResult, config: OTelExportConfig): OTelSpan[] {
  const spans: OTelSpan[] = []
  const traceId = result.trace.id.replace(/[^a-f0-9]/g, '').padEnd(32, '0').slice(0, 32)

  // Root span for the entire execution
  const rootSpanId = generateSpanId()
  spans.push({
    traceId,
    spanId: rootSpanId,
    name: `swarmwire.execute`,
    kind: 'internal',
    startTimeUnixNano: toNano(result.trace.startedAt),
    endTimeUnixNano: toNano(result.trace.completedAt),
    attributes: [
      attr('service.name', config.serviceName),
      attr('service.version', config.serviceVersion ?? '0.1.0'),
      attr('swarmwire.plan.id', result.plan.id),
      attr('swarmwire.plan.mode', result.plan.mode),
      attr('swarmwire.plan.steps', result.plan.steps.length),
      attr('swarmwire.cost.total_cents', result.cost.totalCostCents),
      attr('swarmwire.cost.budget_used', result.cost.budgetUsed),
      attr('swarmwire.tokens.total', result.cost.totalTokens),
      attr('swarmwire.tokens.input', result.cost.inputTokens),
      attr('swarmwire.tokens.output', result.cost.outputTokens),
      attr('swarmwire.partial', result.partial),
      attr('swarmwire.confidence', result.confidence),
    ],
    status: { code: result.partial ? 'ERROR' : 'OK' },
  })

  // Child spans for each trace span
  for (const span of result.trace.spans) {
    const spanId = generateSpanId()
    const parentId = span.parentId
      ? spans.find((s) => s.attributes.some((a) => a.key === 'swarmwire.span.id' && a.value.stringValue === span.parentId))?.spanId ?? rootSpanId
      : rootSpanId

    const otelSpan: OTelSpan = {
      traceId,
      spanId,
      parentSpanId: parentId,
      name: span.name,
      kind: span.type === 'llm_call' ? 'client' : 'internal',
      startTimeUnixNano: toNano(span.startedAt),
      endTimeUnixNano: toNano(span.completedAt),
      attributes: [
        attr('swarmwire.span.id', span.id),
        attr('swarmwire.span.type', span.type),
        attr('swarmwire.duration_ms', span.durationMs),
      ],
      status: { code: span.status === 'ok' ? 'OK' : 'ERROR', message: span.error },
    }

    // Add gen_ai semantic conventions for LLM calls
    if (span.type === 'llm_call') {
      const model = (span.attributes as Record<string, unknown>).model as string | undefined
      const provider = (span.attributes as Record<string, unknown>).provider as string | undefined
      if (model) otelSpan.attributes.push(attr('gen_ai.request.model', model))
      if (provider) otelSpan.attributes.push(attr('gen_ai.system', provider))
      if (span.tokens) otelSpan.attributes.push(attr('gen_ai.usage.total_tokens', span.tokens))
      if (span.costCents) otelSpan.attributes.push(attr('gen_ai.cost_cents', span.costCents))
    }

    if (span.costCents) otelSpan.attributes.push(attr('swarmwire.cost_cents', span.costCents))
    if (span.tokens) otelSpan.attributes.push(attr('swarmwire.tokens', span.tokens))

    spans.push(otelSpan)
  }

  return spans
}

/**
 * Format spans as OTLP JSON (can be POST'd to any OTLP/HTTP endpoint).
 */
export function toOTLPJson(spans: OTelSpan[], config: OTelExportConfig): object {
  return {
    resourceSpans: [{
      resource: {
        attributes: [
          attr('service.name', config.serviceName),
          attr('service.version', config.serviceVersion ?? '0.1.0'),
          attr('telemetry.sdk.name', 'swarmwire'),
          attr('telemetry.sdk.language', 'typescript'),
        ],
      },
      scopeSpans: [{
        scope: { name: 'swarmwire', version: '0.1.0' },
        spans,
      }],
    }],
  }
}

// ─── Helpers ───

function attr(key: string, value: string | number | boolean | undefined): OTelAttribute {
  if (typeof value === 'string') return { key, value: { stringValue: value } }
  if (typeof value === 'number') return { key, value: Number.isInteger(value) ? { intValue: value } : { doubleValue: value } }
  if (typeof value === 'boolean') return { key, value: { boolValue: value } }
  return { key, value: { stringValue: String(value) } }
}

function toNano(ms: number): number {
  return Math.floor(ms * 1_000_000)
}

let spanCounter = 0
function generateSpanId(): string {
  return (++spanCounter).toString(16).padStart(16, '0')
}
