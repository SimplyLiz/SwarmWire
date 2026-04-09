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

```typescript
import { Swarm, createProvider } from 'swarmwire'

const swarm = new Swarm({
  providers: [
    createProvider('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY }),
  ],
  budget: { maxCostCents: 100 },
})

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
| **Ceiling trap** — easy frameworks can't scale, powerful ones are complex from day one | Progressive disclosure: one-liner to full DAG control. |
| **Framework lock-in** — Mastra/LangGraph own your app | Library. You call it. No lifecycle hooks, no app structure. |
| **No TypeScript** — most frameworks are Python-first | TypeScript-native. Not a port. |
| **Stateless agents** — every run starts from zero | Pluggable memory backends with six memory architectures. |
| **No cost visibility** — no framework tracks cost as a first-class metric | Per-agent, per-provider, per-step cost breakdown on every execution. |

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
  agents: [dataAgent, modelAgent, vizAgent],
  rounds: 5,
  convergence: (state) => state.merged.qualityScore > 0.9,
}, providers, budget)
```

### Fan-Out
Same input, N agents, all parallel.
```typescript
import { runFanOut } from 'swarmwire'

const result = await runFanOut(task, {
  agents: [reviewer1, reviewer2, reviewer3],
  input: codeToReview,
  optional: true,
}, providers, budget)
```

### Hive-Mind
Specialized agents on different knowledge domains, coordinated by a master orchestrator.
```typescript
import { runHiveMind } from 'swarmwire'

await runHiveMind(task, {
  domains: [
    { name: 'frontend', agents: [uiAgent, cssAgent] },
    { name: 'backend', agents: [apiAgent, dbAgent] },
  ],
  orchestrator: plannerAgent,
}, providers, budget)
```

### Hierarchy
Formal authority levels with override semantics. Low-confidence outputs escalate to higher authority.
```typescript
import { runHierarchy } from 'swarmwire'

await runHierarchy(task, {
  levels: [
    { name: 'workers', authority: 3, agents: [worker1, worker2] },
    { name: 'manager', authority: 2, agents: [managerAgent] },
    { name: 'executive', authority: 1, agents: [executiveAgent] },
  ],
  escalationThreshold: 0.6,
  maxEscalations: 2,
}, providers, budget)
```

### Loop Agent
Iterative self-improvement — run an agent repeatedly until convergence.
```typescript
import { runLoop } from 'swarmwire'

const result = await runLoop(draft, {
  agent: refinerAgent,
  provider,
  model,
  maxIterations: 5,
  shouldStop: (output, iter) => qualityScore(output) > 0.9,
  refine: (output) => `Improve this further:\n${output}`,
})
// result.converged, result.iterations, result.history
```

### Graph State Machine
LangGraph-style directed graph with cycles, branching, and conditional routing.
```typescript
import { StateMachine, END } from 'swarmwire'

const machine = new StateMachine({
  nodes: [fetchNode, parseNode, validateNode],
  edges: [
    { from: 'fetch', to: 'parse' },
    { from: 'parse', to: (state) => state.valid ? 'validate' : 'fetch' },
    { from: 'validate', to: END },
  ],
  entryNode: 'fetch',
  maxIterations: 20,
})

const result = await machine.run(initialState)
// result.finalState, result.iterations, result.terminated
```

### Event-Driven Workflows
Runtime-emergent topology — steps subscribe to events rather than a fixed DAG.
```typescript
import { EventFlow } from 'swarmwire'

const flow = new EventFlow({
  steps: [
    {
      name: 'processor',
      handles: ['data.ready'],
      handler: async (event, ctx) => {
        const result = await process(event.payload)
        ctx.emit('data.processed', result)
        return null
      },
    },
  ],
})

await flow.run([{ type: 'data.ready', payload: rawData, timestamp: Date.now() }])
```

### Evolving Orchestration
Adaptive agent sequencing that learns from execution traces via bandit algorithm.
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
    maxTokens: 100_000,
    maxCostCents: 150,
    maxLatencyMs: 30_000,
    maxAgents: 5,
    warningAt: 0.8,
  },
})

