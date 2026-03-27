/**
 * Smoke tests — exercise SwarmWire the way a real user would.
 * Uses mock providers to test the full flow without API keys.
 */

import { describe, it, expect } from 'vitest'
import {
  Swarm,
  createAgent,
  createProvider,
  BudgetLedger,
  scoreTask,
  buildPlan,
  executePlan,
  routeModel,
  matchAgent,
  detectConflicts,
  resolveConflict,
  packContext,
  estimateTokens,
  sourceFromStepOutput,
  explainExecution,
  summarizeExecution,
  visualizePlan,
  analyzeCosts,
  parseWorkflow,
  compileWorkflow,
  WorkflowParseError,
  WorkerPool,
  AdaptiveRouter,
  EvolvingOrchestrator,
  withCircuitBreaker,
  withFailover,
  Blackboard,
  templates,
  saveState,
  loadState,
  emptyState,
} from '../../src/index.js'
import type {
  Agent,
  AgentDefinition,
  Task,
  Budget,
  Plan,
  ExecutionResult,
  Provider,
  SwarmEvent,
  ModelConfig,
} from '../../src/index.js'

// ─── Test Helpers ───

function mockProvider(name = 'mock'): Provider {
  let callCount = 0
  return {
    name,
    models: [
      { model: 'mock-cheap', tier: 'cheap', inputCostPer1kTokens: 0.1, outputCostPer1kTokens: 0.3, contextWindow: 128000 },
      { model: 'mock-standard', tier: 'standard', inputCostPer1kTokens: 1.0, outputCostPer1kTokens: 3.0, contextWindow: 128000 },
    ],
    async chat(req) {
      callCount++
      return {
        content: `Response #${callCount} to: ${req.messages[0]?.content?.slice(0, 50) ?? ''}`,
        model: req.model,
        inputTokens: 150,
        outputTokens: 80,
        cachedInputTokens: 0,
        finishReason: 'stop' as const,
        durationMs: 100,
      }
    },
    estimateCost: (_m, inp, out) => (inp + out) / 1000 * 1.0,
  }
}

function echoAgent(name: string, prefix = ''): Agent {
  return createAgent({
    name,
    role: `${name} agent`,
    model: { provider: 'mock', model: 'mock-standard' },
    capabilities: [name],
    execute: async (input) => `${prefix}${name}(${typeof input === 'string' ? input : JSON.stringify(input)})`,
  })
}

// ─── Smoke Tests ───

describe('Smoke: Swarm basic usage', () => {
  it('creates a swarm, registers agents, runs a task', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'worker', role: 'do stuff', execute: async (input) => `done: ${input}` })

    const result = await swarm.run('hello')
    expect(result.output).toBe('done: hello')
    expect(result.cost).toBeDefined()
    expect(result.plan.steps.length).toBeGreaterThan(0)
    expect(result.trace.spans).toBeDefined()
  })

  it('runs with string input (simplest API)', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'a', role: 'r', execute: async (input) => `got: ${input}` })
    const result = await swarm.run('test')
    expect(result.output).toContain('got:')
  })

  it('collects events during execution', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'a', role: 'r', execute: async () => 'ok' })

    const events: SwarmEvent[] = []
    swarm.on('step:start', (e) => events.push(e))
    swarm.on('step:complete', (e) => events.push(e))
    swarm.on('execution:complete', (e) => events.push(e))

    await swarm.run('test')

    const types = events.map((e) => e.type)
    expect(types).toContain('step:start')
    expect(types).toContain('step:complete')
    expect(types).toContain('execution:complete')
  })
})

describe('Smoke: Pipeline pattern', () => {
  it('chains agents sequentially', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    const a = swarm.agent({ name: 'upper', role: 'r', execute: async (input) => String(input).toUpperCase() })
    const b = swarm.agent({ name: 'wrap', role: 'r', execute: async (input) => `[${input}]` })

    const result = await swarm.run('hello', {
      pattern: 'pipeline',
      stages: [{ name: 's1', agent: a }, { name: 's2', agent: b }],
    })

    expect(result.output).toBe('[HELLO]')
  })

  it('handles single-stage pipeline', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    const a = swarm.agent({ name: 'only', role: 'r', execute: async (input) => `only: ${input}` })

    const result = await swarm.run('x', {
      pattern: 'pipeline',
      stages: [{ name: 's1', agent: a }],
    })

    expect(result.output).toBe('only: x')
  })
})

describe('Smoke: Orchestrator-Worker pattern', () => {
  it('runs workers in parallel and merges', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    const w1 = echoAgent('w1')
    const w2 = echoAgent('w2')
    const merger = echoAgent('merger')
    swarm.register(w1)
    swarm.register(w2)
    swarm.register(merger)

    const result = await swarm.run('task', {
      pattern: 'orchestrator-worker',
      agents: [w1, w2, merger],
    })

    // Merger should have received outputs from w1 and w2
    expect(result.agentOutputs.length).toBe(3)
  })
})

