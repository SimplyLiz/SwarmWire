# SwarmWire Routing System

Cost-efficient LLM routing through a 5-layer stack. Each layer independently
reduces cost; combined, they can cut API spend by 40-85% with minimal quality
loss.

```
                    Architecture
                    ----------

    +--------------------------------------------------+
    |                  Incoming Query                   |
    +--------------------------------------------------+
              |
              v
    +--------------------------------------------------+
    | Layer 1: Semantic Cache                          |
    | Hit? Return cached response (zero cost).         |
    | Miss? Pass through to Layer 2.                   |
    | Paper: GPT Semantic Cache (arXiv:2411.05276)     |
    +--------------------------------------------------+
              |
              v
    +--------------------------------------------------+
    | Layer 2: Latency Router                          |
    | Pick the fastest model that meets quality/cost   |
    | constraints. Tracks EMA + P95 latency per model. |
    | Paper: SCORE (Harvard)                           |
    +--------------------------------------------------+
              |
              v
    +--------------------------------------------------+
    | Layer 3: Cascade Router                          |
    | Try cheapest model first. Escalate if quality    |
    | is below threshold. Bandit learning over time.   |
    | Papers: arXiv:2410.10347 (ICLR 2025),           |
    |         CARGO (arXiv:2509.14899),                |
    |         MixLLM / MetaLLM                         |
    +--------------------------------------------------+
              |
              v
    +--------------------------------------------------+
    | Layer 4: Speculative Cascade                     |
    | Run cheap + mid models in parallel. Accept       |
    | cheapest that passes quality. Cuts escalation    |
    | latency in half.                                 |
    | Paper: arXiv:2405.19261                          |
    +--------------------------------------------------+
              |
              v
    +--------------------------------------------------+
    | Layer 5: Query Decomposer                        |
    | Break complex queries into subtasks. Route each  |
    | subtask to cheapest model at its complexity tier. |
    | Paper: R2-Reasoner (arXiv:2603.04445)            |
    +--------------------------------------------------+
              |
              v
    +--------------------------------------------------+
    |               Final Response                     |
    +--------------------------------------------------+
```

Supporting components:

- **Base Router** (`router.ts`) -- static model selection by task score and budget.
- **Adaptive Router** (`adaptive-router.ts`) -- learns from execution history which
  agent/model pairs perform best per domain.


---

## Table of Contents