result.cost.perAgent       // Map<agentName, { tokens, costCents, calls }>
result.cost.perProvider    // Map<providerName, { tokens, costCents, cacheHits }>
result.cost.budgetUsed     // 0-1 fraction consumed
result.cost.savings        // { promptCachingCents, tierRoutingCents, earlyStopCents }
```

If budget is exhausted mid-execution: running steps complete, no new steps start, best-effort partial result returned.

---

## Memory

Six memory architectures, all implementing the same `MemoryBackend` interface.

### ANCS (Cognitive Vault)
Persistent cognitive memory with truth tracking and importance decay.
```typescript
import { Swarm, ancsMemory } from 'swarmwire'

const swarm = new Swarm({
  providers,
  memory: ancsMemory({ url: 'http://localhost:3100', tenantId: 'my-project' }),
})
```

### Self-Learning Memory (EWC)
Pattern-based learning with Elastic Weight Consolidation to prevent catastrophic forgetting.
```typescript
import { createSelfLearningMemory } from 'swarmwire'

const memory = createSelfLearningMemory({
  backend: ancsMemory({ url: 'http://localhost:3000' }),
  learningRate: 0.1,
  ewcStrength: 0.9,
})
```

### Vector Memory (HNSW-like)
Semantic retrieval with approximate nearest neighbor search.
```typescript
import { createVectorMemory } from 'swarmwire'

const vectorMem = createVectorMemory({ embedFn: myEmbedFn, efSearch: 10 })
```

### A-MEM (Zettelkasten Graph)
Living memory graph — on every write, notes link to related memories automatically. Inspired by the A-MEM paper.
```typescript
import { AMem } from 'swarmwire'

const mem = new AMem({ linkThreshold: 0.4, maxLinks: 10 })
await mem.store('session1', 'TypeScript generics allow type-safe abstractions', {})
await mem.store('session2', 'Generic constraints enforce type relationships', {})

const results = await mem.query('type-safe generics')
const graph = mem.getGraph()       // full adjacency list
const linked = mem.getLinked(id)   // notes linked to a given note
```

### Temporal Memory (CMA)
Memories decay over time and reinforce on access. Spreading activation propagates relevance to temporal neighbors.
```typescript
import { TemporalMemory } from 'swarmwire'

const mem = new TemporalMemory({
  decayRatePerHour: 0.02,
  accessReinforcement: 0.1,
  evictionThreshold: 0.05,
  temporalWindowSize: 3,
  activationDepth: 2,
})

await mem.store('k1', 'important finding about auth', {})
const results = await mem.query('authentication')
mem.consolidate()   // evict weak memories, update strengths
mem.stats()         // { noteCount, avgStrength, oldestMs }
```

### Self-Editing Memory Blocks (Letta-style)
Named, versioned memory blocks that agents can read and mutate mid-execution. Inject via prompt.
```typescript
import { SelfEditingMemory } from 'swarmwire'

const mem = new SelfEditingMemory({
  blocks: [
    { name: 'persona', content: 'You are a helpful assistant.', maxChars: 500 },
    { name: 'goal', content: '', maxChars: 1000 },
  ],
})

// In agent execute():
mem.write('goal', 'Help user debug their TypeScript project')
mem.append('goal', '\nFocus on type errors first.')
mem.patch('goal', 'TypeScript', 'TS')
mem.revert('goal', 1)                // go back to version 1

const ctx = mem.toContextString()    // inject into agent prompt
mem.getHistory('goal')               // full edit log
```

### Episodic Memory
Stores specific past interactions with temporal ordering and tag-based recall.
```typescript
import { EpisodicMemory } from 'swarmwire'

const mem = new EpisodicMemory({ maxEntries: 1000 })
await mem.record({
  sessionId: 'sess-1',
  timestamp: Date.now(),
  description: 'User asked about deployment',
  input: userMessage,
  output: agentResponse,
  success: true,
  durationMs: 1200,
  costCents: 3.5,
  tags: ['deployment', 'infra'],
})

const relevant = await mem.recall('kubernetes deployment', { limit: 5, tags: ['infra'] })
```

### Procedural Memory
Stores "how to" execution procedures with success tracking.
```typescript
import { ProceduralMemory } from 'swarmwire'

const mem = new ProceduralMemory()
await mem.learn({
  name: 'debug-typescript-error',
  goal: 'Fix TypeScript compilation errors',
  steps: [
    { order: 1, action: 'Run tsc --noEmit', output: 'error list' },
    { order: 2, action: 'Read each error and identify the root cause' },
    { order: 3, action: 'Apply fixes starting with the most impactful' },
  ],
  tags: ['typescript', 'debugging'],
})

