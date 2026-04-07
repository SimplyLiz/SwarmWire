# SwarmWire

[![npm version](https://img.shields.io/npm/v/swarmwire.svg)](https://www.npmjs.com/package/swarmwire)
[![CI](https://github.com/SimplyLiz/SwarmWire/actions/workflows/ci.yml/badge.svg)](https://github.com/SimplyLiz/SwarmWire/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5+-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-Community-orange.svg)](./LICENSE)

**Multi-agent orchestration library for TypeScript.** Budget-first. Library, not framework.

Coordinate LLM agents through typed, composable patterns — with hard cost limits, conflict resolution, and adaptive routing. Works standalone or with [ANCS](https://github.com/SimplyLiz/ancs) as its memory backend.

```bash
npm install swarmwire
```

---

## Quick Start

```bash
npm install swarmwire
```

```typescript
import { Swarm, createProvider } from 'swarmwire'

const swarm = new Swarm({
  providers: [
    createProvider('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY }),
  ],
  budget: { maxCostCents: 100 },
})

// Create agents
const researcher = swarm.agent({
  name: 'researcher',
  role: 'Research topics thoroughly',
  model: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260320' },
})

const writer = swarm.agent({
  name: 'writer',
  role: 'Write clear summaries',
  model: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260320' },
})

// Run
const result = await swarm.run('Research TypeScript ORMs and recommend one', {
  pattern: 'pipeline',
  stages: [
    { name: 'research', agent: researcher },
    { name: 'write', agent: writer },
  ],
  budget: { maxCostCents: 50 },
})

console.log(result.output)
console.log(`Cost: ${result.cost.totalCostCents}c | Tokens: ${result.cost.totalTokens}`)
```

---

## Why SwarmWire

| Problem | SwarmWire's Answer |
|---------|-------------------|
| **Token bleeding** — AutoGen/CrewAI loops burn money silently | Budget is a hard constraint. Structurally impossible to exceed. |
| **Ceiling trap** — easy frameworks (CrewAI) can't scale, powerful ones (LangGraph) are complex from day one | Progressive disclosure: one-liner to full DAG control. |
| **Framework lock-in** — Mastra/LangGraph own your app | Library. You call it. No lifecycle hooks, no app structure. |
| **No TypeScript** — most frameworks are Python-first | TypeScript-native. Not a port. |
| **Stateless agents** — every run starts from zero | Pluggable memory backends. ANCS for persistent cognitive memory. |
| **No cost visibility** — no framework tracks cost as a first-class metric | Per-agent, per-provider, per-step cost breakdown on every execution. |

---

## Intelligent Capabilities

### Self-Learning Memory
Pattern-based learning with Elastic Weight Consolidation (EWC) to prevent catastrophic forgetting.

```typescript
import { createSelfLearningMemory } from 'swarmwire'

const memory = createSelfLearningMemory({
  backend: ancsMemory({ url: 'http://localhost:3000' }),
  learningRate: 0.1,
  ewcStrength: 0.9,
})
```

### Vector Memory
HNSW-like approximate nearest neighbor search for semantic retrieval.

```typescript
import { createVectorMemory, mockEmbeddingFunction } from 'swarmwire'

const vectorMem = createVectorMemory({
  embedFn: mockEmbeddingFunction, // Or connect to actual embedding model
  efSearch: 10,
})
```

### 3-Tier Model Routing
Automatically routes tasks to appropriate model complexity (cheap/standard/premium).

```typescript
import { routeTaskToModel, defaultModelRoutingConfig } from 'swarmwire'

const decision = routeTaskToModel(task, availableModels, defaultModelRoutingConfig)
// decision.tier, decision.estimatedCostCents, decision.estimatedLatencyMs
```

### Token Optimization
Pattern caching, prompt compression, optimal batching (30-50% token savings).

```typescript
import { createTokenOptimizer } from 'swarmwire'

const optimizer = createTokenOptimizer({ memoryBackend })
const { context, tokensSaved } = await optimizer.getCompactContext(query)
const { optimized, tokensSaved } = await optimizer.optimizePrompt(prompt)
```

### Knowledge Graph
PageRank-based importance calculation, graph-enhanced ranked retrieval.

```typescript
import { createKnowledgeGraph } from 'swarmwire'

const graph = createKnowledgeGraph()
graph.addNode('task-1', 'API design', 'task')
graph.addNode('agent-1', 'API designer', 'agent')
graph.addEdge('task-1', 'agent-1', 'executed_by', 1.0)
graph.calculatePageRank()
```

---

## Enterprise-Grade Security

### Threat Detection
SQL injection, command injection, XSS, path traversal, hardcoded secrets.

```typescript
import { createThreatDetector, defaultThreatConfig } from 'swarmwire'

const detector = createThreatDetector({
  checkSqlInjection: true,
  checkCommandInjection: true,
  autoSanitize: true,
})

const result = detector.scan(userInput)
// result.level: 'safe' | 'warning' | 'threat'
// result.detectedPatterns[]
```

### PII Detection
Email, SSN, phone, credit card, IP address detection.

```typescript
const piiFindings = detector.detectPII(input)
// [{ type: 'email', value: 'user@example.com' }, ...]
```

---

## Spec-Driven Development

### ADR Framework
Architecture Decision Records with Markdown serialization.

```typescript
import { createADRFramework, COMMON_ADRS } from 'swarmwire'

const adr = createADRFramework()
adr.create(COMMON_ADRS.modelRouting())
adr.get('ADR-002')
adr.checkCompliance('ADR-002', codeString)
```

---

## Background Workers

Continuous optimization (memory consolidation, pattern learning, metrics, health checks).

```typescript
import { createWorkerSystem, createMemoryOptimizationWorker } from 'swarmwire'

const workers = createWorkerSystem({ memoryBackend })
workers.registerWorker(...createMemoryOptimizationWorker())
workers.startAll()
```

---

## Agent Templates (17 Specialized Agents)

Ready-to-use agents:

```typescript
import { Swarm, templates } from 'swarmwire'

const swarm = new Swarm({ providers })

// 7 original templates
const researcher = swarm.agent(templates.researcher())
const reviewer   = swarm.agent(templates.codeReviewer())
const synth      = swarm.agent(templates.synthesizer())
const analyst    = swarm.agent(templates.dataAnalyst())
const tester     = swarm.agent(templates.qaTester())
const writer     = swarm.agent(templates.writer())
const planner    = swarm.agent(templates.planner())

// 10 new specialized agents
const security   = swarm.agent(templates.securityAuditor())
const devops     = swarm.agent(templates.devopsEngineer())
const dbEngineer = swarm.agent(templates.databaseEngineer())
const apiDesigner= swarm.agent(templates.apiDesigner())
const perfEngine = swarm.agent(templates.performanceEngineer())
const docs       = swarm.agent(templates.documentationSpecialist())
const architect  = swarm.agent(templates.architectureAdvisor())
const debugger   = swarm.agent(templates.debugger())
const refactor   = swarm.agent(templates.refactoringSpecialist())
const integration= swarm.agent(templates.integrationSpecialist())
const testAuto   = swarm.agent(templates.testAutomationEngineer())
```

---

## Orchestration Patterns

### Orchestrator-Worker (default)
Workers run in parallel, synthesizer merges results.
```typescript
await swarm.run(task, {
  pattern: 'orchestrator-worker',
  agents: [researcher, analyst, synthesizer],
})
```

### Pipeline
Sequential stages — each agent's output feeds the next.
```typescript
await swarm.run(task, {
  pattern: 'pipeline',
  stages: [
    { name: 'classify', agent: classifier },
    { name: 'process', agent: processor },
    { name: 'review', agent: reviewer },
  ],
})
```

### Map-Reduce
Split input, process chunks in parallel, reduce.
```typescript
await swarm.run(task, {
  pattern: 'map-reduce',
  mapper: (input) => splitIntoChunks(input, 10),
  worker: analyzerAgent,
  reducer: summarizerAgent,
  maxParallel: 5,
})
```

### Debate
Agents argue positions, a judge resolves.
```typescript
import { runDebate } from 'swarmwire'

await runDebate(task, {
  pattern: 'debate',
  proponents: [optimist, pessimist],
  judge: judgeAgent,
  rounds: 3,
  convergenceThreshold: 0.85,
}, providers, budget)
```

### Blackboard
Shared state space with iterative refinement.
```typescript
import { runBlackboard } from 'swarmwire'

await runBlackboard(task, {
  pattern: 'blackboard',
  agents: [dataAgent, modelAgent, vizAgent],
  rounds: 5,
  convergence: (state) => state.merged.qualityScore > 0.9,
}, providers, budget)
```

### Fan-Out
Same input, N agents, all parallel. Promise.allSettled for agents.
```typescript
import { runFanOut } from 'swarmwire'

const result = await runFanOut(task, {
  agents: [reviewer1, reviewer2, reviewer3],
  input: codeToReview,
  optional: true,  // individual failures don't kill the batch
}, providers, budget)
// result.output = [output1, output2, output3]
```

### Evolving Orchestration
Adaptive agent sequencing that learns from execution traces.
```typescript
import { EvolvingOrchestrator } from 'swarmwire'

const orch = new EvolvingOrchestrator()
const result = await orch.run(task, {
  agents: [researcher, analyst, coder, reviewer],
  maxRounds: 10,
  explorationRate: 0.15,
}, providers)
```

---

## Budget Engine

Every operation has a budget. Hard limits, not advisory.

```typescript
const result = await swarm.run(task, {
  budget: {
    maxTokens: 100_000,      // Hard token cap
    maxCostCents: 150,        // Hard cost cap
    maxLatencyMs: 30_000,     // Wall-clock deadline
    maxAgents: 5,             // Concurrency cap
    warningAt: 0.8,           // Fire event at 80%
  },
})

// Detailed cost breakdown
result.cost.perAgent       // Map<agentName, { tokens, costCents, calls }>
result.cost.perProvider    // Map<providerName, { tokens, costCents, cacheHits }>
result.cost.budgetUsed     // 0-1 fraction consumed
```

If budget is exhausted mid-execution: running steps complete, no new steps start, best-effort partial result returned.

---

## Agent Templates

Ready-to-use agents with sensible defaults:

```typescript
import { Swarm, templates } from 'swarmwire'

const swarm = new Swarm({ providers })

const researcher = swarm.agent(templates.researcher())
const reviewer   = swarm.agent(templates.codeReviewer())
const synth      = swarm.agent(templates.synthesizer())
const analyst    = swarm.agent(templates.dataAnalyst())
const tester     = swarm.agent(templates.qaTester())
const writer     = swarm.agent(templates.writer())
const planner    = swarm.agent(templates.planner())

// Override anything
const cheapResearcher = swarm.agent(templates.researcher({
  modelTier: 'cheap',
  maxCostCents: 5,
}))
```

---

## YAML Workflows

CI/CD-style workflow definitions:

```yaml
name: research-and-summarize
version: 1.0.0

inputs:
  topic: string
  depth: string

steps:
  - id: research
    type: llm
    agent: researcher
    prompt: "Research: {{ inputs.topic }}"

  - id: summarize
    type: llm
    agent: writer
    prompt: "Summarize findings about {{ inputs.topic }}"
    dependencies: [research]
```

```typescript
import { parseWorkflow, compileWorkflow } from 'swarmwire'

const workflow = parseWorkflow(yamlString)
const plan = compileWorkflow(workflow, {
  agents: new Map([['researcher', researcher], ['writer', writer]]),
  inputs: { topic: 'TypeScript ORMs', depth: 'thorough' },
})

const result = await swarm.execute(plan)
```

---

## Plan → Inspect → Execute

Don't run blind. Preview the plan, modify it, then execute.

```typescript
const plan = await swarm.plan('Analyze our auth architecture')

console.log(plan.estimatedCost)        // Preview cost
console.log(visualizePlan(plan))       // ASCII DAG

plan.steps[1].agent = alternateAgent   // Swap an agent
plan.steps[2].optional = true          // Make a step optional

const result = await swarm.execute(plan)
console.log(explainExecution(result))  // Full human-readable report
console.log(summarizeExecution(result)) // One-line summary
```

---

## Provider Infrastructure

### Multi-Provider with Failover
```typescript
import { createProvider, withCircuitBreaker, withFailover, withRateLimit } from 'swarmwire'

const anthropic = withRateLimit(
  withCircuitBreaker(createProvider('anthropic', { apiKey: '...' })),
  { requestsPerMinute: 50 },
)

const openai = withRateLimit(
  withCircuitBreaker(createProvider('openai', { apiKey: '...' })),
  { requestsPerMinute: 60 },
)

// Automatic failover when primary circuit trips
const provider = withFailover([anthropic, openai])
```

### Cost Optimization
```typescript
import { analyzeCosts } from 'swarmwire'

const recommendations = analyzeCosts(result)
// [
//   { type: 'tier_downgrade', description: 'Agent "researcher" used 500 tokens but cost 15c...', estimatedSavingsCents: 9 },
//   { type: 'caching', description: 'Only 5% cache hit rate...', estimatedSavingsCents: 12 },
// ]
```

---

## Protocol Support

### MCP — Agent-to-Tool
```typescript
import { loadMcpTools } from 'swarmwire'

const tools = await loadMcpTools('npx @some/mcp-server')
const agent = swarm.agent({ name: 'tooled', role: '...', tools })
```

### A2A — Agent-to-Agent
```typescript
import { startA2AServer, importA2AAgent } from 'swarmwire'

// Expose your agents
startA2AServer({ port: 8080, agents: [researcher, analyst] })

// Consume external agents
const externalAgent = await importA2AAgent({ url: 'https://partner.api' })
swarm.register(externalAgent)
```

---

## Memory Backends

### Without Memory (default)
Every execution is stateless. Results returned and forgotten.

### With CognitiveVault
Persist agent messages across sessions and processes. Agents in different SwarmWire executions — or even MCP tools like Claude Code — see each other's work.

```typescript
import { Swarm } from 'swarmwire'
import { CognitiveVaultBoard } from 'swarmwire/adapters'

const board = new CognitiveVaultBoard({
  apiUrl: 'https://cognitive-vault.com',
  apiKey: process.env.CV_API_KEY!,
  vaultId: 'vault-123',
})
await board.hydrate() // catch up on prior messages

const swarm = new Swarm({ providers, board })
// All agent messages now persist to CognitiveVault
```

Falls back to local file (`.swarmwire/board.jsonl`) when CV is unreachable. See [CognitiveVault integration guide](./docs/cognitive-vault-integration.md).

### With ANCS
Persistent cognitive memory with truth tracking, entity graphs, and importance decay. ANCS can run alongside CognitiveVault as its knowledge intelligence backend.
```typescript
import { Swarm, ancsMemory } from 'swarmwire'

const swarm = new Swarm({
  providers,
  memory: ancsMemory({
    url: 'http://localhost:3100',
    tenantId: 'my-project',
  }),
})
```

---

## Observability

### Events
```typescript
swarm.on('step:start', (e) => console.log(`Starting ${e.agentName}`))
swarm.on('step:complete', (e) => console.log(`Done: ${e.durationMs}ms, ${e.costCents}c`))
swarm.on('budget:warning', (e) => console.log(`Budget at ${(e.usage * 100).toFixed(0)}%`))
swarm.on('conflict:detected', (e) => console.log(`Conflict: ${e.conflict}`))
```

### Streaming
```typescript
for await (const event of swarm.stream(task)) {
  console.log(event.type, event)
}
```

### Execution Reports
```typescript
import { explainExecution, summarizeExecution } from 'swarmwire'

console.log(summarizeExecution(result))
// [OK] 3/3 steps | 2.1s | 42.70c | 47.8k tokens

console.log(explainExecution(result))
// Full report: steps, cost breakdown, trace, conflicts
```

### SSE Streaming (Web)

Pipe agent execution to HTTP clients via Server-Sent Events. Works with Express, Fastify, Next.js, or native http. See [docs/sse-streaming.md](./docs/sse-streaming.md) for full recipes.

```typescript
import { sseHeaders, pipeToSSE } from 'swarmwire/transport'

app.get('/api/run', async (req, res) => {
  sseHeaders(res)
  const result = await pipeToSSE(swarm.stream('Analyze codebase'), res)
  res.end()
})
```

```javascript
// Client
const source = new EventSource('/api/run')
source.addEventListener('step:complete', (e) => {
  const { agentName, costCents } = JSON.parse(e.data)
  console.log(`${agentName} done: ${costCents}c`)
})
source.addEventListener('result', (e) => {
  console.log('Output:', JSON.parse(e.data).output)
  source.close()
})
```

---

## MessageBoard (Inter-Agent Communication)

Agents can communicate ad-hoc during execution through a shared MessageBoard,
accessible via `ctx.board` inside any agent's `execute()` function. This sits
alongside the structured DAG data flow and enables direct messages, broadcasts,
topic-based channels, and priority signals.

```typescript
async execute(input: string, ctx: AgentContext) {
  // Read findings from other agents
  const findings = ctx.board.findings()

  // Broadcast a discovery
  ctx.board.post('*', 'Found a critical issue in auth module', {
    type: 'finding',
    priority: 'urgent',
    data: { file: 'auth.ts', line: 42 },
  })

  // Ask a specific agent
  ctx.board.post('security-expert', 'Is this a real vulnerability?', {
    type: 'question',
  })

  // Read inbox
  const messages = ctx.board.inbox()
}
```

Message types: `finding`, `warning`, `question`, `answer`, `coordination`, `status`, `custom`.

**Persistence options:** The default `MessageBoard` is in-memory only. Use `FileBoard` for local persistence or `CognitiveVaultBoard` for cross-machine, cross-session durability. See [Adapters](./docs/adapters.md).
Priorities: `normal`, `high`, `urgent`.

The full `MessageBoard` class is also available standalone:

```typescript
import { MessageBoard } from 'swarmwire'

const board = new MessageBoard(10_000) // max messages
board.post('agent-a', '*', 'Hello everyone', { type: 'status' })
board.stats() // { totalMessages, channels, byType, byAgent, byPriority }
```

---

## Routing Stack

SwarmWire includes a 5-layer cost-optimization routing stack that can cut LLM
API spend by 40-85% with minimal quality loss. Each layer works independently
or combined. See [docs/routing.md](./docs/routing.md) for full details.

| Layer | Component | What it does |
|-------|-----------|-------------|
| 1 | **SemanticCache** | Embeds queries as vectors, returns cached responses on near-duplicate hits (zero cost). |
| 2 | **LatencyRouter** | Picks the fastest model meeting quality/cost constraints via EMA + P95 latency tracking. |
| 3 | **CascadeRouter** | Tries cheapest model first, escalates if quality is below threshold. Bandit learning over time. |
| 4 | **SpeculativeCascade** | Runs N models in parallel, accepts cheapest that passes quality. Trades cost for latency. |
| 5 | **QueryDecomposer** | Breaks multi-part queries into subtasks, routes each to the cheapest model at its complexity tier. |

```typescript
import {
  SemanticCache,
  LatencyRouter,
  CascadeRouter,
  speculativeCascade,
  decomposeQuery,
  executeDecomposed,
  buildModelLadder,
} from 'swarmwire'
```

---

## Guardrails

Input, output, and tool-level safety checks with fail-fast tripwires. Inspired by
OpenAI Agents SDK. Guardrails run in `parallel` (default, lower latency) or
`blocking` (sequential, safer) mode. A `block`-severity failure throws
`GuardrailTripped` and cancels execution immediately; `warn` severity logs and
continues. Sanitization guardrails can modify the value in flight.

```typescript
import {
  piiGuardrail,
  injectionGuardrail,
  hallucinationGuardrail,
  maxLengthGuardrail,
  contentFilter,
} from 'swarmwire'

const agent = swarm.agent({
  name: 'safe-agent',
  role: 'Process user input safely',
  guardrails: {
    input: [piiGuardrail(), injectionGuardrail()],
    output: [hallucinationGuardrail(), maxLengthGuardrail(10_000)],
    toolInput: [contentFilter(['DROP TABLE', 'rm -rf'], 'block')],
  },
})
```

Built-in guardrails:

| Guardrail | Phase | What it checks |
|-----------|-------|---------------|
| `piiGuardrail()` | input | Emails, SSNs, credit cards, phone numbers |
| `injectionGuardrail()` | input | "Ignore previous instructions" and similar injection patterns |
| `hallucinationGuardrail()` | output | Hedging markers ("as of my knowledge cutoff", etc.) |
| `maxLengthGuardrail(n)` | output | Truncates output exceeding `n` chars (warn + sanitize) |
| `contentFilter(strings[], severity)` | any | Blocks or warns on forbidden substrings |

Custom guardrails implement the `Guardrail<T>` interface with a `check(value, context)` method.

---

## Evals Framework

Automated quality metrics for agent outputs. Run evals against Record/Replay
fixtures in CI/CD -- no LLM calls needed.

```typescript
import {
  runEvalSuite,
  nonEmpty,
  lengthCheck,
  containsKeywords,
  schemaMatch,
  similarityToExpected,
  noRegression,
  noHallucination,
} from 'swarmwire'

const suite = {
  name: 'research-quality',
  evals: [nonEmpty(), lengthCheck(100, 5000), containsKeywords(['TypeScript', 'ORM']), noHallucination()],
  threshold: 0.8,          // average score must be >= 0.8
  perEvalThreshold: 0.5,   // no individual eval below 0.5
}

const result = await runEvalSuite(suite, input, output, { expected: groundTruth })
// result.passed, result.averageScore, result.failedEvals
```

Built-in metrics: `nonEmpty`, `lengthCheck`, `containsKeywords`, `schemaMatch`,
`similarityToExpected` (Jaccard), `noRegression` (compare to prior run),
`noHallucination`. All return 0-1 scores. `runEvalBatch` runs a suite against
multiple test cases and reports an overall pass/fail.

---

## Record/Replay Testing

Deterministic, zero-cost testing for multi-agent systems. Record real LLM
interactions once, then replay them in CI forever -- instant, free, and
reproducible. Fuzzy matching handles volatile fields (UUIDs, timestamps).

```typescript
import { RecordingProvider, ReplayProvider } from 'swarmwire'

// 1. Record: wrap a real provider, run your workflow, save fixtures
const recording = new RecordingProvider(realProvider, './fixtures/research.json')
await swarm.run('Research TypeScript ORMs', { /* uses recording as provider */ })
await recording.save()   // writes fixture file to disk

// 2. Replay: load fixtures, run the same workflow with zero LLM calls
const replay = new ReplayProvider('./fixtures/research.json')
const result = await swarm.run('Research TypeScript ORMs', { /* uses replay */ })

// 3. Assert: combine with evals
const evalResult = await runEvalSuite(suite, input, result.output)
expect(evalResult.passed).toBe(true)
```

`ReplayProvider` options: `strict` (throw on unmatched requests, default `true`),
`fallback` (a real provider for partial replay), `simulatedLatencyMs`.

---

## New Providers

### Gemini
Uses Google's OpenAI-compatible endpoint. Models: `gemini-2.0-flash`, `gemini-2.5-pro`, `gemini-2.5-flash`.
```typescript
const gemini = createProvider('gemini', { apiKey: process.env.GOOGLE_API_KEY })
```

### Ollama (local)
Local execution via Ollama's OpenAI-compatible API. Cost is always $0.
Default models: `llama3.3`, `qwen3`, `deepseek-r1`.
```typescript
const ollama = createProvider('ollama')  // defaults to localhost:11434
```

### Generic OpenAI-compatible / LiteLLM
Any unknown provider name falls through to the OpenAI adapter. Works with LiteLLM,
vLLM, Azure OpenAI, or any endpoint that speaks the OpenAI chat completions API.
```typescript
const litellm = createProvider('litellm', {
  baseUrl: 'http://localhost:4000/v1',
  apiKey: process.env.LITELLM_KEY,
})
```

---

## Approval Gates

Pause execution before a step and wait for human (or programmatic) approval.
If no `onApproval` callback is provided, gates auto-approve.

```typescript
const plan = await swarm.plan('Deploy to production')

// Add a gate to the deploy step
plan.steps[2].gate = {
  type: 'approval',
  message: 'Approve deployment to prod?',
  timeoutMs: 60_000,
}

const result = await swarm.execute(plan, {
  onApproval: async (gate) => {
    console.log(`[GATE] ${gate.agentName}: ${gate.message}`)
    return userSaidYes ? 'approved' : 'rejected'
  },
})
```

---

## Dry-Run Cost Projection

Simulate plan execution without calling any LLMs. Returns cost/duration estimates
with min/max/likely ranges, per-step breakdowns, parallelism analysis, and a
`willExceedBudget` flag.

```typescript
import { dryRun } from 'swarmwire'

const plan = await swarm.plan('Analyze codebase')
const projection = dryRun(plan, providers)

console.log(projection.estimatedCost)
// { minCents: 12.5, maxCents: 50.0, likelyCents: 25.0 }
console.log(projection.willExceedBudget)     // true/false
console.log(projection.stepBreakdown)        // per-step cost + duration
console.log(projection.sequentialDepth)      // critical path length
```

---

## Output Contracts

Schema + semantic validation of agent outputs. Catches syntactically valid but
semantically garbage results. Supports Zod schemas, custom validation functions,
and configurable failure actions (`retry`, `skip`, `fallback`, `escalate`).

```typescript
import { withContract, OutputContract } from 'swarmwire'

const contract: OutputContract<{ summary: string; score: number }> = {
  schema: z.object({ summary: z.string().min(10), score: z.number().min(0).max(1) }),
  validate: async (output) => ({
    valid: output.score > 0.3,
    reason: output.score <= 0.3 ? 'Score too low — likely garbage output' : undefined,
  }),
  onFailure: 'retry',
  maxRetries: 2,
}

const guardedExecute = withContract(agent.execute, contract)
```

Throws `ContractViolationError` when retries are exhausted and `onFailure` is
`'retry'` or `'escalate'`.

---

## Model Cascade on Quality

Per-agent model fallback that escalates to a smarter (more expensive) model when
output quality is too low. Different from circuit breaker (which operates at the
provider level on errors).

```typescript
import { chatWithCascade } from 'swarmwire'

const result = await chatWithCascade(request, {
  primary: { provider: 'anthropic', model: 'claude-haiku-4-20250414' },
  fallbacks: [
    { provider: 'anthropic', model: 'claude-sonnet-4-6-20260320', condition: 'quality' },
    { provider: 'openai', model: 'gpt-4o', condition: 'both' },
  ],
  qualityThreshold: 0.6,
  qualityEstimator: myQualityFn,
}, providerMap)

// result.escalated, result.modelUsed, result.modelsAttempted
```

---

## Differential Execution

Only re-run steps whose inputs changed. Compares a new plan against a previous
`ExecutionResult`, identifies changed/reusable/cascade steps, and carries forward
completed outputs.

```typescript
import { diffPlans, applyPreviousResults } from 'swarmwire'

const diff = diffPlans(newPlan, previousResult)
// diff.changedSteps, diff.reusableSteps, diff.cascadeSteps, diff.savingsFraction

applyPreviousResults(newPlan, previousResult, diff)
const result = await swarm.execute(newPlan)  // skips reusable steps
```

---

## Structured Output

Force the LLM to respond with valid JSON matching a schema. Available via
`ctx.llm<T>()` inside any agent's `execute()` function. Works across providers:
maps to `response_format` on OpenAI/Gemini and tool-use forcing on Anthropic.

```typescript
const agent = swarm.agent({
  name: 'classifier',
  role: 'Classify support tickets',
  async execute(input: string, ctx: AgentContext) {
    return ctx.llm<{ category: string; priority: number }>(input, {
      responseFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: ['bug', 'feature', 'question'] },
            priority: { type: 'number', minimum: 1, maximum: 5 },
          },
          required: ['category', 'priority'],
        },
      },
    })
  },
})
```

---

## Plugin System

Extend SwarmWire with third-party providers, agents, guardrails, evals, tools, and middleware. See [docs/plugins.md](./docs/plugins.md) for full guide.

```typescript
import { Swarm, definePlugin, piiGuardrail, noHallucination } from 'swarmwire'

const securityPlugin = definePlugin({
  name: '@myco/security',
  version: '1.0.0',
  guardrails: {
    input: [piiGuardrail()],
    output: [contentFilter(['internal-only'], 'block')],
  },
  evals: [noHallucination()],
  middleware: {
    async beforeExecute(agentName, input) {
      console.log(`[audit] ${agentName} starting`)
      return input
    },
  },
})

const swarm = new Swarm({ providers })
await swarm.use(securityPlugin)
```

---

## Architecture

```
User Code
    |
    v
  Swarm  ──────────────────────────────────────────────────────────
    |          |           |            |          |          |
  Planner   Router     Executor      Budget    Patterns   Guardrails
  (DAG)    (cascade    (parallel      Engine   (orch-wkr   (input
   |       semantic     runner        (hard     pipeline    output
  Scorer   cache        dry-run       limits)   map-reduce  tool)
   |       latency      diff-exec       |       debate
  Query    specul.)     checkpoint      |       blackboard
  Decomp.  model-       approval        |       evolving)
           cascade      gates)          |
    |          |           |            |          |          |
    v          v           v            v          v          v
  Providers     MessageBoard    MCP Tools     Memory    Testing
  (Anthropic    (inter-agent    (any server)  (ANCS    (Record/Replay
   OpenAI       communication)                or       Evals
   Gemini                                     custom)  Contracts)
   Ollama
   LiteLLM/generic
   +circuit breaker
   +rate limiter
   +failover)
```

---

## Project Stats

86 modules | 34 test files | 299 tests | 7 agent templates | 8 docs

---

## Documentation

| Guide | What it covers |
|-------|---------------|
| [Routing Stack](./docs/routing.md) | 5-layer cost optimization, cascade routing, semantic cache, OTEL export |
| [Eval Workflow](./docs/eval-workflow.md) | Record → Replay → Eval → CI pipeline |
| [SSE Streaming](./docs/sse-streaming.md) | Express, Fastify, Next.js, React recipes |
| [Conflict Resolution](./docs/conflict-resolution.md) | Detection algorithms, resolution strategies |
| [Persistence](./docs/persistence.md) | Checkpoint/resume, differential execution, state management |
| [Adapters](./docs/adapters.md) | Claude Agent SDK, FileBoard, CognitiveVault |
| [Plugins](./docs/plugins.md) | Plugin interface, middleware, publishing |
| [CognitiveVault](./docs/cognitive-vault-integration.md) | CV-backed inter-agent messaging |

---

## License

Free for open source projects, small businesses (under EUR 25,000/year), and personal/educational use. Commercial use above that threshold requires a paid license. See [LICENSE](./LICENSE).
