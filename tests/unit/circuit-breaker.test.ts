import { describe, it, expect } from 'vitest'
import { withCircuitBreaker, withFailover, CircuitOpenError } from '../../src/providers/circuit-breaker.js'
import type { Provider } from '../../src/types/provider.js'

function makeProvider(name: string, fail = false): Provider {
  return {
    name,
    models: [{ model: 'test', tier: 'cheap', inputCostPer1kTokens: 0.1, outputCostPer1kTokens: 0.3, contextWindow: 128000 }],
    async chat() {
      if (fail) throw new Error(`${name} failed`)
      return {
        content: `response from ${name}`,
        model: 'test',
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 0,
        finishReason: 'stop' as const,
        durationMs: 50,
      }
    },
    estimateCost: () => 0.04,
  }
}

describe('Circuit Breaker', () => {
  it('passes through when closed', async () => {
    const wrapped = withCircuitBreaker(makeProvider('test'))
    expect(wrapped.getState()).toBe('closed')

    const response = await wrapped.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }] })
    expect(response.content).toBe('response from test')
    expect(wrapped.getState()).toBe('closed')
  })

  it('trips circuit after failure threshold', async () => {
    const failingProvider = makeProvider('fail', true)
    const wrapped = withCircuitBreaker(failingProvider, {
      failureThreshold: 0.4,
      windowMs: 60_000,
      resetTimeoutMs: 10_000,
    })

    // Generate enough failures to trip
    for (let i = 0; i < 5; i++) {
      try { await wrapped.chat({ model: 'test', messages: [] }) } catch { /* expected */ }
    }

    expect(wrapped.getState()).toBe('open')

    // Next call should throw CircuitOpenError
    try {
      await wrapped.chat({ model: 'test', messages: [] })
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError)
    }
  })

  it('recovers to half-open after timeout', async () => {
    const failingProvider = makeProvider('fail', true)
    const wrapped = withCircuitBreaker(failingProvider, {
      failureThreshold: 0.3,
      windowMs: 60_000,
      resetTimeoutMs: 50, // Very short for testing
    })

    // Trip the circuit
    for (let i = 0; i < 5; i++) {
      try { await wrapped.chat({ model: 'test', messages: [] }) } catch { /* expected */ }
    }

    expect(wrapped.getState()).toBe('open')

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 60))

    // Should be half-open now
    expect(wrapped.getState()).toBe('half-open')
  })
})

describe('Failover', () => {
  it('falls through to backup when primary fails', async () => {
    const primary = withCircuitBreaker(makeProvider('primary', true), { failureThreshold: 0.3 })
    const backup = withCircuitBreaker(makeProvider('backup', false))

    // Trip primary
    for (let i = 0; i < 5; i++) {
      try { await primary.chat({ model: 'test', messages: [] }) } catch { /* expected */ }
    }

    const failover = withFailover([primary, backup])
    const response = await failover.chat({ model: 'test', messages: [{ role: 'user', content: 'hi' }] })
    expect(response.content).toBe('response from backup')
  })

  it('throws when all providers fail', async () => {
    const p1 = withCircuitBreaker(makeProvider('p1', true), { failureThreshold: 0.3 })
    const p2 = withCircuitBreaker(makeProvider('p2', true), { failureThreshold: 0.3 })

    // Trip both
    for (let i = 0; i < 5; i++) {
      try { await p1.chat({ model: 'test', messages: [] }) } catch { /* expected */ }
      try { await p2.chat({ model: 'test', messages: [] }) } catch { /* expected */ }
    }

    const failover = withFailover([p1, p2])
    await expect(failover.chat({ model: 'test', messages: [] })).rejects.toThrow('All providers failed')
  })
})