const procs = await mem.recallFor('fix typescript errors')
await mem.recordOutcome(procs[0].id, true)  // track success rate
```

### External Vector Stores
Production vector database adapters — Pinecone, Qdrant, Redis, or in-process flat store.
```typescript
import {
  createFlatVectorStore,   // no deps, always available
  createPineconeStore,     // peer dep: @pinecone-database/pinecone
  createQdrantStore,       // peer dep: @qdrant/js-client-rest
  createRedisVectorStore,  // peer dep: redis
} from 'swarmwire'

const store = createPineconeStore({
  apiKey: process.env.PINECONE_API_KEY!,
  indexName: 'my-index',
  dimension: 1536,
  embedFn: openAIEmbed,
})

// All adapters implement MemoryBackend
await store.store('doc-1', 'content here', { tags: ['research'] })
const results = await store.query('semantic search query', { maxItems: 5 })
```

### Sleep-Time Compute Agent
LLM-driven background consolidation. During idle periods, synthesizes insights from recent memory.
```typescript
import { SleepTimeAgent } from 'swarmwire'

const agent = new SleepTimeAgent({
  memory,
  provider,
  model: { model: 'claude-haiku-4-5-20251001' },
  reviewWindow: 20,
  evictWeak: true,
})

// Manual pass
const result = await agent.consolidate('recent agent activity')
// result.insightsExtracted, result.itemsForgotten, result.insights

// Periodic background
agent.start(60_000)   // consolidate every minute
agent.stop()
```

---

## Typed Dependency Injection

Agents declare what services they need; `context.deps` is fully typed.

```typescript
import { createAgent } from 'swarmwire'

interface Deps {
  db: Database
  featureFlags: { newUi: boolean }
}

const agent = createAgent<string, string, Deps>({
  name: 'data-agent',
  role: 'Query and summarize data',
  deps: { db: myDatabase, featureFlags: flags },
  execute: async (input, ctx) => {
    const rows = await ctx.deps.db.query(input)  // fully typed
    return summarize(rows)
  },
})
```

---

## Session Management

### Named Sessions
Persistent conversation threads across multiple `swarm.run()` calls.
```typescript
import { SessionManager } from 'swarmwire'

const sessions = new SessionManager({ maxMessages: 20 })
const session = sessions.create('support-ticket-42')

const swarm = new Swarm({ providers, sessions })

// Context from prior turns is prepended automatically
const result = await swarm.runInSession(session.id, 'What was my last question?')
sessions.getContext(session.id)   // formatted history string
```

### Conversation Branching
Fork a session at any message to explore alternative continuations.
```typescript
import { BranchManager } from 'swarmwire'

const branches = new BranchManager()

// Fork after message index 3
const branchA = branches.fork(session, 3, 'alternative-approach')
const branchB = branches.fork(session, 3, 'simpler-approach')

branches.appendMessage(branchA.id, { role: 'user', content: 'Try approach A', timestamp: Date.now() })

// Compare divergence
const { onlyInA, onlyInB } = branches.diff(branchA.id, branchB.id)

// Merge winning branch back
branches.merge(branchA.id, session)

// Full tree visualization
const tree = branches.buildTree(session, allSessions)
```

---

## Execution Control

### Time-Travel Debugging
Rewind to any step and fork execution from there with modifications.
```typescript
import { TimeTravelStore } from 'swarmwire'

const timeTravel = new TimeTravelStore()

// Inject into executor — records a checkpoint after each step
const result = await swarm.execute(plan, { timelineStore: timeTravel })

// Review history
const timeline = timeTravel.getTimeline(plan.id)

// Fork from step 2 with a different agent
const forked = await timeTravel.fork(plan.id, {
  fromStepId: 'step-2',
  modifications: [{ id: 'step-3', agent: alternateAgent }],
}, plan, executorConfig)
```

### Agent Rollback
Snapshot state before tool calls; undo per execution.
```typescript
import { RollbackManager } from 'swarmwire'

const rollback = new RollbackManager()

// Inject into executor
const result = await swarm.execute(plan, { rollbackManager: rollback })

// Roll back a specific snapshot
rollback.rollback(snapshotId)

// Roll back everything in an execution (reverse order)
rollback.undoExecution(executionId)
```

### Trajectory Reduction (AgentDiet)
Prune expired, redundant, and superseded tool results from agent trajectories before passing to LLM. Achieves 39-60% input token reduction.
```typescript
import { reduceTrajectory, classifyMessage } from 'swarmwire'

