import { describe, it, expect } from 'vitest'
import { executionToMermaid, traceToMermaidGantt, stateMachineConfigToMermaid } from '../../src/viz/mermaid.js'
import { toHTML } from '../../src/viz/html.js'
import { StateMachine, buildLinearStateMachine, END } from '../../src/workflow/state-machine.js'
import type { ExecutionResult } from '../../src/types/execution.js'

function mockResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    output: 'test output',
    confidence: 0.9,
    evidence: [],
    agentOutputs: [],
    allResults: [],
    events: [],
    messages: [],
    partial: false,
    cost: {
      totalTokens: 1500,
      inputTokens: 1000,
      outputTokens: 500,
      cachedInputTokens: 0,
      totalCostCents: 15,
      totalLatencyMs: 2300,
      budgetUsed: 0.15,
      perAgent: new Map([
        ['researcher', { tokens: 800, costCents: 9, calls: 1 }],
        ['summarizer', { tokens: 700, costCents: 6, calls: 1 }],
      ]),
      perProvider: new Map(),
      savings: { promptCachingCents: 0, tierRoutingCents: 0, earlyStopCents: 0 },
    },
    trace: {
      id: 'trace_1',
      startedAt: 1000,
      completedAt: 3300,
      spans: [
        {
          id: 'span_1',
          name: 'researcher',
          type: 'step',
          startedAt: 1000,
          completedAt: 2200,
          durationMs: 1200,
          attributes: {},
          status: 'ok',
        },
        {
          id: 'span_2',
          name: 'summarizer',
          type: 'step',
          startedAt: 2200,
          completedAt: 3300,
          durationMs: 1100,
          attributes: {},
          status: 'ok',
        },
      ],
    },
    plan: {
      id: 'plan_1',
      task: { input: 'Research and summarize AI trends', id: 'task_1', budget: { maxCostCents: 100 } } as never,
      mode: 'deep',
      status: 'complete',
      estimatedCost: { minCents: 10, maxCents: 30 } as never,
      steps: [
        {
          id: 'step_1',
          agent: { name: 'researcher', id: 'agent_1' } as never,
          input: { type: 'task_input' },
          dependencies: [],
          status: 'complete',
          cost: { costCents: 9, durationMs: 1200, inputTokens: 800, outputTokens: 0, cachedInputTokens: 0, agentId: 'a1', agentName: 'researcher', provider: 'anthropic', model: 'claude-haiku', timestamp: 1000 },
        },
        {
          id: 'step_2',
          agent: { name: 'summarizer', id: 'agent_2' } as never,
          input: { type: 'step_output', stepId: 'step_1' },
          dependencies: ['step_1'],
          status: 'complete',
          cost: { costCents: 6, durationMs: 1100, inputTokens: 700, outputTokens: 0, cachedInputTokens: 0, agentId: 'a2', agentName: 'summarizer', provider: 'anthropic', model: 'claude-haiku', timestamp: 2200 },
        },
      ],
    },
    ...overrides,
  } as ExecutionResult
}

describe('executionToMermaid', () => {
  it('produces a flowchart diagram', () => {
    const diagram = executionToMermaid(mockResult())
    expect(diagram).toMatch(/^flowchart TD/)
    expect(diagram).toContain('researcher')
    expect(diagram).toContain('summarizer')
  })

  it('includes step edges', () => {
    const diagram = executionToMermaid(mockResult())
    expect(diagram).toContain('step_1 --> step_2')
  })

  it('includes cost when showCost=true', () => {
    const diagram = executionToMermaid(mockResult(), { showCost: true })
    expect(diagram).toContain('¢')
  })

  it('omits cost when showCost=false', () => {
    const diagram = executionToMermaid(mockResult(), { showCost: false })
    expect(diagram).not.toContain('¢')
  })

  it('includes style directives for all steps', () => {
    const diagram = executionToMermaid(mockResult())
    expect(diagram).toContain('style step_1')
    expect(diagram).toContain('style step_2')
  })

  it('uses red fill for failed steps', () => {
    const result = mockResult()
    result.plan.steps[1]!.status = 'failed'
    result.plan.steps[1]!.error = 'Timeout'
    const diagram = executionToMermaid(result)
    expect(diagram).toContain('#ef4444')
  })
})

describe('traceToMermaidGantt', () => {
  it('produces a gantt diagram', () => {
    const result = mockResult()
    const gantt = traceToMermaidGantt(result.trace)
    expect(gantt).toMatch(/^gantt/)
    expect(gantt).toContain('researcher')
    expect(gantt).toContain('summarizer')
  })

  it('uses custom title', () => {
    const result = mockResult()
    const gantt = traceToMermaidGantt(result.trace, { title: 'My Pipeline' })
    expect(gantt).toContain('title My Pipeline')
  })
})

describe('stateMachineConfigToMermaid', () => {
  it('produces a flowchart from edges', () => {
    const mermaid = stateMachineConfigToMermaid([
      { from: 'draft', to: 'review' },
      { from: 'review', to: END },
    ])
    expect(mermaid).toMatch(/^flowchart TD/)
    expect(mermaid).toContain('draft')
    expect(mermaid).toContain('review')
  })
})

describe('StateMachine.toMermaid()', () => {
  it('generates mermaid from a linear machine', () => {
    const sm = buildLinearStateMachine([
      { name: 'a', execute: async (s) => s },
      { name: 'b', execute: async (s) => s },
      { name: 'c', execute: async (s) => s },
    ])
    const mermaid = sm.toMermaid()
    expect(mermaid).toMatch(/^flowchart TD/)
    expect(mermaid).toContain('a')
    expect(mermaid).toContain('b')
    expect(mermaid).toContain('c')
  })

  it('marks entry node in blue', () => {
    const sm = buildLinearStateMachine([
      { name: 'start', execute: async (s) => s },
      { name: 'end_node', execute: async (s) => s },
    ])
    const mermaid = sm.toMermaid()
    expect(mermaid).toContain('style start fill:#1d4ed8')
  })

  it('handles conditional edges', () => {
    const sm = new StateMachine({
      entryNode: 'check',
      maxIterations: 5,
      nodes: [
        { name: 'check', execute: async (s: { pass: boolean }) => s },
        { name: 'pass', execute: async (s) => s },
        { name: 'fail', execute: async (s) => s },
      ],
      edges: [
        { from: 'check', to: (s: { pass: boolean }) => s.pass ? 'pass' : 'fail' },
        { from: 'pass', to: END },
        { from: 'fail', to: END },
      ],
    })
    const mermaid = sm.toMermaid()
    expect(mermaid).toContain('conditional')
  })
})

describe('toHTML', () => {
  it('generates a valid HTML document', () => {
    const html = toHTML(mockResult())
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('mermaid')
    expect(html).toContain('researcher')
    expect(html).toContain('summarizer')
  })

  it('includes cost summary cards', () => {
    const html = toHTML(mockResult())
    expect(html).toContain('Total Cost')
    expect(html).toContain('Tokens')
    expect(html).toContain('Duration')
  })

  it('uses custom title', () => {
    const html = toHTML(mockResult(), { title: 'My Custom Report' })
    expect(html).toContain('My Custom Report')
  })

  it('includes per-agent cost breakdown', () => {
    const html = toHTML(mockResult())
    expect(html).toContain('Cost by Agent')
    expect(html).toContain('researcher')
    expect(html).toContain('summarizer')
  })

  it('escapes HTML in agent names', () => {
    const result = mockResult()
    result.plan.steps[0]!.agent = { name: '<script>alert(1)</script>', id: 'x' } as never
    const html = toHTML(result)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
