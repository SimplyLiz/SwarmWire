# SwarmWire — Product Requirements Document

> A TypeScript library for multi-agent orchestration that runs standalone or with ANCS as its memory backend.

**Version:** 0.5.0
**Date:** 2026-03-26
**Status:** Phases 1-5 Complete

---

## Table of Contents

1. [Vision](#vision)
2. [Problem Space](#problem-space)
3. [Competitive Landscape](#competitive-landscape)
4. [Design Principles](#design-principles)
5. [Architecture](#architecture)
6. [Core Abstractions](#core-abstractions)
7. [Orchestration Patterns](#orchestration-patterns)
8. [API Surface](#api-surface)
9. [Protocol Support](#protocol-support)
10. [Memory Integration](#memory-integration)
11. [Cost & Budget Engine](#cost--budget-engine)
12. [Observability](#observability)
13. [Roadmap](#roadmap)
14. [Research References](#research-references)

---

## Vision

SwarmWire is a **TypeScript-first multi-agent orchestration library** that coordinates LLM agents through typed, composable patterns. It handles the hard problems of agent coordination — planning, routing, cost control, conflict resolution, context sharing, and observability — while remaining runtime-agnostic and memory-backend-agnostic.

**The nervous system for AI agent swarms.** ANCS is the brain (memory, truth, knowledge). SwarmWire is the nervous system (signals, coordination, decisions). They compose but don't depend on each other.

### Who Is This For

- **Agent builders** who outgrew CrewAI but don't want LangGraph's complexity
- **Teams** running multi-agent workflows in production and hemorrhaging tokens
- **ANCS users** who want orchestration on top of their cognitive substrate
- **TypeScript developers** in the AI space (Mastra's audience, but for orchestration specifically)

### What SwarmWire Is NOT

- Not an LLM provider or wrapper (use the Anthropic/OpenAI SDKs directly)
- Not a memory/storage system (use ANCS, or your own)
- Not a prompt library or template engine
- Not a framework that owns your application (it's a library — you call it)

---

## Problem Space

### The State of Multi-Agent Orchestration (2026)

The AI agents market hit $7.63B in 2025 and is projected to reach $50.31B by 2030 (45.8% CAGR). Every serious AI application is moving from single-agent to multi-agent. But the tooling has critical gaps:

**1. The Ceiling Problem**
Teams spend 3-6 months building on CrewAI, hit its limitations, and face a 50-80% rewrite to migrate to LangGraph. Low-floor/low-ceiling frameworks get you started fast but trap you. High-ceiling frameworks (LangGraph) require deep state machine expertise from day one.

> "The migration from low-ceiling to high-ceiling mid-project is extremely painful." — Industry analysis, 2026

**2. Token Bleeding**
AutoGen's chat-heavy consensus loops cause unbounded token consumption. A single failed task can trigger prolonged background API spend before anyone notices. No framework treats cost as a first-class constraint.

**3. Coordination Chaos**
With 10+ agents, "duplicating efforts or conflicting with one another becomes inevitable without centralized orchestration." Debugging looks like "a dozen people chatting simultaneously in different Slack channels."

**4. No Memory Beyond the Session**
Frameworks treat each execution as stateless. Insights gathered in one run are lost. There's no truth tracking, no conflict detection, no importance scoring. The agent swarm has amnesia.

**5. The TypeScript Gap**
Mastra (22k+ stars, YC W25, $13M) proved massive demand for TypeScript AI tooling. But Mastra is a full framework — it owns your app. There's no standalone TypeScript library focused purely on multi-agent orchestration that you can drop into any architecture.

### Research-Backed Gaps

Academic surveys ([arXiv:2501.06322](https://arxiv.org/abs/2501.06322), [arXiv:2601.13671](https://arxiv.org/abs/2601.13671)) identify:

- **No single optimal structure**: "Optimal communication structures vary with tasks and compositions of agents." Static topologies fail.
- **Hallucination cascading**: "One erroneous output leads to compounding mistakes" in sustained multi-agent interactions.
- **Evaluation gap**: No standardized metrics for assessing collaboration quality across MAS designs.
- **LLM communication**: "LLMs are not inherently designed and trained to communicate with one another."
- **Coopetition underexplored**: "Few studies explore coopetition in depth" — hybrid cooperation/competition is the most promising but least developed.

---

## Competitive Landscape

### Framework Comparison

| Framework | Language | Type | Floor | Ceiling | Memory | Cost Control | TypeScript |
|-----------|----------|------|-------|---------|--------|-------------|------------|
| **LangGraph** | Python | Graph state machine | High | Very High | Checkpoints | None | No |
| **CrewAI** | Python | Role-based orchestration | Low | Low | Short/Long/Entity | None | No |
| **AutoGen/MS Agent** | Python/C#/Java | Conversation-based | Medium | High | Message history | None | No |
| **OpenAI Agents SDK** | Python | Handoff chains | Very Low | Low | None | None | No |
| **Mastra** | TypeScript | Full framework | Low | Medium | Working + Semantic | None | Yes (framework) |
| **Claude Agent SDK** | TypeScript | Agent harness | Medium | Medium | File-based | None | Yes (harness) |
| **SwarmWire** | TypeScript | Orchestration library | **Low** | **Very High** | **Pluggable (ANCS)** | **First-class** | **Yes (library)** |

### What Each Gets Right (And Wrong)

**LangGraph** — Graph-based state machines with durable checkpointing. Gets determinism right. Gets DX wrong (requires deep async + state machine expertise). No cost awareness.

**CrewAI** — Role-based mental model is intuitive. 5.7x faster deployment for simple cases. Gets onboarding right. Gets ceiling wrong (rigid structure, can't escape).

**AutoGen** — Conversation-as-computing is powerful for creative problem-solving. Gets flexibility right. Gets cost wrong (token bleeding from consensus loops, slowest framework).

**Mastra** — TypeScript-first, great DX, $13M funding, 22k stars. Gets ecosystem right. Gets scope wrong (full framework, not composable library).

**Claude Agent SDK** — Production-grade agent loop with MCP integration. Gets tool integration right. Gets multi-agent wrong (single-agent focused, multi-agent feature-flagged).

### SwarmWire's Positioning

**Low floor**: Simple `Swarm.run()` for basic orchestration — works in 10 lines of code.
**Very high ceiling**: Full DAG planning, evolving orchestration, CRDT namespaces, PCST-based context selection — when you need it.
**Composable**: Library, not framework. Works with any LLM provider, any storage, any runtime.
**Cost-first**: Every operation has a budget. Token bleeding is structurally impossible.
**TypeScript-native**: Not a Python port. Built for the JS/TS ecosystem from scratch.

---

## Design Principles

### 1. Library, Not Framework
You call SwarmWire. It doesn't call you. No lifecycle hooks, no app structure, no opinions about your web framework. Import what you need.

### 2. Budget Is a First-Class Citizen
Every plan, every swarm, every agent call has a `Budget`. Token limits, cost limits, latency limits. Hard enforcement, not advisory. This is the single biggest gap in every competitor.

### 3. Progressive Disclosure
```typescript
// Level 1: One-liner
const result = await swarm.run('Research TypeScript ORMs', { maxCost: 0.50 })

// Level 2: Configured swarm
const result = await swarm.run(task, {
  agents: [researcher, analyst, synthesizer],
  strategy: 'synthesizer_final',
  budget: { maxTokens: 50_000, maxCost: 1.00 }
})

// Level 3: Full DAG with custom orchestration
const plan = swarm.plan(task, { planner: myCustomPlanner })
plan.steps[2].agent = specialistAgent
const result = await swarm.execute(plan)
```

### 4. Evolving Orchestration > Static Topology
Inspired by [arXiv:2505.19591](https://arxiv.org/abs/2505.19591): the orchestrator should adapt its agent sequencing based on task state, not follow a fixed graph. Static hierarchies break as complexity grows. SwarmWire's default orchestrator learns from execution patterns — which agents produce useful results for which task types.

### 5. Typed All the Way Down
Every agent input, output, context bundle, and execution trace is fully typed. TypeScript's type system is the contract layer. No `any`, no `unknown` payloads in the public API.

### 6. Memory Is a Plug, Not a Requirement
SwarmWire works without persistence (ephemeral mode). Plug in ANCS for persistent memory with truth tracking. Plug in Redis for simple caching. Plug in nothing — it still orchestrates.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         USER CODE                                │
│                                                                  │
│   import { Swarm, Agent, Plan } from 'swarmwire'                │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                      SWARMWIRE CORE                              │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────┐  │
│  │  Planner   │  │  Router    │  │  Executor  │  │  Budget  │  │
│  │            │  │            │  │            │  │  Engine  │  │
│  │ Task→DAG   │  │ Task→Agent │  │ DAG runner │  │          │  │
│  │ Scoring    │  │ Model tier │  │ Parallel   │  │ Token    │  │
│  │ Decompose  │  │ Tool pick  │  │ Checkpoint │  │ Cost     │  │
│  └────────────┘  └────────────┘  └────────────┘  │ Latency  │  │
│                                                   │ Enforce  │  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  └──────────┘  │
│  │  Context   │  │  Conflict  │  │  Trace     │                 │
│  │  Packer    │  │  Resolver  │  │  Collector │                 │
│  │            │  │            │  │            │                 │
│  │ Evidence   │  │ Vote       │  │ Spans      │                 │
│  │ Token-fit  │  │ Evidence   │  │ Costs      │                 │
│  │ Share      │  │ Escalate   │  │ Artifacts  │                 │
│  └────────────┘  └────────────┘  └────────────┘                 │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Agent Runtime                          │   │
│  │  Pool → Acquire → Execute → Release                      │   │
│  │  Connection pooling | Sandbox | Timeout | Circuit breaker │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────┬───────────────────────────────────────────┘
                       │
              ┌────────┼────────┐
              │        │        │
              ▼        ▼        ▼
         ┌────────┐ ┌──────┐ ┌───────┐
         │  LLM   │ │ MCP  │ │Memory │
         │Provider│ │Tools │ │Backend│
         │        │ │      │ │       │
         │Anthropic│ │Any   │ │ ANCS  │
         │OpenAI  │ │server│ │ Redis │
         │Ollama  │ │      │ │ None  │
         │Generic │ │      │ │       │
         └────────┘ └──────┘ └───────┘
```

### Module Breakdown

| Module | Responsibility | Key Types |
|--------|---------------|-----------|
| **Planner** | Decomposes tasks into executable DAGs. Scores difficulty. Selects execution mode (deep/swarm). | `Plan`, `Step`, `TaskScore` |
| **Router** | Maps tasks to agents based on capabilities, model tier, cost. Adaptive learning from outcomes. | `Route`, `AgentCapability`, `RoutingPolicy` |
| **Executor** | Runs DAGs with parallelism, checkpointing, timeout, and retry. Respects budget constraints. | `Execution`, `Checkpoint`, `StepResult` |
| **Budget Engine** | Tracks and enforces token, cost, and latency budgets across all operations. Hard limits. | `Budget`, `BudgetLedger`, `CostEvent` |
| **Context Packer** | Builds token-optimized context bundles from evidence, code, and prior results. Shareable across agents. | `ContextBundle`, `PackOptions` |
| **Conflict Resolver** | Detects contradictions in agent outputs. Resolves via voting, evidence weight, or escalation. | `Conflict`, `Resolution`, `MergeStrategy` |
| **Trace Collector** | Records execution spans, costs, artifacts, and decisions. OpenTelemetry-compatible. | `Trace`, `Span`, `CostSpan` |
| **Agent Runtime** | Manages agent lifecycle: pool, acquire, execute, release. Connection pooling, circuit breakers. | `Worker`, `WorkerPool`, `ConnectionPool` |

---

## Core Abstractions

### Agent

The unit of work. An agent wraps an LLM call with a role, tools, and constraints.

```typescript
interface Agent<TInput = unknown, TOutput = unknown> {
  id: string
  name: string
  role: string                          // Human-readable role description

  // Capabilities
  capabilities: string[]                // What this agent can do
  tools: Tool[]                         // MCP tools or custom functions

  // Model configuration
  model: ModelConfig                    // Provider, model, temperature, etc.
  modelTier: 'cheap' | 'standard' | 'premium' | 'reasoning'

  // Constraints
  maxTokens?: number
  maxCostCents?: number
  timeoutMs?: number

  // The work function
  execute(input: TInput, context: AgentContext): Promise<TOutput>
}

// Simple agent creation
const researcher = swarm.agent({
  name: 'researcher',
  role: 'Find and summarize relevant information',
  model: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  modelTier: 'standard',
  tools: [webSearch, readUrl],
  maxCostCents: 25,
})
```

### Task

What needs to be done. Typed input/output with budget constraints.

```typescript
interface Task<TInput = unknown, TOutput = unknown> {
  id: string
  description: string
  input: TInput

  // Constraints
  budget: Budget
  deadline?: Date

  // Hints for planning
  difficulty?: TaskDifficulty
  domain?: string[]
  freshness?: 'strict' | 'relaxed' | 'archival'

  // Output schema (for validation)
  outputSchema?: ZodSchema<TOutput>
}

interface Budget {
  maxTokens?: number                    // Hard token limit across all agents
  maxCostCents?: number                 // Hard cost limit
  maxLatencyMs?: number                 // Wall-clock deadline
  maxAgents?: number                    // Cap parallel agents
  modelPreferences?: ModelPreference[]  // Prefer/avoid specific models
}
```

### Plan

A DAG of steps that solves a task. Generated by the Planner, editable before execution.

```typescript
interface Plan {
  id: string
  task: Task
  steps: Step[]                         // DAG — steps reference dependencies
  mode: 'deep' | 'swarm'
  estimatedCost: BudgetEstimate
  status: 'draft' | 'approved' | 'running' | 'complete' | 'failed'
}

interface Step {
  id: string
  agent: Agent | AgentRef               // Who executes this
  input: StepInput                      // May reference other step outputs
  dependencies: string[]                // Step IDs that must complete first

  // Execution config
  retries?: number
  timeoutMs?: number
  optional?: boolean                    // Failure doesn't fail the plan

  // Result
  status: 'pending' | 'running' | 'complete' | 'skipped' | 'failed'
  output?: unknown
  cost?: CostEvent
}
```

### Swarm

The top-level orchestrator. Configurable, composable, progressive.

```typescript
interface SwarmConfig {
  // Agent registry
  agents: Agent[]

  // Orchestration
  planner?: Planner                     // Custom planning strategy
  router?: Router                       // Custom routing logic
  conflictResolution?: 'vote' | 'evidence_weight' | 'escalate' | ConflictResolver
  mergeStrategy?: 'consensus' | 'weighted' | 'synthesizer_final' | MergeFunction

  // Infrastructure
  budget?: Budget                       // Default budget for all tasks
  memory?: MemoryBackend                // ANCS, Redis, or none
  providers?: ProviderConfig[]          // LLM provider connections

  // Observability
  trace?: TraceConfig                   // OpenTelemetry export
  onStepComplete?: (step: Step) => void
  onBudgetWarning?: (usage: BudgetUsage) => void
  onConflict?: (conflict: Conflict) => void
}
```

### Execution Result

Every execution returns a typed, traceable result.

```typescript
interface ExecutionResult<T = unknown> {
  // The answer
  output: T
  confidence: number                    // 0-1, based on agent agreement + evidence

  // Provenance
  evidence: EvidenceRef[]               // What the answer is based on
  agentOutputs: AgentOutput[]           // Individual agent contributions
  conflicts?: Conflict[]                // Disagreements detected

  // Cost & Performance
  cost: CostSummary                     // Tokens, dollars, latency breakdown
  trace: ExecutionTrace                 // Full span tree

  // Plan (for debugging/replay)
  plan: Plan
}

interface CostSummary {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  totalCostCents: number
  totalLatencyMs: number
  perAgent: Map<string, AgentCost>      // Cost breakdown by agent
  perProvider: Map<string, ProviderCost>
  budgetUsed: number                    // 0-1 fraction of budget consumed
}
```

---

## Orchestration Patterns

Based on academic research and production deployment analysis, SwarmWire supports these patterns as composable building blocks:

### 1. Orchestrator-Worker (Default)

The most deployed pattern (~70% of production MAS). A central orchestrator decomposes, delegates, and merges.

```typescript
const result = await swarm.run(task, {
  pattern: 'orchestrator-worker',
  agents: [researcher, analyst, writer],
  mergeStrategy: 'synthesizer_final',
})
```

**When to use**: Most tasks. Research, analysis, content generation.
**Trade-off**: Central bottleneck vs. simplicity and control.

### 2. Pipeline (Sequential)

Assembly line — each agent's output feeds the next. Inspired by MetaGPT's SOP encoding.

```typescript
const result = await swarm.run(task, {
  pattern: 'pipeline',
  stages: [
    { agent: classifier, name: 'classify' },
    { agent: researcher, name: 'research' },
    { agent: synthesizer, name: 'synthesize' },
    { agent: reviewer, name: 'review' },
  ],
})
```

**When to use**: Well-defined workflows with clear stage boundaries.
**Trade-off**: No parallelism vs. predictable, debuggable flow.

### 3. Debate (Competitive)

Agents argue opposing positions, a judge resolves. Proven to improve reasoning quality ([arXiv:2501.06322](https://arxiv.org/abs/2501.06322)).

```typescript
const result = await swarm.run(task, {
  pattern: 'debate',
  proponents: [agent1, agent2],
  judge: judgeAgent,
  rounds: 3,
  convergenceThreshold: 0.85,          // Stop early if agreement > 85%
})
```

**When to use**: Decisions where bias or overconfidence is a risk. Architecture choices, security reviews.
**Trade-off**: 2-3x token cost vs. higher quality decisions.

### 4. Blackboard (Shared State)

Agents read/write to a shared workspace. Good for iterative refinement where multiple specialists contribute.

```typescript
const result = await swarm.run(task, {
  pattern: 'blackboard',
  agents: [dataAgent, modelAgent, vizAgent],
  board: new Blackboard<AnalysisState>(),
  rounds: 5,
  convergence: (state) => state.qualityScore > 0.9,
})
```

**When to use**: Iterative improvement tasks. Data analysis, complex document creation.
**Trade-off**: Coordination complexity vs. flexible, emergent collaboration.

### 5. Evolving Orchestration (Adaptive)

The orchestrator adapts its agent sequencing based on task state. Inspired by [arXiv:2505.19591](https://arxiv.org/abs/2505.19591) — learns "compact, cyclic reasoning structures" that outperform static hierarchies.

```typescript
const result = await swarm.run(task, {
  pattern: 'adaptive',
  agents: [researcher, analyst, coder, reviewer],
  maxRounds: 10,
  budget: { maxCostCents: 200 },
  // Orchestrator decides agent order dynamically
})
```

**When to use**: Complex, novel tasks where the optimal agent sequence isn't known upfront.
**Trade-off**: Less predictable vs. superior performance on hard tasks.

### 6. MapReduce (Parallel Fan-Out)

Split task into independent subtasks, execute in parallel, reduce results. Classic data-parallel pattern.

```typescript
const result = await swarm.run(task, {
  pattern: 'map-reduce',
  mapper: (input) => splitIntoChunks(input, 10),
  worker: analyzerAgent,
  reducer: synthesizerAgent,
  maxParallel: 5,
})
```

**When to use**: Large-input tasks that decompose naturally (document analysis, codebase review, data processing).
**Trade-off**: Requires decomposable input vs. near-linear speedup.

### 7. Custom DAG

Full control. Define arbitrary step graphs with conditional edges.

```typescript
const plan = swarm.plan(task)
  .step('classify', classifierAgent)
  .step('research', researchAgent, { after: 'classify' })
  .step('code', coderAgent, { after: 'classify' })
  .step('review', reviewerAgent, { after: ['research', 'code'] })
  .step('merge', mergerAgent, { after: 'review' })
  .conditional('classify', {
    'simple': { skip: ['research'] },
    'complex': { add: { step: 'deepResearch', agent: deepAgent, after: 'research' } },
  })
  .build()

const result = await swarm.execute(plan)
```

**When to use**: When none of the built-in patterns fit. Production workflows with known structure.
**Trade-off**: Maximum control vs. maximum complexity.

---

## API Surface

### Top-Level API

```typescript
import { Swarm, Agent, createProvider } from 'swarmwire'

// Create swarm
const swarm = new Swarm({
  providers: [
    createProvider('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY }),
    createProvider('openai', { apiKey: process.env.OPENAI_API_KEY }),
  ],
  budget: { maxCostCents: 500 },   // Default budget
  memory: ancsMemory(),             // Optional ANCS backend
})

// Register agents
swarm.register(researcher)
swarm.register(analyst)
swarm.register(synthesizer)

// Run (simple)
const result = await swarm.run('Research TypeScript ORMs and recommend one')

// Run (configured)
const result = await swarm.run(task, {
  pattern: 'orchestrator-worker',
  agents: [researcher, analyst, synthesizer],
  budget: { maxCostCents: 100, maxTokens: 50_000 },
})

// Plan → Inspect → Execute
const plan = await swarm.plan(task)
console.log(plan.estimatedCost)        // Preview cost
plan.steps[1].agent = alternateAgent   // Modify before execution
const result = await swarm.execute(plan)

// Stream
for await (const event of swarm.stream(task)) {
  // event: StepStarted | StepCompleted | AgentOutput | BudgetWarning | ...
}
```

### Agent Definition API

```typescript
// Functional style
const researcher = swarm.agent({
  name: 'researcher',
  role: 'Research topics using web search and documentation',
  model: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  tools: [webSearch, fetchUrl, readDoc],
  maxCostCents: 25,
  systemPrompt: 'You are a thorough researcher. Always cite sources.',
})

// Class style (for complex agents)
class CodeReviewer extends SwarmAgent {
  name = 'code-reviewer'
  role = 'Review code for quality, security, and performance'
  modelTier = 'premium' as const
  tools = [readFile, searchCode, runTest]

  async execute(input: ReviewInput, ctx: AgentContext): Promise<ReviewOutput> {
    const code = await ctx.tool('readFile', { path: input.filePath })
    const review = await ctx.llm(this.reviewPrompt(code))
    return this.parseReview(review)
  }
}
```

### Budget API

```typescript
// Budget on everything
const result = await swarm.run(task, {
  budget: {
    maxTokens: 100_000,               // Hard cap
    maxCostCents: 150,                 // Hard cap
    maxLatencyMs: 30_000,              // Wall-clock
    maxAgents: 5,                      // Concurrency cap
    warningAt: 0.8,                    // Callback at 80% usage
    modelPreferences: [
      { tier: 'cheap', models: ['claude-haiku-4-5', 'gpt-4o-mini'] },
      { tier: 'standard', models: ['claude-sonnet-4-6', 'gpt-4o'] },
      { tier: 'premium', models: ['claude-opus-4-6'] },
    ],
  },
})

// Budget enforcement is structural — cannot be bypassed
// If budget exhausted mid-execution:
// 1. Running agents complete current step
// 2. No new steps start
// 3. Best-effort result returned with partial flag
// 4. Full cost report in result.cost
```

### Memory Backend API

```typescript
// ANCS backend (full cognitive substrate)
import { ancsMemory } from 'swarmwire/memory/ancs'

const memory = ancsMemory({
  url: 'http://localhost:3000',         // ANCS API
  tenantId: 'project-alpha',
  // Or via MCP
  mcp: { command: 'npm', args: ['run', 'mcp'], cwd: '/path/to/ancs' },
})

// Redis backend (simple cache)
import { redisMemory } from 'swarmwire/memory/redis'

const memory = redisMemory({ url: 'redis://localhost:6379' })

// Custom backend
import { MemoryBackend } from 'swarmwire'

class MyMemory implements MemoryBackend {
  async store(key: string, value: unknown, meta: StoreMeta): Promise<void> { ... }
  async query(query: string, opts: QueryOpts): Promise<MemoryItem[]> { ... }
  async forget(key: string): Promise<void> { ... }
}
```

---

## Protocol Support

### MCP (Model Context Protocol)

SwarmWire agents can use MCP tools natively. Any MCP server becomes agent tooling.

```typescript
const agent = swarm.agent({
  name: 'codebase-analyst',
  tools: [
    ...await swarm.mcpTools('npx @anthropic-ai/claude-code-sdk'),
    ...await swarm.mcpTools('npm run mcp', { cwd: '/path/to/ancs' }),
  ],
})
```

### A2A (Agent-to-Agent Protocol)

SwarmWire agents can communicate with external agents via Google's A2A protocol ([a2aproject/A2A](https://github.com/a2aproject/A2A)). This enables cross-framework orchestration.

```typescript
// Expose SwarmWire agents as A2A-compatible
const a2aServer = swarm.exposeA2A({
  port: 8080,
  agents: [researcher, analyst],         // Published Agent Cards
})

// Consume external A2A agents
const externalAgent = await swarm.importA2A('https://partner.api/a2a')
swarm.register(externalAgent)
```

### MCP + A2A Together

Per [arXiv:2601.13671](https://arxiv.org/abs/2601.13671): MCP standardizes agent→tool communication; A2A standardizes agent→agent communication. SwarmWire supports both, creating a unified coordination substrate.

---

## Memory Integration

### Without Memory (Ephemeral Mode)

Default. Each swarm execution is stateless. Results are returned and forgotten.

```typescript
const swarm = new Swarm({ providers: [...] })
// No memory config — works fine, just no persistence
```

### With ANCS (Full Cognitive Substrate)

When ANCS is plugged in, SwarmWire gains:

| Capability | How It Works |
|-----------|-------------|
| **Persistent context** | Agent outputs ingested via `ancs_ingest`. Future queries retrieve relevant prior work via `ancs_query`. |
| **Truth tracking** | Agent conclusions stored as HYPOTHESIS with depth-discounted confidence. Source watchers detect when upstream facts change. Downstream conclusions cascade to SUSPECT. |
| **Conflict detection** | When agents disagree, TruthKeeper's conflict detector flags contradictions. `persisted_conflicts` stores both sides for resolution. |
| **Entity graph** | Entities mentioned across executions build a connected graph. PCST expansion surfaces related knowledge. |
| **Importance decay** | Rarely-accessed knowledge compresses (T3→T2→T1). Frequently-accessed knowledge stays hot. AXION manages automatically. |
| **Subscriptions** | Agents subscribe to entity/predicate changes. On next execution, they receive a digest of what changed. |
| **Ontology** | Domain concepts provide shared vocabulary across agents. Cross-domain analogies via `onto_alignments`. |
| **Multi-tenant** | Separate tenants for separate projects. RLS isolation at the database level. |

```typescript
const swarm = new Swarm({
  providers: [...],
  memory: ancsMemory({ url: 'http://localhost:3000' }),
})

// Now agents automatically:
// 1. Query ANCS for relevant context before execution
// 2. Store results back after execution
// 3. Respect truth states (don't use STALE/SUSPECT items without flagging)
// 4. Get notified of subscription digests at start of execution
```

---

## Cost & Budget Engine

The single biggest differentiator. No other framework treats cost as a structural constraint.

### How It Works

```
Task arrives
     │
     ▼
┌─────────────────────────┐
│  Task Scorer             │
│  difficulty → model tier │
│  estimated_tokens        │
│  estimated_cost          │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Budget Allocator        │
│  Split budget across     │
│  plan steps by priority  │
│  Reserve 20% for retries │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Execution (per step)    │
│  Pre-check: budget left? │
│  Execute agent           │
│  Post: record actual cost│
│  Re-balance remaining    │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  Budget Ledger           │
│  Per-agent cost          │
│  Per-provider cost       │
│  Per-step cost           │
│  Running total vs limit  │
└─────────────────────────┘
```

### Model Tier Routing

Inspired by MasRouter ([ACL 2025](https://aclanthology.org/2025.acl-long.757.pdf)) — route tasks to the cheapest model that can handle them.

```typescript
// Automatic tier selection based on task scoring
const scorer = new TaskScorer()
const score = scorer.score(task)
// score.difficulty: easy → cheap model, complex → reasoning model
// score.factors: { inputComplexity, domainSpecificity, reasoningDepth, outputStructure, contextRequired }

// Manual override always available
const result = await swarm.run(task, {
  budget: {
    modelPreferences: [
      { tier: 'cheap', maxCostPer1kTokens: 0.5 },
      { tier: 'standard', maxCostPer1kTokens: 3.0 },
      { tier: 'premium', maxCostPer1kTokens: 15.0 },
    ],
  },
})
```

### Cost Tracking Granularity

```typescript
result.cost = {
  totalTokens: 47_832,
  inputTokens: 31_204,
  outputTokens: 16_628,
  cachedInputTokens: 12_450,            // Prompt caching savings
  totalCostCents: 42.7,
  totalLatencyMs: 8_340,
  budgetUsed: 0.43,                     // 43% of max budget

  perAgent: {
    'researcher': { tokens: 22_100, costCents: 18.2, calls: 3 },
    'analyst':    { tokens: 15_732, costCents: 14.5, calls: 2 },
    'synthesizer':{ tokens: 10_000, costCents: 10.0, calls: 1 },
  },

  perProvider: {
    'anthropic': { tokens: 37_832, costCents: 32.7, cacheHits: 4 },
    'openai':    { tokens: 10_000, costCents: 10.0, cacheHits: 0 },
  },

  savings: {
    promptCaching: 8.3,                 // Cents saved via caching
    tierRouting: 15.2,                  // Cents saved by using cheaper models
    earlyStop: 0,                       // Cents saved by convergence
  },
}
```

---

## Observability

### OpenTelemetry Integration

Every execution emits structured traces compatible with OpenTelemetry.

```typescript
const swarm = new Swarm({
  trace: {
    exporter: new OTLPTraceExporter({ url: 'http://jaeger:4318' }),
    // Or: console, file, custom
  },
})
```

### Trace Structure

```
swarm.run
├── plan (2ms)
│   ├── score_task (1ms)
│   └── build_dag (1ms)
├── execute
│   ├── step:classify (450ms, 1.2¢, claude-haiku-4-5)
│   ├── step:research (2100ms, 8.5¢, claude-sonnet-4-6)
│   │   ├── tool:web_search (800ms)
│   │   └── tool:fetch_url (300ms)
│   ├── step:analyze (1800ms, 7.2¢, claude-sonnet-4-6)  [parallel with research]
│   └── step:synthesize (3200ms, 12.0¢, claude-opus-4-6)
│       └── conflict_detected → resolve (400ms)
└── finalize
    ├── merge_results (50ms)
    ├── compute_confidence (10ms)
    └── store_to_memory (120ms, ANCS)
```

### Events

```typescript
swarm.on('step:start', (step) => { ... })
swarm.on('step:complete', (step, result) => { ... })
swarm.on('budget:warning', (usage) => { ... })       // At 80% by default
swarm.on('budget:exhausted', (usage) => { ... })
swarm.on('conflict:detected', (conflict) => { ... })
swarm.on('agent:error', (agent, error) => { ... })
swarm.on('provider:circuit-open', (provider) => { ... })
```

---

## Roadmap

### Phase 1: Core (MVP) -- DONE

**Goal:** Orchestrate agents with budget control. Ship the library.

- [x] Agent abstraction (functional + class)
- [x] Task and Budget types
- [x] Planner: task scoring + DAG generation
- [x] Executor: parallel DAG runner with budget enforcement
- [x] Router: model tier selection
- [x] Patterns: orchestrator-worker, pipeline, map-reduce
- [x] Provider adapters: Anthropic, OpenAI
- [x] Cost tracking and reporting
- [x] Event emitter for observability
- [x] `swarmwire` npm package

### Phase 2: Intelligence -- DONE

**Goal:** Smarter orchestration, more patterns, memory.

- [x] Patterns: debate, blackboard, adaptive
- [x] Conflict resolution (vote, evidence weight, escalate)
- [x] Context packing (token-optimal bundles)
- [x] MCP tool integration
- [x] ANCS memory backend
- [x] Checkpoint/resume for long-running tasks
- [x] Provider failover (circuit breaker)

### Phase 3: Production -- DONE

**Goal:** Production-hardened, enterprise features.

- [x] A2A protocol support (expose + consume)
- [x] Worker pooling and connection pooling
- [x] Adaptive routing (learn from execution history)
- [x] Plan explanation and debugging tools
- [x] Cost optimization recommendations
- [x] Rate limiting and backoff per provider

### Phase 4: Ecosystem -- DONE

**Goal:** Community, integrations, advanced orchestration.

- [x] Workflow YAML definitions (CI/CD-style)
- [x] Pre-built agent templates (researcher, reviewer, synthesizer, data analyst, QA tester, writer, planner)
- [x] Claude Agent SDK integration adapter
- [x] Evolving orchestrator (bandit-based adaptive sequencing)
- [x] Persistence (save/load state to disk or memory backend)
- [x] MessageBoard for inter-agent communication

### Phase 5: Routing Stack -- DONE

**Goal:** Cost-efficient LLM routing through a 5-layer stack.

- [x] Semantic cache (cosine similarity, pluggable embedding + backend)
- [x] Latency router (EMA + P95 latency tracking, multi-objective scoring)
- [x] Cascade router (model ladder, bandit learning, quality estimation)
- [x] Speculative cascade (parallel execution, latency vs cost tradeoff)
- [x] Query decomposer (subtask splitting, per-subtask tier routing)

### Current Stats

68 source modules | 25 test files | 210 tests | 7 agent templates

---

## Research References

### Academic Papers

- [Multi-Agent Collaboration Mechanisms: A Survey of LLMs](https://arxiv.org/abs/2501.06322) — Taxonomy of coordination structures, strategies, and protocols
- [The Orchestration of Multi-Agent Systems: Architectures, Protocols, and Enterprise Adoption](https://arxiv.org/abs/2601.13671) — MCP + A2A integration, planning/policy units, state management, observability
- [Multi-Agent Collaboration via Evolving Orchestration](https://arxiv.org/abs/2505.19591) — RL-trained adaptive orchestrator, cyclic reasoning structures
- [Multi-Agent LLM Orchestration for Incident Response](https://arxiv.org/abs/2511.15755) — 100% actionable rate vs 1.7% for single-agent
- [MasRouter: Learning to Route LLMs for Multi-Agent Systems](https://aclanthology.org/2025.acl-long.757.pdf) — Cost-aware model routing
- [Token-Budget-Aware LLM Reasoning](https://aclanthology.org/2025.findings-acl.1274.pdf) — Budget estimation for reasoning tasks
- [Controlling Performance and Budget of Multi-agent LLM Systems with RL](https://arxiv.org/abs/2511.02755) — Dual rewards for task performance + cost
- [Benchmarking Multi-Agent LLM Architectures for Financial Document Processing](https://arxiv.org/abs/2603.22651) — Cost-accuracy tradeoffs and production scaling
- [Four Design Patterns for Event-Driven Multi-Agent Systems](https://www.confluent.io/blog/event-driven-multi-agent-systems/) — Orchestrator-worker, hierarchical, blackboard, market-based

### Protocols

- [Agent2Agent Protocol (A2A)](https://github.com/a2aproject/A2A) — Google's open protocol for agent-to-agent communication, now under Linux Foundation
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) — Anthropic's protocol for agent-to-tool communication
- [AI Agent Design Patterns — Microsoft](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) — DAG, FSM, CFG pattern comparison

### Framework Analysis

- [Framework Comparison 2026 — Turing](https://www.turing.com/resources/ai-agent-frameworks)
- [Agent Framework Landscape 2025](https://medium.com/@hieutrantrung.it/the-ai-agent-framework-landscape-in-2025-what-changed-and-what-matters-3cd9b07ef2c3)
- [Enterprise Multi-Agent Frameworks — Adopt.ai](https://www.adopt.ai/blog/multi-agent-frameworks)
- [Mastra — TypeScript AI Framework](https://mastra.ai/) — YC W25, $13M, 22k+ stars
- [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) — Anthropic's agent harness
- [Cost Optimization Guide 2026](https://moltbook-ai.com/posts/ai-agent-cost-optimization-2026) — 60-80% spend reduction strategies

---

## Key Decisions & Rationale

| Decision | Choice | Why |
|----------|--------|-----|
| Library vs framework | Library | Composable, no lock-in, wider adoption |
| TypeScript-only vs multi-lang | TypeScript-first | Mastra proved the demand; JS/TS has the largest developer base; Python is well-served already |
| Budget as hard constraint | Yes | The #1 unaddressed problem; every competitor treats cost as advisory |
| ANCS as optional plugin | Yes | Widens audience; ANCS users get premium experience; others still benefit |
| Patterns as composable blocks | Yes | No single topology works for all tasks (academic consensus) |
| A2A support | Phase 3 | Important for interop but not MVP; protocol still maturing (v0.3) |
| Adaptive orchestration | Phase 2/4 | High value but requires execution history; can't ship day one |
| YAML workflows | Phase 4 | Nice-to-have; code-first is more flexible for early adopters |

---

*SwarmWire — The nervous system for AI agent swarms.*