const { messages, stats } = reduceTrajectory(trajectory, {
  minContentLength: 10,
  deduplicateSameToolResults: true,
  pruneSuperseded: true,
  maxTokenBudget: 8000,
  maxMessages: 50,
})
// stats.reductionFraction — fraction of messages pruned
```

### Speculative Tool Execution (PASTE)
Prefetch likely tool calls in parallel while the LLM is still generating, reducing end-to-end latency.
```typescript
import { SpeculativeToolExecutor, createKeywordPredictor } from 'swarmwire'

const exec = new SpeculativeToolExecutor({ tools, maxSpeculative: 3, minConfidence: 0.6 })

const predictor = createKeywordPredictor([
  { toolName: 'search_web', keywords: ['search', 'find', 'lookup'], defaultInput: { q: '' } },
])

// While LLM is generating, prefetch
exec.prefetch(predictor(partialContext))

// When LLM finishes, result is already cached
const result = await exec.execute('search_web', { q: userQuery })
// result.cacheHit — true if prefetch succeeded
```

### Skill Reducer (Progressive Disclosure)
Compress tool definitions in prompts — inject compact one-liners first, expand to full schemas only when needed. ~48% prompt compression.
```typescript
import { createReducedSkillSet, selectRelevantTools } from 'swarmwire'

const skillSet = createReducedSkillSet(tools, { maxSummaryLength: 60 })

// Initial prompt injection — compact
const promptLine = skillSet.toPromptString()
// - search_web: Search the internet for current information…
// - execute_code: Run Python or JavaScript code in a sandbox…

// Progressive reveal when agent picks a tool
const fullDefs = skillSet.expand(['search_web'])

// Auto-select relevant tools for a task
const relevant = selectRelevantTools('search for documents', skillSet)
```

---

## Evaluation & Testing

### Outcome Evals Harness
Named harnesses with run history, pass-rate tracking, and regression detection.
```typescript
import { EvalHarness } from 'swarmwire'

const harness = new EvalHarness({
  name: 'research-quality',
  suite: myEvalSuite,
  greenThreshold: 0.8,
  storage: memoryBackend,
})

const record = await harness.run(async () => {
  const output = await agent.execute(input, ctx)
  return { input, output }
})

const report = harness.report()
// report.trend: 'improving' | 'stable' | 'degrading'
// report.regressions: string[]  — eval names that got worse
```

### Trajectory Evaluation (TRACE)
Assess multi-step agent trajectories across five dimensions: step efficiency, tool precision, backtrack rate, plan adherence, outcome quality.
```typescript
import { evalTrajectory, compareTrajectories } from 'swarmwire'

const result = await evalTrajectory(trajectory, {
  expectedSteps: ['fetch', 'parse', 'summarize'],
  expectedToolCalls: { 'step-1': ['search_web'] },
  outcomeScorer: (output) => qualityScore(output),
  maxSteps: 5,
  weights: { outcomeQuality: 2, stepEfficiency: 1 },
})
// result.score, result.breakdown.stepEfficiency, .toolPrecision, etc.

// Compare two agent strategies
const comparison = await compareTrajectories(trajectoryA, trajectoryB)
// comparison.better: 'a' | 'b' | 'tie'
```

### Record/Replay Testing
Deterministic, zero-cost testing. Record real LLM interactions once, replay in CI forever.
```typescript
import { RecordingProvider, ReplayProvider } from 'swarmwire'

const recording = new RecordingProvider(realProvider, './fixtures/research.json')
await swarm.run('Research TypeScript ORMs', { /* uses recording */ })
await recording.save()

const replay = new ReplayProvider('./fixtures/research.json')
const result = await swarm.run('Research TypeScript ORMs', { /* uses replay */ })
```

### Evals Framework
```typescript
import { runEvalSuite, nonEmpty, containsKeywords, noHallucination } from 'swarmwire'

const result = await runEvalSuite({
  name: 'research-quality',
  evals: [nonEmpty(), containsKeywords(['TypeScript', 'ORM']), noHallucination()],
  threshold: 0.8,
}, input, output)
```

---

## Observability

### OpenTelemetry Auto-Export
Push traces to any OTLP endpoint automatically after each execution.
```typescript
import { createOTelExporter, withOTelExport, exportToOTLP } from 'swarmwire'

