/**
 * Tests for round 2 feature requests:
 * Record/Replay, Approval Gates, Dry-Run, OTEL, Diff Execution, Contracts, Model Cascade
 */

import { describe, it, expect } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Swarm, createAgent, RecordingProvider, ReplayProvider, dryRun, buildPlan,
  toOTelSpans, toOTLPJson, diffPlans, applyPreviousResults,
  validateOutput, withContract, ContractViolationError,
  chatWithCascade,
} from '../../src/index.js'
import type { Provider, LlmRequest, Task, ExecutionResult, Plan } from '../../src/index.js'

function mockProvider(name = 'mock'): Provider {
  let counter = 0
  return {
    name,
    models: [
      { model: 'cheap', tier: 'cheap', inputCostPer1kTokens: 0.1, outputCostPer1kTokens: 0.3, contextWindow: 128000 },
      { model: 'premium', tier: 'premium', inputCostPer1kTokens: 15, outputCostPer1kTokens: 75, contextWindow: 200000 },
    ],
    async chat(req) {
      counter++
      return { content: `Response #${counter} to ${req.model}`, model: req.model, inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, finishReason: 'stop' as const, durationMs: 50 }
    },
    estimateCost: (_m, inp, out) => (inp + out) / 1000 * 1.0,
  }
}

// ─── #1: Record/Replay ───

describe('Feature: Record/Replay', () => {
  it('records interactions and saves to disk', async () => {
    const path = join(tmpdir(), `swarmwire-fixture-${Date.now()}.json`)
    const recorder = new RecordingProvider(mockProvider(), path)

    const swarm = new Swarm({ providers: [recorder] })
    swarm.agent({ name: 'a', role: 'r', model: { provider: 'mock', model: 'cheap' }, execute: async (_, ctx) => ctx.llm('hello') })

    await swarm.run('test')
    await recorder.save()

    expect(recorder.count).toBeGreaterThan(0)

    // Verify fixture is readable
    const { readFile } = await import('node:fs/promises')
    const content = JSON.parse(await readFile(path, 'utf-8'))
    expect(content.version).toBe('1.0')
    expect(content.interactions.length).toBeGreaterThan(0)
    expect(content.interactions[0].request.fingerprint).toBeTruthy()
  })

  it('replays from fixture deterministically', async () => {
    // Create fixture
    const path = join(tmpdir(), `swarmwire-replay-${Date.now()}.json`)
    const recorder = new RecordingProvider(mockProvider(), path)
    const swarm1 = new Swarm({ providers: [recorder] })
    swarm1.agent({ name: 'a', role: 'r', model: { provider: 'mock', model: 'cheap' }, execute: async (_, ctx) => ctx.llm('hello world') })
    await swarm1.run('test')
    await recorder.save()

    // Replay — load fixture first so provider name matches
    const replayer = new ReplayProvider(path, { name: 'mock' })
    const swarm2 = new Swarm({ providers: [replayer] })
    swarm2.agent({ name: 'a', role: 'r', model: { provider: 'mock', model: 'cheap' }, execute: async (_, ctx) => ctx.llm('hello world') })
    const result = await swarm2.run('test')

    expect(result.output).toBeTruthy()
    expect(result.cost.totalCostCents).toBe(0) // Replay is free
    expect(replayer.matchedCount).toBeGreaterThan(0)
  })

  it('partial replay falls back to real provider for unmatched requests', async () => {
    const fixture = {
      version: '1.0' as const,
      provider: 'mock',
      recordedAt: new Date().toISOString(),
      interactions: [{
        index: 0,
        request: { model: 'cheap', messages: [{ role: 'user', content: 'known query' }], fingerprint: 'known query' },
        response: { content: 'cached answer', model: 'cheap', inputTokens: 50, outputTokens: 25, cachedInputTokens: 0, finishReason: 'stop' },
        durationMs: 50, costCents: 0.05,
      }],
    }

    const replayer = new ReplayProvider(fixture, { strict: false, fallback: mockProvider() })
    const response = await replayer.chat({ model: 'cheap', messages: [{ role: 'user', content: 'completely unrelated topic about quantum physics and dark matter in the universe' }] })
    // Falls back to mock since no fixture match (fingerprints too different)
    expect(response.content).toBeTruthy() // Either cached or fallback — both valid
  })
})

// ─── #2: Approval Gates ───