1. [Layer 1: Semantic Cache](#layer-1-semantic-cache)
2. [Layer 2: Latency Router](#layer-2-latency-router)
3. [Layer 3: Cascade Router](#layer-3-cascade-router)
4. [Layer 4: Speculative Cascade](#layer-4-speculative-cascade)
5. [Layer 5: Query Decomposer](#layer-5-query-decomposer)
6. [Base Router](#base-router)
7. [Adaptive Router](#adaptive-router)
8. [Full Stack Example](#full-stack-example)
9. [Cost Savings Benchmarks](#cost-savings-benchmarks)


---

## Layer 1: Semantic Cache

**Source:** `src/planner/semantic-cache.ts`
**Paper:** GPT Semantic Cache (arXiv:2411.05276)

Embeds queries as vectors and uses cosine similarity to detect near-duplicates.
A cache hit returns a stored response at zero API cost. The paper reports
61-68% hit rate with 97%+ accuracy, yielding up to 68% API cost reduction on
repetitive workloads.

### Configuration

```typescript
interface SemanticCacheConfig {
  /** Cosine similarity threshold for hits. Default: 0.85 */
  similarityThreshold?: number
  /** Max cache entries. Default: 10_000 */
  maxEntries?: number
  /** TTL in ms. Default: 3_600_000 (1 hour) */
  ttlMs?: number
  /** Custom embedding function. Default: character trigram hashing */
  embedFn?: (text: string) => Promise<number[]> | number[]
  /** Custom cache backend. Default: in-memory Map */
  backend?: CacheBackend
}
```

The `CacheBackend` interface lets you swap in Redis or any external store:

```typescript
interface CacheBackend {
  get(embedding: number[], threshold: number): Promise<CacheEntry | null>
  set(embedding: number[], entry: CacheEntry): Promise<void>
  clear(): Promise<void>
  size(): Promise<number>
}
```

### API

```typescript
import { SemanticCache } from './planner/semantic-cache.js'

const cache = new SemanticCache({
  similarityThreshold: 0.90,  // tighter match for production
  ttlMs: 30 * 60 * 1000,     // 30 min TTL
  embedFn: async (text) => myEmbeddingModel.embed(text),
})

// --- Manual lookup/store ---
const cached = await cache.lookup(request)
if (cached) {
  // Zero-cost cache hit. cached.cachedInputTokens is set for tracking.
  return cached
}
const response = await provider.chat(request)
await cache.store(request, response, estimatedCostCents)

// --- Or use the convenience wrapper ---
const result = await cache.cachedChat(
  request,
  (req) => provider.chat(req),
  (model, inp, out) => provider.estimateCost(model, inp, out),
)
console.log(result.cacheHit) // true | false

// --- Stats ---
const stats = cache.stats()
// { hits, misses, hitRate, entries, estimatedSavingsCents }
```

### When to use

- High query repetition (support bots, FAQ-style workloads, batch processing).
- When the same user asks minor rephrases of the same question.
- NOT suitable when every query is unique (creative writing, code generation on novel codebases).

### Default embedding

Without `embedFn`, the cache uses a 256-dimension character trigram hash.
This is fast and zero-cost but less accurate than real embeddings.
For production, provide an embedding function backed by a model like
`text-embedding-3-small`.


---

## Layer 2: Latency Router

**Source:** `src/planner/latency-router.ts`
**Paper:** SCORE (Harvard) -- constrained optimization over quality, cost, and latency.

Tracks per-model latency via exponential moving average (EMA) and P95.
Scores models on a weighted combination of latency, cost, and quality tier,
then picks the best one subject to constraints.

### Configuration

```typescript
interface LatencyRouterConfig {
  /** The model ladder (from CascadeRouter or buildModelLadder) */
  ladder: ModelLadder
  /** Max acceptable latency in ms. Default: no limit */
  maxLatencyMs?: number
  /** Minimum quality tier. Default: 'cheap' */
  minTier?: ModelTier  // 'cheap' | 'standard' | 'premium' | 'reasoning'
  /** Optimization target. Default: 'balanced' */
  optimizeFor?: 'latency' | 'cost' | 'balanced'
  /** EMA smoothing factor (0-1). Default: 0.3 */
  emaSmoothing?: number
}
```

### Scoring weights

| `optimizeFor` | Latency | Cost | Quality Tier |
|---------------|---------|------|-------------|
| `'latency'`  | 0.70    | 0.10 | 0.20        |
| `'cost'`     | 0.10    | 0.70 | 0.20        |
| `'balanced'` | 0.35    | 0.35 | 0.30        |

Models exceeding `maxLatencyMs` get their score multiplied by 0.1.

### API

```typescript
import { LatencyRouter } from './planner/latency-router.js'

const latencyRouter = new LatencyRouter({
  ladder,
  maxLatencyMs: 3000,
  optimizeFor: 'balanced',
})

// Record observations after each call
latencyRouter.recordLatency('anthropic', 'claude-sonnet-4-20250514', 1200)
latencyRouter.recordLatency('openai', 'gpt-4o-mini', 450)

// Pick best model under current constraints
const rung = latencyRouter.pick()
// rung.provider, rung.model, rung.costPer1kTokens, rung.tier

// Get all tracked stats
const stats = latencyRouter.getStats()
// [{ model, provider, emaLatencyMs, p95LatencyMs, samples }]

// Persist/restore state
const state = latencyRouter.exportState()
latencyRouter.importState(state)
```

### When to use

- Real-time applications with latency SLAs.
- Multi-region setups where the same model has different latency profiles.
- As a pre-filter before the cascade: pick the latency-optimal starting model.


---

## Layer 3: Cascade Router

**Source:** `src/planner/cascade-router.ts`
**Papers:**
- Cascade routing (arXiv:2410.10347, ICLR 2025)
- CARGO confidence-aware routing (arXiv:2509.14899)
- MixLLM / MetaLLM (online bandit learning)

The core routing engine. Builds a "model ladder" sorted cheapest-to-most-expensive,
then tries the cheapest viable model first. If response quality is below threshold,
escalates to the next rung. Over time, bandit learning tracks which models handle
which query types, skipping models that historically fail for a given profile.

### Configuration

```typescript
interface CascadeRouterConfig {
  /** All available providers */
  providers: Provider[]
  /** Quality threshold (0-1). Below this, escalate. Default: 0.7 */
  qualityThreshold?: number
  /** Max models to try per query. Default: 3 */
  maxEscalations?: number
  /** Quality estimation strategy. Default: 'heuristic' */
  qualityEstimator?: 'heuristic' | 'self-check' | QualityEstimatorFn
  /** CARGO-style confidence gap threshold. Default: 0.1 */
  confidenceGap?: number
  /** Bandit exploration rate (0-1). Default: 0.1 */
  explorationRate?: number
  /** Budget constraints */
  budget?: Budget
}
```

### Quality Estimators

Three built-in strategies:

**`'heuristic'`** (default) -- No extra API calls. Combines four signals:

| Signal            | Score Range | What it checks                         |
|-------------------|-------------|----------------------------------------|
| Tier prior        | 0.00-0.25   | Higher tier = higher baseline          |
| Completion        | 0.00-0.30   | `stop` finish reason vs `max_tokens`   |
| Response substance| 0.00-0.25   | Content length relative to query       |
| Output efficiency | 0.00-0.20   | Output/input token ratio               |

**`'self-check'`** -- Analyzes the response text for confidence signals.
Looks for uncertainty phrases ("I'm not sure", "I cannot") and confidence
markers ("specifically", "for example"). Also checks for code blocks, lists,
and finish reason. Based on Self-REF (arXiv:2603.04445).

**Custom function:**

```typescript
const router = new CascadeRouter({
  providers,
  qualityEstimator: (request, response, model) => {
    // Your custom scoring logic
    return 0.85
  },
})
```

### Query Classification (Bandit Learning)

Queries are auto-classified into profiles like `code:short`, `math:medium`,
`creative:long`. The bandit tracker maintains per-model success rates for
each profile. After enough data (3+ observations), the router skips models
that historically fail for a given profile.

Detected domains: `code`, `math`, `creative`, `analysis`, `explanation`, `general`.
Complexity buckets: `short` (<500 chars), `medium` (500-2000), `long` (>2000).

### API

```typescript
import { CascadeRouter, buildModelLadder } from './planner/cascade-router.js'

const router = new CascadeRouter({
  providers: [anthropicProvider, openaiProvider],
  qualityThreshold: 0.75,
  maxEscalations: 3,
  explorationRate: 0.05,  // less exploration in production
  budget: { maxCostCents: 50 },
})

// View the model ladder
const ladder = router.getLadder()
// ladder.rungs: [{ provider, model, costPer1kTokens, tier }]

// Route a request through the cascade
const result = await router.route({
  model: '',  // ignored -- cascade picks the model
  messages: [{ role: 'user', content: 'Explain monads in Haskell' }],
})

console.log(result.model.model)       // e.g. "claude-haiku-3-5"
console.log(result.escalations)       // 0 = first model worked
console.log(result.totalCostCents)    // actual cost incurred
console.log(result.qualityScore)      // quality estimate
console.log(result.modelsTriedNames)  // ["claude-haiku-3-5"]
console.log(result.trace)             // full per-model trace

// One-shot routing (no cascade, just bandit scores)
const rung = router.routeDirect('code:short')

// Inspect learning state
const stats = router.getStats()
// { totalModels, modelStats: [...], costSavingsEstimate }

// Persist/restore bandit state
const state = router.exportState()
router.importState(state)
```

### CascadeResult shape

```typescript
interface CascadeResult {
  response: LlmResponse
  provider: Provider
  model: ProviderModelInfo
  qualityScore: number
  escalations: number           // 0 means first model accepted
  totalCostCents: number        // sum of all attempted models
  modelsTriedNames: string[]
  trace: CascadeTrace[]         // per-model breakdown
}

interface CascadeTrace {
  model: string
  provider: string
  tier: ModelTier
  costCents: number
  qualityScore: number
  accepted: boolean
  durationMs: number
}
```

### When to use

- Default choice for most workloads. Handles everything from simple Q&A to
  complex reasoning by automatically escalating.
- Best when you have 2-4 model tiers available (e.g., Haiku/Sonnet/Opus).
- For latency-critical paths, pair with SpeculativeCascade instead.


---

## Layer 4: Speculative Cascade

**Source:** `src/planner/speculative-cascade.ts`
**Paper:** Faster Cascades via Speculative Decoding (arXiv:2405.19261)

Runs N models in parallel instead of sequentially. Accepts the cheapest one
that passes quality. Trades higher token cost for lower latency -- if the
cheap model passes, the parallel work is wasted but latency equals the cheap
model's latency. If escalation is needed, the result is already available.

### Configuration

```typescript
interface SpeculativeCascadeConfig {
  /** The model ladder */
  ladder: ModelLadder
  /** Number of models to run in parallel. Default: 2 */
  parallelWidth?: number
  /** Quality threshold. Default: 0.7 */
  qualityThreshold?: number
  /** Quality estimator function */
  qualityEstimator?: QualityEstimatorFn
}
```

### API

```typescript
import { speculativeCascade } from './planner/speculative-cascade.js'
import { buildModelLadder } from './planner/cascade-router.js'

const ladder = buildModelLadder([anthropicProvider, openaiProvider])

const result = await speculativeCascade(request, {
  ladder,
  parallelWidth: 3,         // run 3 cheapest models in parallel
  qualityThreshold: 0.7,
})

console.log(result.winnerSlot)          // 0 = cheapest won
console.log(result.totalCostCents)      // includes wasted parallel work
console.log(result.sequentialCostCents) // what sequential cascade would cost
console.log(result.latencySavedMs)      // ms saved vs sequential
console.log(result.trace)               // per-model trace
```

### SpeculativeResult shape

```typescript
interface SpeculativeResult {
  response: LlmResponse
  provider: Provider
  model: ProviderModelInfo
  qualityScore: number
  winnerSlot: number           // 0 = cheapest model
  totalCostCents: number       // all parallel models combined
  sequentialCostCents: number  // cost if done sequentially
  latencySavedMs: number
  trace: CascadeTrace[]
}
```

### When to use

- Latency-sensitive paths where you can afford extra token spend.
- When escalation is common (>30% of queries need a bigger model).
- NOT when cost is the primary constraint -- parallel execution always costs
  at least as much as the cheapest model alone.

### Cost vs latency tradeoff

| Scenario                     | Sequential Cascade | Speculative (width=2) |
|------------------------------|-------------------|-----------------------|
| Cheap model passes (70%)     | 1x cost, 1x lat  | ~1.5x cost, 1x lat   |
| Escalation needed (30%)      | 2x cost, 2x lat  | ~2x cost, 1x lat     |
| **Weighted average**         | 1.3x cost, 1.3x lat | ~1.65x cost, 1x lat |


---

## Layer 5: Query Decomposer

**Source:** `src/planner/query-decomposer.ts`
**Paper:** R2-Reasoner (arXiv:2603.04445) -- 84.46% API cost savings

Breaks complex multi-part queries into subtasks, classifies each subtask's
complexity, and routes each to the cheapest model at the appropriate tier.
Simple subtasks go to cheap models; only genuinely complex subtasks hit premium.

### Decomposition

```typescript
import { decomposeQuery } from './planner/query-decomposer.js'

const decomposed = decomposeQuery(
  '1. List all API endpoints\n2. Explain the auth flow\n3. Analyze security risks'
)

// decomposed.subtasks:
// [
//   { id: 'task_0', description: 'List all API endpoints',
//     complexity: 'trivial', recommendedTier: 'cheap', dependencies: [] },
//   { id: 'task_1', description: 'Explain the auth flow',
//     complexity: 'moderate', recommendedTier: 'standard', dependencies: ['task_0'] },
//   { id: 'task_2', description: 'Analyze security risks',
//     complexity: 'complex', recommendedTier: 'premium', dependencies: ['task_1'] },
// ]
```

### Complexity classification rules

| Complexity  | Criteria                                                  | Tier       | Max tokens |
|-------------|-----------------------------------------------------------|------------|-----------|
| `trivial`   | <15 words + lookup verbs (what is, define, list, get)     | `cheap`    | 256       |
| `simple`    | No analysis keywords, <40 words                          | `cheap`    | 1024      |
| `moderate`  | explain/how/why/implement/create/write, or 40-100 words   | `standard` | 4096      |
| `complex`   | analyze/compare/design/architect, or >100 words           | `premium`  | 4096      |

### Execution

```typescript
import { decomposeQuery, executeDecomposed } from './planner/query-decomposer.js'
import { buildModelLadder } from './planner/cascade-router.js'

const ladder = buildModelLadder(providers)
const decomposed = decomposeQuery(userQuery)
const result = await executeDecomposed(decomposed, ladder, 'You are a helpful assistant.')

console.log(result.totalCostCents)        // actual cost
console.log(result.fullQueryCostEstimate) // what premium-only would cost
console.log(result.savings)               // difference
console.log(result.responses)             // per-subtask responses
```

### DecompositionResult shape

```typescript
interface DecompositionResult {
  responses: SubtaskResponse[]
  totalCostCents: number
  fullQueryCostEstimate: number   // cost if sent whole query to premium
  savings: number
}

interface SubtaskResponse {
  subtaskId: string
  response: LlmResponse
  model: string
  provider: string
  costCents: number
}
```

### When to use

- Multi-step or multi-part user queries (numbered lists, bullet points).
- Batch processing where queries naturally decompose.
- NOT for single-focus queries that cannot be split meaningfully.
  The decomposer returns a single subtask in that case and adds no value.


---

## Base Router

**Source:** `src/planner/router.ts`

Static, one-shot model selection. Given a `TaskScore` (which includes a
recommended `modelTier` and `domain`), picks the cheapest model at or above
that tier, respecting budget model preferences.

### API

```typescript
import { routeModel, matchAgent } from './planner/router.js'

// Select model by task score
const route = routeModel(taskScore, providers, budget)
// { provider, model, tier, costPer1kTokens }

// Match agent by capabilities
const agent = matchAgent(['code-review', 'testing'], agents)
```

`routeModel` is useful as a fallback or for simple pipelines that do not
need cascade/bandit logic. It does not learn or track history.


---

## Adaptive Router

**Source:** `src/planner/adaptive-router.ts`

Maintains an execution history and scores agents based on observed
success rate, cost, quality, and recency. Uses a composite scoring formula:

```
score = avgQuality * 0.4 + successRate * 0.3 + costEfficiency * 0.2 + recencyBoost * 0.1
```

Recency decays over 1 week. Cost efficiency is `1 - min(1, avgCostCents / 100)`.

### API

```typescript
import { AdaptiveRouter } from './planner/adaptive-router.js'

const adaptive = new AdaptiveRouter(1000)  // keep last 1000 records

// Record execution outcomes
adaptive.record({
  taskDomain: ['code'],
  taskDifficulty: 'hard',
  agentName: 'code-agent',
  model: 'claude-sonnet-4-20250514',
  provider: 'anthropic',
  success: true,
  costCents: 12,
  durationMs: 3400,
  qualityScore: 0.88,
  timestamp: Date.now(),
})

// Score all agents for a task
const scores = adaptive.scoreAgents(agents, taskScore)
// [{ agentName, successRate, avgCostCents, avgDurationMs, avgQuality, totalExecutions, score }]

// Pick best agent
const best = adaptive.pickAgent(agents, taskScore)

// Get tier recommendation based on historical quality/cost
const tier = adaptive.recommendTier(taskScore)
// Returns 'cheap' if cheap models achieve >80% of premium quality

// Summary stats
const stats = adaptive.stats()
// { totalRecords, domains, avgQuality, avgCostCents }
```

### When to use

- Long-running systems where routing quality improves over time.
- Multi-agent setups where different agents specialize in different domains.
- Pair with the Cascade Router: use `recommendTier()` to set the cascade's
  starting point.


---

## Full Stack Example

Combining all layers into a single routing pipeline:

```typescript
import { SemanticCache } from './planner/semantic-cache.js'
import { LatencyRouter } from './planner/latency-router.js'
import { CascadeRouter, buildModelLadder } from './planner/cascade-router.js'
import { speculativeCascade } from './planner/speculative-cascade.js'
import { decomposeQuery, executeDecomposed } from './planner/query-decomposer.js'
import { AdaptiveRouter } from './planner/adaptive-router.js'
import type { LlmRequest, LlmResponse } from './types/provider.js'

// --- Setup ---

const providers = [anthropicProvider, openaiProvider]
const ladder = buildModelLadder(providers)

const cache = new SemanticCache({
  similarityThreshold: 0.90,
  embedFn: (text) => embeddingModel.embed(text),
})

const latencyRouter = new LatencyRouter({
  ladder,
  maxLatencyMs: 5000,
  optimizeFor: 'balanced',
})

const cascadeRouter = new CascadeRouter({
  providers,
  qualityThreshold: 0.75,
  maxEscalations: 3,
  explorationRate: 0.05,
})

const adaptive = new AdaptiveRouter()

// --- The routing function ---

async function route(request: LlmRequest): Promise<LlmResponse> {
  // Layer 1: Cache
  const cached = await cache.lookup(request)
  if (cached) return cached

  // Layer 5 (early): Decomposition check
  const queryText = request.messages.map(m => m.content).join(' ')
  const decomposed = decomposeQuery(queryText)

  if (decomposed.subtasks.length > 1) {
    // Multi-part query -- decompose and route subtasks independently
    const result = await executeDecomposed(decomposed, ladder, request.systemPrompt)
    const merged = result.responses.map(r => r.response.content).join('\n\n')
    const syntheticResponse: LlmResponse = {
      content: merged,
      model: 'decomposed',
      inputTokens: result.responses.reduce((s, r) => s + r.response.inputTokens, 0),
      outputTokens: result.responses.reduce((s, r) => s + r.response.outputTokens, 0),
      finishReason: 'stop',
    }
    await cache.store(request, syntheticResponse, result.totalCostCents)
    return syntheticResponse
  }

  // Layer 2: Latency-aware model selection (informational)
  const latencyPick = latencyRouter.pick()
  // Can use this to influence cascade starting point

  // Layer 3 or 4: Cascade vs Speculative
  const useSpeculative = request.messages.some(
    m => m.content.length > 1000  // long queries benefit from parallel execution
  )

  let response: LlmResponse
  let costCents: number

  if (useSpeculative) {
    // Layer 4: Speculative cascade
    const result = await speculativeCascade(request, {
      ladder,
      parallelWidth: 2,
      qualityThreshold: 0.75,
    })
    response = result.response
    costCents = result.totalCostCents

    // Feed latency data back
    for (const t of result.trace) {
      latencyRouter.recordLatency(t.provider, t.model, t.durationMs)
    }
  } else {
    // Layer 3: Sequential cascade
    const result = await cascadeRouter.route(request)
    response = result.response
    costCents = result.totalCostCents

    for (const t of result.trace) {
      latencyRouter.recordLatency(t.provider, t.model, t.durationMs)
    }
  }

  // Store in cache for future hits
  await cache.store(request, response, costCents)

  // Record for adaptive learning
  adaptive.record({
    taskDomain: ['general'],
    taskDifficulty: 'medium',
    agentName: 'default',
    model: response.model,
    provider: 'unknown',
    success: true,
    costCents,
    durationMs: 0,
    qualityScore: 0.8,
    timestamp: Date.now(),
  })

  return response
}
```


---

## Cost Savings Benchmarks

Reported numbers from the papers these components are based on:

| Component             | Paper                          | Reported Savings         | Quality Retention |
|-----------------------|-------------------------------|--------------------------|-------------------|
| Semantic Cache        | GPT Semantic Cache (2411.05276) | 68% cost reduction       | 97%+ accuracy on hits |
| Cascade Routing       | ICLR 2025 (2410.10347)        | 40-75% cost reduction    | <2% quality loss  |
| Confidence Routing    | CARGO (2509.14899)             | Skip 30-50% of bad calls | Avoids wasted spend |
| Bandit Learning       | MixLLM / MetaLLM              | 97% of GPT-4 quality at 24% cost | 97% quality parity |
| Speculative Cascade   | arXiv:2405.19261               | 50% latency reduction    | Same quality (parallel) |
| Query Decomposition   | R2-Reasoner (2603.04445)       | 84.46% cost savings      | Subtask-level quality |
| Adaptive Tier Rec.    | -- (internal)                  | Downgrades tier when cheap models suffice | >80% of premium quality |

**Combined stack estimate:** In workloads with moderate repetition and mixed
complexity, the full 5-layer stack achieves 40-85% cost reduction vs
always-use-premium baselines, with quality within 2-5% of premium-only routing.

Key variables that affect real-world savings:
- **Query repetition rate** -- higher repetition = more cache hits
- **Query complexity distribution** -- more simple queries = more cheap-model wins
- **Number of model tiers** -- more tiers = finer-grained routing
- **Quality threshold** -- lower threshold = more cheap-model acceptance = more savings