// One-shot export
await exportToOTLP(result, {
  endpoint: 'http://localhost:4318/v1/traces',  // OTEL Collector, Jaeger, Tempo, Honeycomb
  serviceName: 'my-app',
  headers: { 'x-honeycomb-team': process.env.HONEYCOMB_KEY },
})

// Fire-and-forget wrapper
const exporter = createOTelExporter({ endpoint: '...', serviceName: 'my-app' })
swarm.on('execution:complete', (result) => exporter.exportSync(result))

// Transparent wrapper around executePlan
const result = await withOTelExport(() => swarm.execute(plan), {
  endpoint: 'http://localhost:4318/v1/traces',
  serviceName: 'my-app',
})
```

### Reputation Board
MessageBoard extended with per-agent reputation scoring. Findings from higher-reputation agents are weighted more heavily.
```typescript
import { ReputationBoard } from 'swarmwire'

const board = new ReputationBoard({ defaultScore: 0.5, decayFactor: 0.95 })
const swarm = new Swarm({ providers, board })

// After execution, provide feedback signals
board.upvote(messageId, 'agent-b')
board.cite(sourceMessageId)
board.markAnswerCorrect('agent-a')

// Aggregate findings weighted by reputation
const weighted = board.weightedFindings('orchestrator')
const summary = board.aggregateFindings('orchestrator')
board.leaderboard()   // agents sorted by score
board.decay()         // apply decay to prevent score inflation
```

### Events
```typescript
swarm.on('step:start', (e) => console.log(`Starting ${e.agentName}`))
swarm.on('step:complete', (e) => console.log(`Done: ${e.durationMs}ms`))
swarm.on('budget:warning', (e) => console.log(`Budget at ${(e.usage * 100).toFixed(0)}%`))
```

### Execution Reports
```typescript
import { explainExecution, summarizeExecution } from 'swarmwire'

console.log(summarizeExecution(result))
// [OK] 3/3 steps | 2.1s | 42.70c | 47.8k tokens

console.log(explainExecution(result))
// Full report: steps, cost breakdown, trace, conflicts
```

### SSE Streaming
```typescript
import { sseHeaders, pipeToSSE } from 'swarmwire/transport'

app.get('/api/run', async (req, res) => {
  sseHeaders(res)
  await pipeToSSE(swarm.stream('Analyze codebase'), res)
  res.end()
})
```

---

## Tools

### Code Execution Sandbox
```typescript
import { createNodeSandbox, createDockerSandbox, createCodeExecutionTool } from 'swarmwire'

// Node.js vm module (no external deps)
const sandbox = createNodeSandbox({ timeoutMs: 5000, allowedModules: ['path'] })

// Docker (requires Docker CLI)
const dockerSandbox = createDockerSandbox({ image: 'node:20-alpine', timeoutMs: 10_000 })

// Returns a Tool for agent.tools[]
const tool = createCodeExecutionTool(sandbox)

const result = await sandbox.execute('console.log("hello")', 'javascript')
// result.stdout, result.stderr, result.exitCode, result.durationMs
```

### Browser / Computer Use
```typescript
import { createBrowserTool, createComputerUseTool } from 'swarmwire'

// Playwright (peer dep)
const browserTool = createBrowserTool({ headless: true, timeoutMs: 30_000 })

// Anthropic Computer Use API
const computerTool = createComputerUseTool({
  screenshotProvider: async () => base64Screenshot,
})

const agent = swarm.agent({ name: 'browser-agent', role: '...', tools: [browserTool] })
```

### Voice Agent Pipeline
```typescript
import { VoicePipeline } from 'swarmwire'

const pipeline = new VoicePipeline({
  stt: VoicePipeline.createDeepgramSTT(process.env.DEEPGRAM_KEY!),
  tts: VoicePipeline.createElevenLabsTTS(process.env.ELEVENLABS_KEY!, 'voice-id'),
  agent: myAgent,
  provider,
  model,
})

const turn = await pipeline.processTurn(audioBuffer)
// turn.input (transcribed), turn.output (text), turn.audioOutput (Buffer)
```

---

## Agent Infrastructure

### Agent Discovery Catalog
Registry where agents are discoverable by capability, tag, or semantic description at runtime.
```typescript
import { AgentCatalog } from 'swarmwire'

const catalog = new AgentCatalog({ embedFn: myEmbed })
catalog.register(researchAgent, ['research', 'web'], { version: '1.2' })
catalog.heartbeat(agentId)   // mark available