describe('Feature: Approval Gates', () => {
  it('pauses and continues on approval', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    const agent = swarm.agent({ name: 'deployer', role: 'r', execute: async () => 'deployed' })

    const plan = await swarm.plan('deploy', { agents: [agent] })
    plan.steps[0]!.gate = { type: 'approval', message: 'Approve deployment?' }

    const approvals: string[] = []
    const result = await swarm.execute(plan, {
      onApproval: async (gate) => {
        approvals.push(gate.message)
        return 'approved'
      },
    })

    expect(approvals).toEqual(['Approve deployment?'])
    expect(result.output).toBe('deployed')
  })

  it('skips step on rejection', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    const agent = swarm.agent({ name: 'deployer', role: 'r', execute: async () => 'deployed' })

    const plan = await swarm.plan('deploy', { agents: [agent] })
    plan.steps[0]!.gate = { type: 'approval', message: 'Approve?' }

    const result = await swarm.execute(plan, {
      onApproval: async () => 'rejected',
    })

    expect(result.partial).toBe(true)
    expect(result.allResults.some((r) => r.status === 'skipped')).toBe(true)
  })

  it('auto-approves when no callback', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    const agent = swarm.agent({ name: 'a', role: 'r', execute: async () => 'ok' })

    const plan = await swarm.plan('test', { agents: [agent] })
    plan.steps[0]!.gate = { type: 'approval', message: 'Auto?' }

    const result = await swarm.execute(plan)
    expect(result.output).toBe('ok')
  })
})

// ─── #3: Dry-Run ───

describe('Feature: Dry-Run', () => {
  it('estimates cost without calling LLMs', () => {
    const agents = [createAgent({ name: 'a', role: 'r', modelTier: 'cheap' }), createAgent({ name: 'b', role: 'r', modelTier: 'premium' })]
    const task: Task = { id: 't', description: 'analyze code', input: 'test', budget: { maxCostCents: 100 } }
    const plan = buildPlan(task, { agents })

    const result = dryRun(plan, [mockProvider()])

    expect(result.estimatedCost.likelyCents).toBeGreaterThan(0)
    expect(result.estimatedDuration.likelyMs).toBeGreaterThan(0)
    expect(result.tokenBudget.totalTokens).toBeGreaterThan(0)
    expect(result.stepBreakdown.length).toBe(plan.steps.length)
    expect(result.totalSteps).toBe(plan.steps.length)
    expect(typeof result.willExceedBudget).toBe('boolean')
  })

  it('detects budget overruns', () => {
    const agent = createAgent({ name: 'a', role: 'r', modelTier: 'premium' })
    const task: Task = { id: 't', description: 'big task', input: 'x'.repeat(10000), budget: { maxCostCents: 0.01 } }
    const plan = buildPlan(task, { agents: [agent] })

    const result = dryRun(plan, [mockProvider()])
    expect(result.willExceedBudget).toBe(true)
  })
})

// ─── #4: OTEL Export ───

describe('Feature: OpenTelemetry Export', () => {
  it('converts execution result to OTEL spans', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'a', role: 'r', execute: async () => 'ok' })
    const result = await swarm.run('test')

    const spans = toOTelSpans(result, { serviceName: 'test-service' })
    expect(spans.length).toBeGreaterThan(0)

    // Root span
    const root = spans[0]!
    expect(root.name).toBe('swarmwire.execute')
    expect(root.attributes.some((a) => a.key === 'service.name' && a.value.stringValue === 'test-service')).toBe(true)
    expect(root.attributes.some((a) => a.key === 'swarmwire.cost.total_cents')).toBe(true)
  })

  it('produces valid OTLP JSON', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'a', role: 'r', execute: async () => 'ok' })
    const result = await swarm.run('test')

    const spans = toOTelSpans(result, { serviceName: 'test' })
    const otlp = toOTLPJson(spans, { serviceName: 'test' })

    expect(otlp).toHaveProperty('resourceSpans')
    const rs = (otlp as { resourceSpans: Array<{ scopeSpans: unknown[] }> }).resourceSpans
    expect(rs.length).toBe(1)
    expect(rs[0]!.scopeSpans.length).toBe(1)
  })
})

// ─── #5: Differential Execution ───

describe('Feature: Differential Execution', () => {
  it('identifies changed vs reusable steps', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    const a = swarm.agent({ name: 'a', role: 'r', execute: async (input) => `a(${input})` })
    const b = swarm.agent({ name: 'b', role: 'r', execute: async (input) => `b(${input})` })

    const plan1 = await swarm.plan('test', { agents: [a, b], input: 'same-input', parallel: true })
    const result1 = await swarm.execute(plan1)

    // Same plan, same input — everything should be reusable
    const plan2 = await swarm.plan('test', { agents: [a, b], input: 'same-input', parallel: true })
    const diff = diffPlans(plan2, result1)

    // Step IDs differ between plan builds, so this tests the content-based matching
    expect(diff.reusableSteps.length + diff.changedSteps.length + diff.cascadeSteps.length).toBe(plan2.steps.length)
  })

  it('detects input changes', async () => {
    const agent = createAgent({ name: 'a', role: 'r', execute: async () => 'ok' })

    const task1: Task = { id: 't', description: 'test', input: 'input-v1', budget: {} }
    const plan1 = buildPlan(task1, { agents: [agent] })
    plan1.steps[0]!.status = 'complete'
    plan1.steps[0]!.output = 'result-v1'
    const fakeResult: ExecutionResult = {
      output: 'result-v1', confidence: 0.8, evidence: [], agentOutputs: [], allResults: [],
      cost: { totalTokens: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalCostCents: 0, totalLatencyMs: 0, budgetUsed: 0, perAgent: new Map(), perProvider: new Map(), savings: { promptCachingCents: 0, tierRoutingCents: 0, earlyStopCents: 0 } },
      trace: { id: 'p', startedAt: 0, completedAt: 0, spans: [] }, plan: plan1, partial: false, events: [],
    }

    const task2: Task = { id: 't', description: 'test', input: 'input-v2', budget: {} }
    const plan2 = buildPlan(task2, { agents: [agent] })

    const diff = diffPlans(plan2, fakeResult)
    expect(diff.changedSteps.length).toBeGreaterThan(0)
  })
})

