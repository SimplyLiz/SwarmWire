# Patterns

Multi-agent collaboration patterns. All are standalone async functions — compose them freely.

**Source:** `src/patterns/`

---

## Table of Contents

1. [Orchestrator-Worker](#orchestrator-worker)
2. [Pipeline](#pipeline)
3. [Map-Reduce](#map-reduce)
4. [Debate](#debate)
5. [Blackboard](#blackboard)
6. [Fan-Out](#fan-out)
7. [Hive-Mind](#hive-mind)
8. [Loop Agent](#loop-agent)
9. [State Machine](#state-machine)
10. [Hierarchical Authority](#hierarchical-authority)
11. [Event-Driven Workflow](#event-driven-workflow)
12. [Choosing a Pattern](#choosing-a-pattern)

---

## Orchestrator-Worker

One orchestrator agent breaks down a task and delegates to worker agents.

```typescript
import { runOrchestratorWorker } from 'swarmwire'

const result = await runOrchestratorWorker(
  task,
  { orchestrator, workers: [workerA, workerB] },
  providers,
  budget,
)
```

**Use when:** Tasks are divisible, workers have complementary skills, orchestrator should synthesize output.

---

## Pipeline

Sequential chain — each agent's output becomes the next agent's input.

```typescript
import { runPipeline } from 'swarmwire'

const result = await runPipeline(
  task,
  [collector, analyzer, summarizer],
  providers,
  budget,
)
// result.output is the summarizer's output
```

**Use when:** Stages must happen in order, each stage refines or transforms the previous stage's output.

---

## Map-Reduce

Fan out a task to many agents (map), then merge their outputs (reduce).

```typescript
import { runMapReduce } from 'swarmwire'

const result = await runMapReduce(
  task,
  { mapper: workerAgent, reducer: mergeAgent, concurrency: 5 },
  providers,
  budget,
  items,  // partitioned input — one call per item
)
```

**Use when:** Tasks are embarrassingly parallel (analyze N files, review N PRs).

---

## Debate

Multiple agents argue different positions; a judge synthesizes the best answer.

```typescript
import { runDebate } from 'swarmwire'

const result = await runDebate(
  task,
  {
    debaters: [optimistAgent, pessimistAgent, neutralAgent],
    judge: judgeAgent,
    rounds: 2,
  },
  providers,
  budget,
)
```

**Use when:** High-stakes decisions benefit from adversarial exploration. Adds cost but improves quality on complex reasoning tasks.

---

## Blackboard

Agents read and write to a shared `MessageBoard`. Any agent can read all findings; posting is non-blocking.

```typescript
import { runBlackboard } from 'swarmwire'
import { MessageBoard } from 'swarmwire'

const board = new MessageBoard()

const result = await runBlackboard(
  task,
  [researcherA, researcherB, synthesizerAgent],
  providers,
  budget,
  board,
)

// After execution — read all findings
const findings = board.query({ type: 'finding' })
```

**Use when:** Agents work in parallel and need shared state. Output of one agent can inform others without strict sequencing.

---

## Fan-Out

Send the same task to multiple agents concurrently, collect all results.

```typescript
import { runFanOut } from 'swarmwire'

const results = await runFanOut(
  task,
  [agentA, agentB, agentC],
  providers,
  budget,
)
// results is ExecutionResult[] — one per agent
```

**Use when:** You need multiple independent perspectives on the same input (ensemble outputs, redundancy, comparison).

---

## Hive-Mind

All agents share beliefs via a consensus mechanism. Contradictions trigger automatic resolution.

```typescript
import { runHiveMind } from 'swarmwire'

const result = await runHiveMind(
  task,
  {
    agents: [agentA, agentB, agentC],
    consensusProtocol: 'vote',   // 'vote' | 'raft' | 'gossip'
    rounds: 3,
  },
  providers,
  budget,
)
```

**Use when:** Agents need to converge on a shared truth. Works well for classification, labeling, or consensus-based decisions.

---

## Loop Agent

Runs an agent iteratively until a convergence condition is met.

```typescript
import { runLoop } from 'swarmwire'

const result = await runLoop(
  'Improve this code until tests pass',
  {
    agent: refactoringAgent,
    providers,
    budget,
    maxIterations: 10,

    // Stop when output contains DONE or [COMPLETE] (default)
    shouldStop: (output, iteration) => {
      return String(output).includes('ALL_TESTS_PASS') || iteration >= 10
    },

    // Optionally refine the input between iterations
    refine: (previousOutput, iteration) =>
      `Previous attempt output:\n${previousOutput}\n\nTry again, iteration ${iteration}`,

    onIteration: (iteration, output) => {
      console.log(`Iteration ${iteration}:`, String(output).slice(0, 100))
    },
  },
)

console.log(result.iterations)           // how many loops ran
console.log(result.converged)            // true if shouldStop returned true
console.log(result.history)              // output from each iteration
console.log(result.finalOutput)          // last iteration's output
```

### LoopAgentConfig

```typescript
interface LoopAgentConfig {
  agent: Agent
  providers: Provider[]
  budget: Budget
  maxIterations?: number       // default 10
  shouldStop?: (output: unknown, iteration: number) => boolean
  refine?: (previousOutput: unknown, iteration: number) => string
  onIteration?: (iteration: number, output: unknown) => void
}
```

**Use when:** The task is self-improving — code that needs to pass tests, text that needs editing passes, reports that need to meet quality criteria.

---

## State Machine

LangGraph-style directed graph with cycles, conditional edges, and a maximum iteration guard.

```typescript
import { StateMachine, buildLinearStateMachine, END } from 'swarmwire'

// Build a custom state machine
const sm = new StateMachine<{ draft: string; approved: boolean }>({
  entryNode: 'draft',
  maxIterations: 20,
  nodes: [
    {
      name: 'draft',
      handler: async (state, ctx) => {
        ctx.emit('draft-ready', { content: 'Initial draft...' })
        return { ...state, draft: 'Initial draft...' }
      },
    },
    {
      name: 'review',
      handler: async (state, ctx) => {
        const approved = state.draft.length > 100
        return { ...state, approved }
      },
    },
    {
      name: 'revise',
      handler: async (state) => {
        return { ...state, draft: state.draft + ' [revised]' }
      },
    },
  ],
  edges: [
    { from: 'draft', to: 'review' },
    {
      from: 'review',
      to: (state) => state.approved ? END : 'revise',  // conditional edge
    },
    { from: 'revise', to: 'review' },
  ],
})

const result = await sm.run({ draft: '', approved: false })
console.log(result.state)         // final state
console.log(result.terminated)    // 'completed' | 'max_iterations' | 'error'
console.log(result.stepsExecuted) // number of node executions
console.log(result.history)       // [{ node, state, timestamp }]
```

### Linear state machine helper

```typescript
import { buildLinearStateMachine } from 'swarmwire'

const linear = buildLinearStateMachine(
  [
    { name: 'step1', handler: async (s) => ({ ...s, step1Done: true }) },
    { name: 'step2', handler: async (s) => ({ ...s, step2Done: true }) },
    { name: 'step3', handler: async (s) => ({ ...s, step3Done: true }) },
  ],
  { maxIterations: 5 },
)

const result = await linear.run({})
```

### Visualize as DOT

```typescript
const dot = sm.toDot()
// digraph StateMachine { draft -> review; review -> revise [label="!approved"]; ... }
```

**Use when:** Workflow has complex conditional branching, cycles, or retry loops that can't be expressed as a linear pipeline.

---

## Hierarchical Authority

Formal authority levels with escalation. Low-confidence outputs escalate to higher-authority agents.

```typescript
import { runHierarchy } from 'swarmwire'

const result = await runHierarchy(
  task,
  {
    levels: [
      {
        name: 'executive',
        authority: 1,        // 1 = highest authority
        agents: [ceoAgent],
      },
      {
        name: 'manager',
        authority: 2,
        agents: [managerAgentA, managerAgentB],
      },
      {
        name: 'worker',
        authority: 3,        // N = lowest authority (starts here)
        agents: [workerA, workerB, workerC],
      },
    ],
    maxEscalations: 2,
    escalationThreshold: 0.6,  // escalate if confidence < 0.6
  },
  providers,
  budget,
)
```

**Escalation flow:**
1. Worker agents attempt the task
2. If output confidence < `escalationThreshold`, escalate to managers
3. Managers review worker output and produce a more authoritative answer
4. If still insufficient, escalate to executive level
5. Return best result (highest-authority that responded)

**Use when:** Some queries require domain expertise that junior agents lack. Saves cost on easy tasks while ensuring expert handling for hard ones.

---

## Event-Driven Workflow

Steps subscribe to events rather than a fixed DAG. Topology emerges at runtime.

```typescript
import { EventFlow } from 'swarmwire'

const flow = new EventFlow({
  maxEvents: 1000,
  maxConcurrent: 5,
  steps: [
    {
      name: 'ingester',
      handles: ['data.received'],
      handler: async (event, ctx) => {
        const processed = processData(event.payload)
        ctx.emit('data.ready', processed)
        return null
      },
    },
    {
      name: 'analyzer',
      handles: ['data.ready'],
      handler: async (event, ctx) => {
        const analysis = await analyze(event.payload)
        ctx.emit('analysis.complete', analysis)
        return null
      },
    },
    {
      name: 'reporter',
      handles: ['analysis.complete'],
      handler: async (event, ctx) => {
        const report = formatReport(event.payload)
        ctx.emit('report.ready', report)
        return null  // no further events
      },
    },
  ],
})

// Add steps dynamically at runtime
flow.addStep({
  name: 'notifier',
  handles: ['report.ready'],
  handler: async (event) => {
    await sendSlackMessage(event.payload)
    return null
  },
})

// Subscribe to events for side effects
flow.on('analysis.complete', (event) => {
  console.log('Analysis done:', event.payload)
})

const result = await flow.run([
  { type: 'data.received', payload: rawData, timestamp: Date.now() },
])

console.log(result.processed)   // total events handled
console.log(result.history)     // full event log
console.log(result.errors)      // any step errors
```

### FlowStepDef

```typescript
interface FlowStepDef {
  name: string
  handles: string[]         // event types this step responds to
  handler: FlowStepHandler
  concurrent?: boolean      // default true — can run alongside other steps
}

type FlowStepHandler = (
  event: FlowEvent,
  ctx: FlowContext,
) => Promise<FlowEvent | FlowEvent[] | null>
```

**Use when:** Workflow topology isn't known ahead of time, steps are loosely coupled, or you need dynamic step addition. Especially useful for data ingestion pipelines and reactive architectures.

---

## Choosing a Pattern

| Pattern | When to use | Cost | Latency |
|---------|-------------|------|---------|
| Pipeline | Sequential refinement | Low | Medium |
| Map-Reduce | Parallel + merge | Medium | Low (parallel) |
| Orchestrator-Worker | Dynamic delegation | Medium | Medium |
| Fan-Out | Multiple independent perspectives | Medium | Low (parallel) |
| Debate | High-stakes reasoning | High | High |
| Blackboard | Shared state, emergent coordination | Medium | Medium |
| Hive-Mind | Consensus across agents | High | High |
| Loop | Self-improving, iterative refinement | Variable | Variable |
| State Machine | Complex conditional branching | Low overhead | Low overhead |
| Hierarchy | Mixed-expertise teams | Medium | Medium |
| Event-Driven | Loose coupling, reactive | Low overhead | Low overhead |

**Quick decision tree:**

```
Need output from multiple agents combined?
  YES — outputs are parallel     → Map-Reduce or Fan-Out
  YES — output refines output    → Pipeline or Loop
  YES — agents disagree          → Debate or Hierarchy
  YES — agents share context     → Blackboard or Hive-Mind
  NO  — one agent, complex flow  → State Machine or Event-Driven
  NO  — one agent, until good    → Loop
```