// Discover by capability, tag, or semantic description
const agents = catalog.discover({
  capabilities: ['analysis'],
  tags: ['finance'],
  semantic: 'agent that can summarize quarterly reports',
  available: true,
})

catalog.resolve('researcher')  // by name or id
await catalog.flush()          // persist to storage backend
```

### Prompt Optimizer (DSPy-style)
Uses training pairs from `DistillationCollector` to improve agent prompts automatically.
```typescript
import { PromptOptimizer } from 'swarmwire'

const optimizer = new PromptOptimizer({
  collector: distillationCollector,
  provider,
  model,
  numCandidates: 4,
  numFewShot: 3,
  maxIterations: 3,
})

const result = await optimizer.optimize('agent-id', basePrompt, (prompt, response) => {
  return responseQualityScore(response)
})
// result.optimizedPrompt, result.fewShotExamples, result.scoreImprovement
```

### A2A / ACP Protocol (v1.0)
```typescript
import { startA2AServer, importA2AAgent } from 'swarmwire'

// Expose your agents
startA2AServer({ port: 8080, agents: [researcher, analyst] })

// Consume external agents (contextId for cross-task threading)
const externalAgent = await importA2AAgent({
  url: 'https://partner.api',
  contextId: 'ctx-session-123',
})

// Subscribe to long-running task events
import { streamSubscribe } from 'swarmwire'
await streamSubscribe(baseUrl, task, (event) => console.log(event))
```

Protocol version: `1.0`. Supports `streaming` task state, `AgentCard.offline`, `contextId` for cross-task threading, and `tasks/sendSubscribe` for SSE push.

---

## Provider Infrastructure

### Multi-Provider with Failover
```typescript
import { createProvider, withCircuitBreaker, withFailover, withRateLimit } from 'swarmwire'

const anthropic = withRateLimit(
  withCircuitBreaker(createProvider('anthropic', { apiKey: '...' })),
  { requestsPerMinute: 50 },
)
const openai = withCircuitBreaker(createProvider('openai', { apiKey: '...' }))

const provider = withFailover([anthropic, openai])
```

Supported: `anthropic`, `openai`, `gemini`, `ollama`, any OpenAI-compatible endpoint (LiteLLM, vLLM, Azure).

### Routing Stack
5-layer cost optimization, active in every execution.

| Layer | Component | What it does |
|-------|-----------|-------------|
| 1 | **SemanticCache** | Near-duplicate query caching (zero cost) |
| 2 | **LatencyRouter** | Fastest model meeting quality/cost via EMA + P95 tracking |
| 3 | **CascadeRouter** | Cheapest model first, escalate on low quality |
| 4 | **SpeculativeCascade** | N models in parallel, accept cheapest that passes |
| 5 | **QueryDecomposer** | Split queries, route each to cheapest sufficient model |

---

## Plan → Inspect → Execute

```typescript
const plan = await swarm.plan('Analyze our auth architecture')

console.log(plan.estimatedCost)        // preview cost
console.log(visualizePlan(plan))       // ASCII DAG

plan.steps[1].agent = alternateAgent   // swap an agent
plan.steps[2].optional = true          // make a step optional

const result = await swarm.execute(plan)
```

### Dry-Run Cost Projection
```typescript
import { dryRun } from 'swarmwire'

const projection = dryRun(plan, providers)
// projection.estimatedCost.likelyCents, .willExceedBudget, .stepBreakdown
```

### Differential Execution
Only re-run steps whose inputs changed.
```typescript
import { diffPlans, applyPreviousResults } from 'swarmwire'

const diff = diffPlans(newPlan, previousResult)
applyPreviousResults(newPlan, previousResult, diff)
const result = await swarm.execute(newPlan)   // skips reusable steps
```

---

## Guardrails

Input, output, and tool-level safety checks.

```typescript
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

---

## MessageBoard

Inter-agent communication via `ctx.board` inside any agent's `execute()`.

```typescript
async execute(input: string, ctx: AgentContext) {
  ctx.board.post('*', 'Found critical issue in auth', {
    type: 'finding', priority: 'urgent', data: { file: 'auth.ts' },
  })
  const answers = ctx.board.inbox()
  const findings = ctx.board.findings()
}
```

Use `ReputationBoard` for reputation-weighted finding aggregation, `FileBoard` for local persistence, or `CognitiveVaultBoard` for cross-machine durability.

---

## YAML Workflows

