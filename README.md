# SwarmWire

**Multi-agent orchestration library for TypeScript.** Budget-first. Library, not framework.

Coordinate LLM agents through typed, composable patterns — with hard cost limits, conflict resolution, and adaptive routing. Works standalone or with [ANCS](https://github.com/swarmwire/ancs) as its memory backend.

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

### With ANCS (coming soon)
Persistent cognitive memory with truth tracking, entity graphs, and importance decay.
```typescript
import { Swarm, ancsMemory } from 'swarmwire'

const swarm = new Swarm({
  providers,
  memory: ancsMemory({
    url: 'http://localhost:3000',
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

## Architecture

```
User Code
    |
    v
  Swarm  ─────────────────────────────────────────────────
    |          |           |          |          |
  Planner   Router     Executor   Budget    Patterns
  (DAG)    (cascade    (parallel   Engine   (orch-worker
   |       semantic     runner)    (hard     pipeline
  Scorer   cache        |         limits)   map-reduce
   |       latency    Checkpoint              debate
  Query    specul.)                           blackboard
  Decomp.                                    evolving)
    |          |           |          |
    v          v           v          v
  Providers     MessageBoard    MCP Tools     Memory
  (Anthropic    (inter-agent    (any server)  (ANCS
   OpenAI       communication)                or custom)
   +circuit breaker
   +rate limiter
   +failover)
```

---

## Project Stats

68 modules | 25 test files | 210 tests | 7 agent templates

---

## License

Free for open source projects, small businesses (under EUR 25,000/year), and personal/educational use. Commercial use above that threshold requires a paid license. See [LICENSE](./LICENSE).
