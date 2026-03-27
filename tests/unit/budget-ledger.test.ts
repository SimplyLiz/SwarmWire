import { describe, it, expect, vi } from 'vitest'
import { BudgetLedger } from '../../src/budget/ledger.js'
import type { CostEvent } from '../../src/types/budget.js'

function makeEvent(overrides: Partial<CostEvent> = {}): CostEvent {
  return {
    timestamp: Date.now(),
    agentId: 'agent-1',
    agentName: 'researcher',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    inputTokens: 1000,
    outputTokens: 500,
    cachedInputTokens: 0,
    costCents: 5.0,
    durationMs: 800,
    ...overrides,
  }
}

describe('BudgetLedger', () => {
  it('tracks token usage', () => {
    const ledger = new BudgetLedger({ maxTokens: 10_000 })
    ledger.record(makeEvent({ inputTokens: 2000, outputTokens: 1000 }))

    const usage = ledger.usage()
    expect(usage.tokens.used).toBe(3000)
    expect(usage.tokens.fraction).toBeCloseTo(0.3, 1)
    expect(usage.exhausted).toBe(false)
  })

  it('tracks cost usage', () => {
    const ledger = new BudgetLedger({ maxCostCents: 100 })
    ledger.record(makeEvent({ costCents: 42 }))

    const usage = ledger.usage()
    expect(usage.cost.usedCents).toBe(42)
    expect(usage.cost.fraction).toBeCloseTo(0.42, 1)
  })

  it('detects budget exhaustion on tokens', () => {
    const ledger = new BudgetLedger({ maxTokens: 5000 })
    ledger.record(makeEvent({ inputTokens: 3000, outputTokens: 2000 }))

    expect(ledger.usage().exhausted).toBe(true)
  })

  it('detects budget exhaustion on cost', () => {
    const ledger = new BudgetLedger({ maxCostCents: 10 })
    ledger.record(makeEvent({ costCents: 10 }))

    expect(ledger.usage().exhausted).toBe(true)
  })

  it('fires warning event at 80%', () => {
    const events: unknown[] = []
    const ledger = new BudgetLedger({ maxCostCents: 100 }, (e) => events.push(e))

    ledger.record(makeEvent({ costCents: 79 }))
    expect(events.length).toBe(0)

    ledger.record(makeEvent({ costCents: 2 }))
    expect(events.length).toBe(1)
    expect((events[0] as { type: string }).type).toBe('budget:warning')
  })

  it('fires exhausted event', () => {
    const events: unknown[] = []
    const ledger = new BudgetLedger({ maxCostCents: 10 }, (e) => events.push(e))

    ledger.record(makeEvent({ costCents: 10 }))
    expect(events.some((e) => (e as { type: string }).type === 'budget:exhausted')).toBe(true)
  })

  it('fires warning and exhausted only once', () => {
    const events: unknown[] = []
    const ledger = new BudgetLedger({ maxCostCents: 10 }, (e) => events.push(e))

    ledger.record(makeEvent({ costCents: 8 }))
    ledger.record(makeEvent({ costCents: 3 }))
    ledger.record(makeEvent({ costCents: 1 }))

    const warnings = events.filter((e) => (e as { type: string }).type === 'budget:warning')
    const exhausted = events.filter((e) => (e as { type: string }).type === 'budget:exhausted')
    expect(warnings.length).toBe(1)
    expect(exhausted.length).toBe(1)
  })

  it('canAfford checks remaining budget', () => {
    const ledger = new BudgetLedger({ maxTokens: 10_000, maxCostCents: 50 })
    ledger.record(makeEvent({ inputTokens: 4000, outputTokens: 2000, costCents: 20 }))

    expect(ledger.canAfford(3000, 25)).toBe(true)
    expect(ledger.canAfford(5000, 25)).toBe(false)  // tokens exceed
    expect(ledger.canAfford(3000, 35)).toBe(false)  // cost exceeds
  })

  it('remaining returns correct sub-budget', () => {
    const ledger = new BudgetLedger({ maxTokens: 10_000, maxCostCents: 100 })
    ledger.record(makeEvent({ inputTokens: 2000, outputTokens: 1000, costCents: 30 }))

    const remaining = ledger.remaining()
    expect(remaining.maxTokens).toBe(7000)
    expect(remaining.maxCostCents).toBe(70)
  })

  it('summarize produces correct cost breakdown', () => {
    const ledger = new BudgetLedger({ maxCostCents: 100 })

    ledger.record(makeEvent({ agentName: 'researcher', provider: 'anthropic', costCents: 15, inputTokens: 1000, outputTokens: 500 }))
    ledger.record(makeEvent({ agentName: 'analyst', provider: 'openai', costCents: 10, inputTokens: 800, outputTokens: 400 }))
    ledger.record(makeEvent({ agentName: 'researcher', provider: 'anthropic', costCents: 8, inputTokens: 600, outputTokens: 300 }))

    const summary = ledger.summarize()
    expect(summary.totalCostCents).toBe(33)
    expect(summary.totalTokens).toBe(3600)
    expect(summary.perAgent.get('researcher')?.calls).toBe(2)
    expect(summary.perAgent.get('researcher')?.costCents).toBe(23)
    expect(summary.perAgent.get('analyst')?.calls).toBe(1)
    expect(summary.perProvider.get('anthropic')?.costCents).toBe(23)
    expect(summary.perProvider.get('openai')?.costCents).toBe(10)
  })
})
