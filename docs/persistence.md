# Persistence

Save and restore SwarmWire state across sessions. Checkpoint and resume plan execution. Skip unchanged steps with differential execution.

**Source:** `src/persistence/store.ts`, `src/executor/checkpoint.ts`, `src/executor/diff-execute.ts`

---

## Table of Contents

1. [State Persistence](#state-persistence)
2. [Checkpoint / Resume](#checkpoint--resume)
3. [Differential Execution](#differential-execution)
4. [State Serialization Format](#state-serialization-format)
5. [Recovery Patterns](#recovery-patterns)
6. [Time-Travel Debugging](#time-travel-debugging)
7. [Agent Rollback](#agent-rollback)

---

## State Persistence

### SwarmWireState

The top-level state object that persists across sessions:

```typescript
interface SwarmWireState {
  version: string                         // schema version
  savedAt: number                         // epoch ms
  adaptiveRouterHistory: ExecutionRecord[] // learning data for adaptive routing
  orchestratorSequences: Record<string, Array<{
    agentOrder: string[]
    avgQuality: number
    avgCostCents: number
    uses: number
  }>>
}
```

### saveState / loadState (file-based)

```typescript
import { saveState, loadState, emptyState } from './persistence/store.js'

// Save to disk
const state: SwarmWireState = {
  version: '0.1.0',
  savedAt: Date.now(),
  adaptiveRouterHistory: adaptive.getHistory(),
  orchestratorSequences: orchestrator.getSequences(),
}
await saveState(state, '.swarmwire/state.json')

// Load from disk (returns null if file missing or corrupt)
const restored = await loadState('.swarmwire/state.json')
if (restored) {
  adaptive.importHistory(restored.adaptiveRouterHistory)
}
```

`saveState` creates parent directories automatically via `mkdir(recursive: true)`.

`loadState` returns `null` on any error (missing file, parse failure) -- no exceptions thrown.

### saveStateToMemory / loadStateFromMemory (memory backend)

For integration with ANCS or any `MemoryBackend`:

```typescript
import { saveStateToMemory, loadStateFromMemory } from './persistence/store.js'

// Save to memory backend (e.g., CognitiveVault ANCS)
await saveStateToMemory(state, memoryBackend, 'swarmwire:state')

// Load from memory backend
const restored = await loadStateFromMemory(memoryBackend, 'swarmwire:state')
```

The default key is `'swarmwire:state'`. Messages are tagged with `['swarmwire', 'state']` for queryability.

### emptyState()

Creates a clean initial state:

```typescript
import { emptyState } from './persistence/store.js'

const state = emptyState()
// { version: '0.1.0', savedAt: <now>, adaptiveRouterHistory: [], orchestratorSequences: {} }
```

---

## Checkpoint / Resume

Checkpoints capture the mid-execution state of a plan so it can be resumed after failure or interruption.

### Checkpoint structure

```typescript
interface Checkpoint {
  id: string                        // e.g. 'ckpt_m1abc2d'
  planId: string
  createdAt: number                 // epoch ms
  stepStates: StepSnapshot[]
  stepOutputs: Map<string, unknown> // stepId -> output
  costEvents: CostEvent[]
}

interface StepSnapshot {
  stepId: string
  status: StepStatus                // 'pending' | 'running' | 'complete' | 'failed' | 'skipped'
  output?: unknown
  error?: string
  cost?: CostEvent
}
```

### Creating a checkpoint

```typescript
import { createCheckpoint } from './executor/checkpoint.js'

const checkpoint = createCheckpoint(plan, stepOutputs, costEvents)
// checkpoint.id = 'ckpt_m1abc2d'
// checkpoint.stepStates = [{ stepId: 'step_1', status: 'complete', output: '...' }, ...]
```

Call this after each step completes, or at strategic intervals. The checkpoint captures a deep copy of `stepOutputs` and `costEvents`.

### Restoring from a checkpoint

```typescript
import { restoreFromCheckpoint } from './executor/checkpoint.js'

const { plan: restoredPlan, stepOutputs, costEvents } = restoreFromCheckpoint(plan, checkpoint)
```

Restore behavior by step status:
- `complete` -- preserved as-is (output and cost retained)
- `failed` / `skipped` -- reset to `pending` for retry
- `running` / `pending` -- reset to `pending`

This means resuming from a checkpoint automatically retries any steps that previously failed.

### Serialization

Checkpoints use `Map` internally for `stepOutputs`, which does not survive `JSON.stringify`. Use the provided serialization helpers:

```typescript
import { serializeCheckpoint, deserializeCheckpoint } from './executor/checkpoint.js'

// To JSON string (Map -> Object)
const json = serializeCheckpoint(checkpoint)
await fs.writeFile('checkpoint.json', json)

// From JSON string (Object -> Map)
const raw = await fs.readFile('checkpoint.json', 'utf-8')
const restored = deserializeCheckpoint(raw)
```

### Full checkpoint/resume loop

```typescript
import {
  createCheckpoint,
  restoreFromCheckpoint,
  serializeCheckpoint,
  deserializeCheckpoint,
} from './executor/checkpoint.js'
import { readFile, writeFile } from 'node:fs/promises'

const CHECKPOINT_PATH = '.swarmwire/checkpoint.json'

async function executeWithCheckpoints(plan: Plan) {
  const stepOutputs = new Map<string, unknown>()
  const costEvents: CostEvent[] = []

  // Try to resume from previous checkpoint
  try {
    const raw = await readFile(CHECKPOINT_PATH, 'utf-8')
    const checkpoint = deserializeCheckpoint(raw)
    const restored = restoreFromCheckpoint(plan, checkpoint)
    Object.assign(plan, restored.plan)
    restored.stepOutputs.forEach((v, k) => stepOutputs.set(k, v))
    costEvents.push(...restored.costEvents)
    console.log(`Resumed from checkpoint ${checkpoint.id}`)
  } catch {
    console.log('No checkpoint found, starting fresh')
  }

  for (const step of plan.steps) {
    if (step.status === 'complete') continue // already done

    try {
      const output = await executeStep(step, stepOutputs)
      step.status = 'complete'
      step.output = output
      stepOutputs.set(step.id, output)

      // Checkpoint after each step
      const ckpt = createCheckpoint(plan, stepOutputs, costEvents)
      await writeFile(CHECKPOINT_PATH, serializeCheckpoint(ckpt))
    } catch (err) {
      step.status = 'failed'
      step.error = String(err)
      // Checkpoint the failure state too
      const ckpt = createCheckpoint(plan, stepOutputs, costEvents)
      await writeFile(CHECKPOINT_PATH, serializeCheckpoint(ckpt))
      throw err
    }
  }
}
```

---

## Differential Execution

Only re-run steps whose inputs actually changed. Turns expensive full re-runs into cheap incremental updates.

### diffPlans()

Compares a new plan against a previous execution result:

```typescript
import { diffPlans } from './executor/diff-execute.js'

const diff = diffPlans(newPlan, previousResult)
// {
//   changedSteps: ['step_3'],    // inputs changed -> must re-run
//   reusableSteps: ['step_1', 'step_2'],  // inputs identical -> skip
//   cascadeSteps: ['step_4'],    // depends on a changed step -> must re-run
//   savingsFraction: 0.4,        // 2/5 steps reusable = 40% savings
// }
```

### How it works

**Phase 1 -- Direct change detection:** Each step's input is hashed with SHA-256 (first 16 hex chars). If the hash matches the previous step's input hash and the previous step completed successfully, it is marked reusable.

**Phase 2 -- Cascade propagation:** If any step in the dependency chain changed, all downstream dependents must also re-run, even if their own inputs are identical. This propagates iteratively until no new cascade steps are found.

### applyPreviousResults()

Marks reusable steps as `complete` in the new plan, copying over their output and cost from the previous run:

```typescript
import { diffPlans, applyPreviousResults } from './executor/diff-execute.js'

const diff = diffPlans(newPlan, previousResult)
applyPreviousResults(newPlan, previousResult, diff)

// Now newPlan.steps[0].status === 'complete' (reused)
// newPlan.steps[2].status === 'pending' (needs re-execution)
```

### Full differential execution loop

```typescript
import { diffPlans, applyPreviousResults } from './executor/diff-execute.js'

async function executeIncrementally(
  newPlan: Plan,
  previousResult: ExecutionResult | null,
) {
  if (previousResult) {
    const diff = diffPlans(newPlan, previousResult)
    console.log(`Reusing ${diff.reusableSteps.length} steps, re-running ${diff.changedSteps.length + diff.cascadeSteps.length}`)
    console.log(`Estimated savings: ${(diff.savingsFraction * 100).toFixed(0)}%`)

    applyPreviousResults(newPlan, previousResult, diff)
  }

  // Only execute pending steps
  for (const step of newPlan.steps) {
    if (step.status === 'complete') continue
    const output = await executeStep(step)
    step.status = 'complete'
    step.output = output
  }

  return newPlan
}
```

---

## State Serialization Format

### SwarmWireState JSON (persistence/store.ts)

```json
{
  "version": "0.1.0",
  "savedAt": 1711411200000,
  "adaptiveRouterHistory": [
    {
      "taskDomain": ["code"],
      "taskDifficulty": "hard",
      "agentName": "code-agent",
      "model": "claude-sonnet-4-20250514",
      "provider": "anthropic",
      "success": true,
      "costCents": 12,
      "durationMs": 3400,
      "qualityScore": 0.88,
      "timestamp": 1711411200000
    }
  ],
  "orchestratorSequences": {
    "security-review": [
      {
        "agentOrder": ["scanner", "reviewer", "reporter"],
        "avgQuality": 0.85,
        "avgCostCents": 15,
        "uses": 42
      }
    ]
  }
}
```

### Checkpoint JSON (executor/checkpoint.ts)

```json
{
  "id": "ckpt_m1abc2d",
  "planId": "plan_xyz",
  "createdAt": 1711411200000,
  "stepStates": [
    {
      "stepId": "step_1",
      "status": "complete",
      "output": "Analysis result...",
      "cost": { "inputTokens": 500, "outputTokens": 200, "costCents": 0.5 }
    },
    {
      "stepId": "step_2",
      "status": "failed",
      "error": "Timeout after 30000ms"
    }
  ],
  "stepOutputs": {
    "step_1": "Analysis result..."
  },
  "costEvents": []
}
```

Note: `serializeCheckpoint` converts `Map<string, unknown>` to a plain object. `deserializeCheckpoint` converts it back.

---

## Recovery Patterns

### Pattern 1: Auto-save on every step

Checkpoint after each step completes. On restart, resume from the last successful step.

```typescript
for (const step of plan.steps) {
  if (step.status === 'complete') continue
  await executeStep(step)
  const ckpt = createCheckpoint(plan, outputs, costs)
  await writeFile(path, serializeCheckpoint(ckpt))
}
```

### Pattern 2: Retry failed steps with backoff

```typescript
const MAX_RETRIES = 3

async function executeWithRetry(plan: Plan, checkpoint: Checkpoint | null) {
  if (checkpoint) {
    const restored = restoreFromCheckpoint(plan, checkpoint)
    // failed steps are now 'pending' again
  }

  for (const step of plan.steps) {
    if (step.status === 'complete') continue

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        step.output = await executeStep(step)
        step.status = 'complete'
        break
      } catch (err) {
        if (attempt === MAX_RETRIES - 1) {
          step.status = 'failed'
          step.error = String(err)
        }
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
      }
    }
  }
}
```

### Pattern 3: Differential re-run on config change

When only a subset of agents or prompts change, re-run only the affected steps:

```typescript
const previousResult = await loadPreviousResult()
const newPlan = buildPlan(updatedConfig)

const diff = diffPlans(newPlan, previousResult)
if (diff.savingsFraction > 0) {
  applyPreviousResults(newPlan, previousResult, diff)
}

await executePendingSteps(newPlan)
```

### Pattern 4: Dual persistence (file + memory backend)



```typescript
import { saveState, saveStateToMemory, loadState, loadStateFromMemory } from './persistence/store.js'

// Save to both
await Promise.all([
  saveState(state, '.swarmwire/state.json'),
  saveStateToMemory(state, memoryBackend),
])

// Load with fallback
const state = await loadStateFromMemory(memoryBackend) ?? await loadState('.swarmwire/state.json')
```

---

## Time-Travel Debugging

**Source:** `src/executor/time-travel.ts`

Records a timeline entry after each step completes. At any point you can rewind to a previous step and fork execution from there with optional modifications.

```typescript
import { TimeTravelStore } from 'swarmwire'

const ttStore = new TimeTravelStore(100)  // keep last 100 timeline entries

// Pass to ExecutorConfig — timeline is recorded automatically
const result = await executePlan(plan, {
  providers,
  budget,
  timelineStore: ttStore,
})

// Inspect the timeline
const timeline = ttStore.getTimeline(plan.id)
// [{ stepId, stepName, checkpoint, capturedAt }]

// Rewind to a specific step
const checkpoint = ttStore.rewindTo(plan.id, 'step_3')
// checkpoint is the state captured immediately after step_3 completed

// Fork from step_3 with a modified step
const fork = await ttStore.fork(plan.id, {
  fromStepId: 'step_3',
  modifications: [
    { id: 'step_4', agentName: 'alternate-agent' },  // swap agent for step_4
  ],
}, { providers, budget })

console.log(fork.execution.output)    // result of the forked execution
console.log(fork.forkedFromStep)      // 'step_3'
console.log(fork.divergedAt)          // timestamp when fork diverged

// Export/import timeline (for persistence)
const exported = ttStore.export()
ttStore.import(exported)
```

### TimeTravelStore API

```typescript
class TimeTravelStore {
  constructor(maxHistory?: number)  // default 100

  record(planId, stepId, stepName, plan, outputs, costEvents): void
  getTimeline(planId): TimelineEntry[]
  rewindTo(planId, stepId): Checkpoint | null
  fork<T>(planId, options: ForkOptions, config: ExecutorConfig): Promise<ForkResult<T>>
  clear(planId): void
  export(): Record<string, TimelineEntry[]>
  import(data): void
}

interface ForkOptions {
  fromStepId: string
  modifications?: Partial<Step>[]
}
```

---

## Agent Rollback

**Source:** `src/executor/rollback.ts`

Captures before-state snapshots before tool calls. Supports undoing individual actions or entire executions in reverse order.

```typescript
import { RollbackManager } from 'swarmwire'

const rollback = new RollbackManager(200)  // keep last 200 snapshots

// Pass to ExecutorConfig — snapshots captured automatically around tool calls
const result = await executePlan(plan, {
  providers,
  budget,
  rollbackManager: rollback,
})

// After execution — inspect snapshots
const snapshots = rollback.getSnapshots(result.executionId)
// [{ id, executionId, stepId, agentName, actionType, beforeState, afterState, reversible }]

// Undo a specific action
const undoResult = rollback.rollback(snapshots[2].id)
// { snapshotId, restored: true }

// Undo all reversible actions in the execution (reverse order)
const results = rollback.undoExecution(result.executionId)
// [{ snapshotId, restored }]

// Clear snapshot history for an execution
rollback.clear(result.executionId)
```

### Tool rollback integration

Tools can define a `rollback` handler that is called when `RollbackManager.rollback()` targets a `tool_call` snapshot:

```typescript
const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write content to a file',
  parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
  execute: async ({ path, content }) => {
    const prev = await readFile(path).catch(() => null)
    await writeFile(path, content)
    return { path, written: content.length }
  },
  rollback: async (output, input) => {
    // Restore previous content on rollback
    if (input.previousContent !== undefined) {
      await writeFile(input.path, input.previousContent)
    }
  },
}
```

### ActionSnapshot shape

```typescript
interface ActionSnapshot {
  id: string
  executionId: string
  stepId: string
  agentName: string
  actionType: string     // 'llm_call' | 'tool_call' | 'file_write' | ...
  beforeState: unknown
  afterState?: unknown
  timestamp: number
  reversible: boolean
}
```