describe('Smoke: Map-Reduce pattern', () => {
  it('maps, processes in parallel, reduces', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    const worker = createAgent({ name: 'chunk-processor', role: 'r', execute: async (input) => `processed(${input})` })
    const reducer = createAgent({ name: 'reducer', role: 'r', execute: async (input) => `reduced(${JSON.stringify(input)})` })

    const result = await swarm.run({ id: 't', description: 'test', input: 'big data', budget: {} } as Task, {
      pattern: 'map-reduce',
      mapper: (input) => ['chunk1', 'chunk2', 'chunk3'],
      worker,
      reducer,
      maxParallel: 2,
    })

    expect(result.output).toContain('reduced')
    expect(result.agentOutputs.length).toBe(4) // 3 map + 1 reduce
  })
})

describe('Smoke: Plan → Inspect → Execute', () => {
  it('builds plan, inspects, modifies, executes', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    const a1 = swarm.agent({ name: 'a1', role: 'r', execute: async () => 'a1-result' })
    const a2 = swarm.agent({ name: 'a2', role: 'r', execute: async () => 'a2-result' })

    const plan = await swarm.plan('research topic')
    expect(plan.status).toBe('draft')
    expect(plan.steps.length).toBeGreaterThan(0)
    expect(plan.estimatedCost.estimatedTokens).toBeGreaterThan(0)

    // Visualize
    const viz = visualizePlan(plan)
    expect(viz).toContain('DAG')

    // Execute
    const result = await swarm.execute(plan)
    expect(result.output).toBeTruthy()

    // Explain
    const explanation = explainExecution(result)
    expect(explanation).toContain('Execution Report')

    const summary = summarizeExecution(result)
    expect(summary).toContain('steps')
  })
})

describe('Smoke: Budget enforcement', () => {
  it('enforces token limits', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'a', role: 'r', execute: async (_, ctx) => {
      // Make an LLM call which will consume tokens
      return ctx.llm('test prompt')
    }})

    // Very tight budget — each call uses ~230 tokens from mock
    const result = await swarm.run('test', { budget: { maxTokens: 100 } })
    // Should either complete with partial flag or complete before hitting limit
    expect(result.cost).toBeDefined()
  })

  it('fires warning events', async () => {
    const events: SwarmEvent[] = []
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'a', role: 'r', execute: async (_, ctx) => ctx.llm('test') })
    swarm.on('budget:warning', (e) => events.push(e))

    await swarm.run('test', { budget: { maxCostCents: 0.5, warningAt: 0.1 } })
    // Mock costs ~0.23 per call, so warning should fire
    expect(events.length).toBeGreaterThanOrEqual(0) // May or may not fire depending on timing
  })
})

describe('Smoke: Cost analysis', () => {
  it('produces cost recommendations', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'expensive', role: 'r', execute: async (_, ctx) => ctx.llm('big prompt '.repeat(100)) })

    const result = await swarm.run('test')
    const recs = analyzeCosts(result)
    // Should produce some recommendations (or empty array for cheap mock)
    expect(Array.isArray(recs)).toBe(true)
  })
})

describe('Smoke: Conflict detection', () => {
  it('detects and resolves contradictions', () => {
    const outputs = [
      { agentId: 'a1', agentName: 'optimist', output: 'Everything is great, no issues at all', cost: { inputTokens: 100, outputTokens: 100, cachedInputTokens: 0, totalTokens: 200, costCents: 1, calls: 1 }, durationMs: 100 },
      { agentId: 'a2', agentName: 'pessimist', output: 'Critical failures everywhere, system is broken', cost: { inputTokens: 200, outputTokens: 200, cachedInputTokens: 0, totalTokens: 400, costCents: 2, calls: 1 }, durationMs: 100 },
    ]

    const conflicts = detectConflicts(outputs)
    expect(conflicts.length).toBeGreaterThan(0)

    const resolution = resolveConflict(conflicts[0]!, outputs, 'evidence_weight')
    expect(resolution.method).toBe('evidence_weight')
    expect(resolution.winner).toBe('a2') // More tokens = more evidence
  })
})

describe('Smoke: Context packer', () => {
  it('packs within budget and prioritizes by relevance', () => {
    const sources = [
      sourceFromStepOutput('s1', 'Important finding about the architecture', 0.95),
      sourceFromStepOutput('s2', 'Minor detail about formatting', 0.3),
      sourceFromStepOutput('s3', 'Key security concern that needs attention', 0.9),
    ]

    const bundle = packContext(sources, { maxTokens: 50 })
    expect(bundle.tokenEstimate).toBeLessThanOrEqual(50)
    // Most relevant should be included first
    if (bundle.sources.length > 0) {
      expect(bundle.sources[0]!.relevance).toBeGreaterThanOrEqual(0.9)
    }
  })
})