```yaml
name: research-and-summarize
version: 1.0.0
steps:
  - id: research
    type: llm
    agent: researcher
    prompt: "Research: {{ inputs.topic }}"
  - id: summarize
    type: llm
    agent: writer
    prompt: "Summarize findings"
    dependencies: [research]
```

```typescript
import { parseWorkflow, compileWorkflow } from 'swarmwire'

const plan = compileWorkflow(parseWorkflow(yaml), { agents, inputs })
const result = await swarm.execute(plan)
```

---

## Enterprise-Grade Security

```typescript
import { createThreatDetector } from 'swarmwire'

const detector = createThreatDetector({
  checkSqlInjection: true,
  checkCommandInjection: true,
  autoSanitize: true,
})

const result = detector.scan(userInput)
// result.level: 'safe' | 'warning' | 'threat'
// result.detectedPatterns[]
```

Detects: SQL injection, command injection, XSS, path traversal, hardcoded secrets, prompt injection, PII (email, SSN, phone, credit card, IP).

---

## Agent Templates (17)

```typescript
import { Swarm, templates } from 'swarmwire'

const swarm = new Swarm({ providers })

// Core
const researcher  = swarm.agent(templates.researcher())
const reviewer    = swarm.agent(templates.codeReviewer())
const synth       = swarm.agent(templates.synthesizer())
const analyst     = swarm.agent(templates.dataAnalyst())
const tester      = swarm.agent(templates.qaTester())
const writer      = swarm.agent(templates.writer())
const planner     = swarm.agent(templates.planner())

// Specialized
const security    = swarm.agent(templates.securityAuditor())
const devops      = swarm.agent(templates.devopsEngineer())
const dbEngineer  = swarm.agent(templates.databaseEngineer())
const apiDesigner = swarm.agent(templates.apiDesigner())
const perfEngine  = swarm.agent(templates.performanceEngineer())
const docs        = swarm.agent(templates.documentationSpecialist())
const architect   = swarm.agent(templates.architectureAdvisor())
const debugger_   = swarm.agent(templates.debugger())
const refactor    = swarm.agent(templates.refactoringSpecialist())
const integration = swarm.agent(templates.integrationSpecialist())
const testAuto    = swarm.agent(templates.testAutomationEngineer())
```

---

## Approval Gates

```typescript
const result = await swarm.execute(plan, {
  onApproval: async (gate) => {
    console.log(`[GATE] ${gate.agentName}: ${gate.message}`)
    return userSaidYes ? 'approved' : 'rejected'
  },
})
```

---

## MCP — Agent-to-Tool

```typescript
import { loadMcpTools } from 'swarmwire'

const tools = await loadMcpTools('npx @some/mcp-server')
const agent = swarm.agent({ name: 'tooled', role: '...', tools })
```

---

## Architecture

```
User Code
    |
    v
  Swarm ─────────────────────────────────────────────────────────────────────
    |           |           |           |           |           |
  Planner    Routing     Executor     Budget    Patterns    Guardrails
  (DAG +     (semantic   (parallel    Engine    orch-wkr    input/output
   scorer    cache       dry-run      (hard     pipeline    tool safety
   decomp.   latency     diff-exec    limits)   map-reduce  threat detect
   attn.     cascade     checkpoint            debate       PII guard)
   router    specul.)    time-travel            blackboard
   rl-router            rollback               fan-out
   3-tier)              traj-reduce            hive-mind        |
                        spec-tools             hierarchy    Security
    |           |           |           |      loop-agent   (injection
  Memory    Session     Execution   Patterns   state-mach    XSS
  (ANCS     (named      (hooks      event-     evolving)     path-trav
   self-lrn  sessions   consensus   driven)                  secrets)
   vector    branching  federation)     |
   a-mem     branch-mgr)             Testing
   temporal                          (record/replay
   self-edit                          evals harness
   episodic                           trajectory-eval
   procedural                         prompt-optimizer
   vector-stores                      judge-agent)
   sleep-time)     |           |
                 Providers   Observability
                 (Anthropic  (OTel auto-export
                  OpenAI      OTLP push
                  Gemini      SSE streaming
                  Ollama      execution reports
                  LiteLLM     reputation board)
                  +circuit
                  +failover
                  +rate limit)
```

---

## Project Stats

110 modules · 71 test files · 621 tests · 17 agent templates

---

## Documentation

| Guide | What it covers |
|-------|---------------|
| [Routing Stack](./docs/routing.md) | 5-layer cost optimization, cascade routing, semantic cache |
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
