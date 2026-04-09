import { describe, it, expect, vi, afterEach } from 'vitest'
import { exportToOTLP, createOTelExporter, withOTelExport } from '../../src/trace/otel-exporter.js'
import type { ExecutionResult } from '../../src/types/execution.js'

function mockResult(): ExecutionResult {
  return {
    output: 'test output',
    partial: false,
    confidence: 1,
    plan: {
      id: 'plan_1',
      mode: 'sequential',
      steps: [],
      createdAt: Date.now(),
    },
    trace: {
      id: 'trace_1',
      planId: 'plan_1',
      startedAt: Date.now() - 1000,
      completedAt: Date.now(),
      spans: [],
      events: [],
    },
    cost: {
      totalTokens: 100,
      inputTokens: 80,
      outputTokens: 20,
      cachedInputTokens: 0,
      totalCostCents: 0.5,
      totalLatencyMs: 1000,
      budgetUsed: 0.5,
      perAgent: new Map(),
      perProvider: new Map(),
      savings: { promptCachingCents: 0, tierRoutingCents: 0, earlyStopCents: 0 },
    },
  }
}

describe('exportToOTLP', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns ok=true on successful export', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 } as Response))
    const result = await exportToOTLP(mockResult(), {
      endpoint: 'http://localhost:4318/v1/traces',
      serviceName: 'test',
    })
    expect(result.ok).toBe(true)
    expect(result.statusCode).toBe(200)
  })

  it('returns ok=false on HTTP error', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, statusText: 'Server Error' } as Response))
    const result = await exportToOTLP(mockResult(), {
      endpoint: 'http://localhost:4318/v1/traces',
      serviceName: 'test',
    })
    expect(result.ok).toBe(false)
    expect(result.statusCode).toBe(500)
  })

  it('returns ok=false and error on network failure', async () => {
    global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    const result = await exportToOTLP(mockResult(), {
      endpoint: 'http://localhost:4318/v1/traces',
      serviceName: 'test',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('ECONNREFUSED')
  })

  it('sends correct Content-Type header', async () => {
    let capturedHeaders: Record<string, string> = {}
    global.fetch = vi.fn(async (_url: unknown, init: unknown) => {
      capturedHeaders = (init as RequestInit).headers as Record<string, string>
      return { ok: true, status: 200 } as Response
    })
    await exportToOTLP(mockResult(), {
      endpoint: 'http://example.com',
      serviceName: 'svc',
      headers: { 'X-API-Key': 'abc123' },
    })
    expect(capturedHeaders['Content-Type']).toBe('application/json')
    expect(capturedHeaders['X-API-Key']).toBe('abc123')
  })
})

describe('createOTelExporter', () => {
  it('export returns ExportResult', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 } as Response))
    const exporter = createOTelExporter({ endpoint: 'http://localhost:4318/v1/traces', serviceName: 'svc' })
    const result = await exporter.export(mockResult())
    expect(result.ok).toBe(true)
  })

  it('exportSync fires and forgets without throwing', () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 } as Response))
    const exporter = createOTelExporter({ endpoint: 'http://localhost:4318/v1/traces', serviceName: 'svc' })
    expect(() => exporter.exportSync(mockResult())).not.toThrow()
  })
})

describe('withOTelExport', () => {
  it('passes through ExecutionResult unchanged', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 } as Response))
    const result = mockResult()
    const wrapped = await withOTelExport(async () => result, {
      endpoint: 'http://localhost:4318/v1/traces',
      serviceName: 'svc',
    })
    expect(wrapped).toBe(result)
  })
})