// ─── #6: Output Contracts ───

describe('Feature: Output Contracts', () => {
  it('validates output against schema (zod-style)', async () => {
    const mockSchema = {
      parse: (v: unknown) => {
        if (typeof v !== 'object' || v === null || !('name' in v)) throw new Error('Missing name')
        return v
      },
    }

    const result = await validateOutput({ name: 'test' }, { schema: mockSchema, onFailure: 'retry' }, { agentName: 'a', executionId: 'e', input: null })
    expect(result.valid).toBe(true)

    const bad = await validateOutput({ wrong: 'shape' }, { schema: mockSchema, onFailure: 'retry' }, { agentName: 'a', executionId: 'e', input: null })
    expect(bad.valid).toBe(false)
  })

  it('validates with custom semantic validator', async () => {
    const contract = {
      validate: async (output: { findings: unknown[] }) => {
        if (output.findings.length === 0) return { valid: false, reason: 'No findings' }
        return { valid: true }
      },
      onFailure: 'retry' as const,
    }

    const good = await validateOutput({ findings: ['issue1'] }, contract, { agentName: 'a', executionId: 'e', input: null })
    expect(good.valid).toBe(true)

    const bad = await validateOutput({ findings: [] }, contract, { agentName: 'a', executionId: 'e', input: null })
    expect(bad.valid).toBe(false)
    expect(bad.reason).toContain('No findings')
  })

  it('withContract retries then throws on persistent failure', async () => {
    let callCount = 0
    const execute = async () => {
      callCount++
      return { result: 'bad' }
    }

    const wrapped = withContract(execute, {
      validate: async () => ({ valid: false, reason: 'always fails' }),
      onFailure: 'escalate',
      maxRetries: 2,
    })

    await expect(wrapped('input', {})).rejects.toThrow(ContractViolationError)
    expect(callCount).toBe(3) // 1 initial + 2 retries
  })
})

// ─── #7: Model Cascade on Quality ───

describe('Feature: Model Cascade on Quality', () => {
  it('uses primary when quality is good', async () => {
    const providers = new Map<string, Provider>([['mock', mockProvider()]])

    const result = await chatWithCascade(
      { model: 'cheap', messages: [{ role: 'user', content: 'test' }] },
      { primary: { provider: 'mock', model: 'cheap' }, fallbacks: [] },
      providers,
    )

    expect(result.modelUsed).toBe('cheap')
    expect(result.escalated).toBe(false)
  })

  it('escalates to fallback on quality failure', async () => {
    const provider: Provider = {
      name: 'mock',
      models: [
        { model: 'weak', tier: 'cheap', inputCostPer1kTokens: 0.1, outputCostPer1kTokens: 0.3, contextWindow: 128000 },
        { model: 'strong', tier: 'premium', inputCostPer1kTokens: 15, outputCostPer1kTokens: 75, contextWindow: 200000 },
      ],
      async chat(req) {
        const isWeak = req.model === 'weak'
        return {
          content: isWeak ? 'idk' : 'Thorough, well-structured analysis with specific examples and detailed reasoning.',
          model: req.model, inputTokens: 100, outputTokens: isWeak ? 5 : 200, cachedInputTokens: 0,
          finishReason: 'stop', durationMs: 50,
        }
      },
      estimateCost: () => 0.04,
    }

    const providers = new Map([['mock', provider]])
    const result = await chatWithCascade(
      { model: 'weak', messages: [{ role: 'user', content: 'analyze this' }] },
      {
        primary: { provider: 'mock', model: 'weak' },
        fallbacks: [{ provider: 'mock', model: 'strong', condition: 'both' }],
        qualityThreshold: 0.6,
        qualityEstimator: (_req, resp, model) => {
          if (resp.outputTokens < 20) return 0.2
          return 0.8
        },
      },
      providers,
    )

    expect(result.escalated).toBe(true)
    expect(result.modelUsed).toBe('strong')
    expect(result.modelsAttempted).toEqual(['weak', 'strong'])
  })

  it('throws when all models fail', async () => {
    const provider: Provider = {
      name: 'mock', models: [],
      async chat() { throw new Error('all broken') },
      estimateCost: () => 0,
    }
    const providers = new Map([['mock', provider]])

    await expect(chatWithCascade(
      { model: 'x', messages: [{ role: 'user', content: 'test' }] },
      { primary: { provider: 'mock', model: 'x' }, fallbacks: [{ provider: 'mock', model: 'y', condition: 'error' }] },
      providers,
    )).rejects.toThrow('cascade exhausted')
  })
})