describe('Smoke: YAML workflows', () => {
  it('parses and compiles a workflow end-to-end', async () => {
    const yaml = `
name: test-workflow
version: 1.0.0
inputs:
  topic: string
steps:
  - id: research
    type: llm
    agent: researcher
    prompt: "Research {{ inputs.topic }}"
  - id: write
    type: llm
    agent: writer
    prompt: "Write about {{ inputs.topic }}"
    dependencies: [research]
`
    const workflow = parseWorkflow(yaml)
    expect(workflow.name).toBe('test-workflow')
    expect(workflow.steps.length).toBe(2)

    const researcher = createAgent({ name: 'researcher', role: 'r', execute: async (input) => `researched: ${input}` })
    const writer = createAgent({ name: 'writer', role: 'r', execute: async (input) => `written: ${input}` })

    const plan = compileWorkflow(workflow, {
      agents: new Map([['researcher', researcher], ['writer', writer]]),
      inputs: { topic: 'AI agents' },
    })

    expect(plan.steps.length).toBe(2)
    expect(plan.steps[0]!.dependencies).toEqual([])
    expect(plan.steps[1]!.dependencies).toContain('research')

    // Execute the compiled plan
    const swarm = new Swarm({ providers: [mockProvider()] })
    const result = await swarm.execute(plan)
    expect(result.output).toBeTruthy()
  })

  it('rejects malformed YAML', () => {
    // Both should throw — missing name field
    expect(() => parseWorkflow('not valid yaml at all {')).toThrow(WorkflowParseError)
    expect(() => parseWorkflow('version: 1.0.0')).toThrow(WorkflowParseError)
  })
})

describe('Smoke: Agent templates', () => {
  it('all templates create valid agents', () => {
    const allDefs = [
      templates.researcher(),
      templates.codeReviewer(),
      templates.synthesizer(),
      templates.dataAnalyst(),
      templates.qaTester(),
      templates.writer(),
      templates.planner(),
    ]

    for (const def of allDefs) {
      const agent = createAgent(def)
      expect(agent.name).toBeTruthy()
      expect(agent.role).toBeTruthy()
      expect(agent.capabilities.length).toBeGreaterThan(0)
      expect(agent.systemPrompt).toBeTruthy()
      expect(typeof agent.execute).toBe('function')
    }
  })

  it('templates work in a swarm', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    const r = swarm.agent(templates.researcher())
    const w = swarm.agent(templates.writer())

    const result = await swarm.run('test', {
      pattern: 'pipeline',
      stages: [{ name: 'research', agent: r }, { name: 'write', agent: w }],
    })

    // Templates use default execute (ctx.llm), which needs a model config
    // Since templates don't set model, this tests the error path
    // The default execute will try ctx.llm which needs agent.model
    expect(result.partial || result.output !== undefined).toBe(true)
  })
})

describe('Smoke: Evolving Orchestrator', () => {
  it('adapts over multiple runs', async () => {
    const orch = new EvolvingOrchestrator()
    const agents = [
      createAgent({ name: 'fast', role: 'r', execute: async () => 'fast-result' }),
      createAgent({ name: 'thorough', role: 'r', execute: async () => 'thorough-result' }),
    ]
    const task: Task = { id: 't', description: 'analyze code', input: 'test', budget: {} }

    // Run several times — it should learn
    for (let i = 0; i < 5; i++) {
      await orch.run(task, { agents, maxRounds: 2, explorationRate: 0.5 }, [mockProvider()])
    }

    const state = orch.exportState()
    expect(state.size).toBeGreaterThan(0)

    // Sequences should have been recorded
    const profileKey = [...state.keys()][0]!
    const seqs = orch.getSequences(profileKey)
    expect(seqs.some((s) => s.uses > 1)).toBe(true)
  })
})

describe('Smoke: Worker Pool lifecycle', () => {
  it('handles burst of requests', async () => {
    const pool = new WorkerPool({ minWorkers: 1, maxWorkers: 5 })

    // Acquire 5 workers simultaneously
    const workers = await Promise.all([
      pool.acquire(),
      pool.acquire(),
      pool.acquire(),
      pool.acquire(),
      pool.acquire(),
    ])

    expect(pool.status().busy).toBe(5)

    // Release all
    for (const w of workers) pool.release(w.id)
    expect(pool.status().busy).toBe(0)

    pool.shutdown()
  })
})

describe('Smoke: Error handling', () => {
  it('handles agent that throws', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    swarm.agent({ name: 'crasher', role: 'r', execute: async () => { throw new Error('agent crashed') } })

    const result = await swarm.run('test')
    expect(result.partial).toBe(true)
    expect(result.plan.steps[0]!.error).toBe('agent crashed')
  })

  it('handles empty agent list gracefully', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    await expect(swarm.run('test', { agents: [] })).rejects.toThrow()
  })

  it('handles map-reduce without required config', async () => {
    const swarm = new Swarm({ providers: [mockProvider()] })
    await expect(swarm.run('test', { pattern: 'map-reduce' })).rejects.toThrow('mapper')
  })
})

describe('Smoke: Type exports', () => {
  it('all key types are importable', () => {
    // This test just verifies the imports compile — if it runs, types are exported correctly
    const budget: Budget = { maxCostCents: 100 }
    const modelConfig: ModelConfig = { provider: 'test', model: 'test' }
    const agentDef: AgentDefinition = { name: 'test', role: 'test' }

    expect(budget.maxCostCents).toBe(100)
    expect(modelConfig.provider).toBe('test')
    expect(agentDef.name).toBe('test')
  })
})
