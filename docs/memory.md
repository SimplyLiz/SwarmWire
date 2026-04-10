# Memory Architectures

SwarmWire ships eight memory backends, all implementing the same `MemoryBackend` interface. Mix and match within a single pipeline.

**Source:** `src/memory/`

---

## Table of Contents

1. [MemoryBackend Interface](#memorybackend-interface)
2. [ANCS — Adaptive Neural Context Store](#ancs--adaptive-neural-context-store)
3. [Self-Learning Memory (EWC)](#self-learning-memory-ewc)
4. [Vector Memory (HNSW-like)](#vector-memory-hnsw-like)
5. [A-MEM — Zettelkasten Living Graph](#a-mem--zettelkasten-living-graph)
6. [TemporalMemory — CMA Decay + Spreading Activation](#temporalmemory--cma-decay--spreading-activation)
7. [SelfEditingMemory — Named Memory Blocks](#selfeditmemory--named-memory-blocks)
8. [EpisodicMemory — Interaction History](#episodicmemory--interaction-history)
9. [ProceduralMemory — How-To Procedures](#proceduralmemory--how-to-procedures)
10. [External Vector Store Adapters](#external-vector-store-adapters)
11. [SleepTimeAgent — Background Consolidation](#sleeptimeagent--background-consolidation)
12. [Choosing a Backend](#choosing-a-backend)

---

## MemoryBackend Interface

Every memory module implements this contract:

```typescript
interface MemoryBackend {
  store(key: string, value: unknown, meta: StoreMeta): Promise<void>
  query(query: string, opts?: QueryOpts): Promise<MemoryItem[]>
  forget(key: string): Promise<void>
}

interface StoreMeta {
  agentId?: string
  executionId?: string
  stepId?: string
  tags?: string[]
  ttlSeconds?: number
}

interface QueryOpts {
  maxItems?: number
  minRelevance?: number
}

interface MemoryItem {
  key: string
  value: unknown
  relevance: number   // 0-1
  meta: StoreMeta
  storedAt: number
}
```

---

## ANCS — Adaptive Neural Context Store

**Source:** `src/memory/ancs.ts`

The default memory backend. Uses bag-of-words cosine similarity with an optional embedding function, FIFO eviction, and a configurable max capacity.

```typescript
import { ANCSMemory } from 'swarmwire'

const memory = new ANCSMemory({
  maxItems: 1000,
  similarityThreshold: 0.1,
  embedFn: (text) => myEmbeddingModel.embed(text),  // optional
})

await memory.store('fact-1', 'The API uses OAuth 2.0', { tags: ['auth'] })
const results = await memory.query('authentication mechanism', { maxItems: 5 })
```

---

## Self-Learning Memory (EWC)

**Source:** `src/memory/self-learning.ts`

Maintains pattern weights with Elastic Weight Consolidation (EWC) to prevent catastrophic forgetting when learning new patterns.

```typescript
import { SelfLearningMemory } from 'swarmwire'

const mem = new SelfLearningMemory({
  maxPatterns: 500,
  ewcLambda: 0.4,         // importance of old knowledge (0=ignore, 1=strict)
  learningRate: 0.01,
})

// Store a pattern with quality signal
await mem.store('pattern-key', { prompt: '...', result: '...' }, {
  tags: ['code', 'review'],
})

// Query returns patterns ranked by learned weight × similarity
const patterns = await mem.query('code review best practices', { maxItems: 3 })
```

EWC tracks a Fisher Information Matrix to estimate which weights are critical to previously-learned tasks, then penalizes updates that would significantly shift those weights.

---

## Vector Memory (HNSW-like)

**Source:** `src/memory/vector-memory.ts`

Approximate nearest-neighbor search using a hierarchical navigable small-world graph structure. O(log n) query time.

```typescript
import { VectorMemory } from 'swarmwire'

const mem = new VectorMemory({
  dimensions: 128,
  maxConnections: 16,     // HNSW M parameter
  efConstruction: 200,    // build-time search breadth
  efSearch: 50,           // query-time search breadth
})

await mem.store('doc-1', 'TypeScript generics tutorial', {})
const similar = await mem.query('generic types TypeScript', { maxItems: 10 })
```

---

## A-MEM — Zettelkasten Living Graph

**Source:** `src/memory/a-mem.ts`
**Paper:** A-MEM (arXiv)

On every write, notes auto-link to related memories via cosine similarity. Retrieval spreads activation through the link graph, surfacing contextually adjacent memories.

```typescript
import { AMem } from 'swarmwire'

const mem = new AMem({
  linkThreshold: 0.3,      // min similarity to create a link
  maxLinks: 10,            // max links per note
  activationDecay: 0.5,    // spread factor per hop
  embedFn: (text) => myEmbedder.embed(text),  // optional
})

// Notes auto-link on write
await mem.store('note-1', 'Attention mechanisms in transformers', {})
await mem.store('note-2', 'Multi-head self-attention paper', {})
await mem.store('note-3', 'BERT uses bidirectional attention', {})

// Query spreads through links: "note-2" surfaces even if not directly matched
const results = await mem.query('transformer architecture')

// Inspect the link graph
const noteWithLinks = mem.getNote('note-1')
console.log(noteWithLinks?.links)  // [{ targetId, weight }]
```

### Configuration

```typescript
interface AMemConfig {
  linkThreshold?: number    // min cosine sim to link. Default 0.3
  maxLinks?: number         // max links per note. Default 10
  activationDecay?: number  // spread per hop. Default 0.5
  maxNotes?: number         // FIFO eviction. Default 10000
  embedFn?: (text: string) => number[]
}
```

---

## TemporalMemory — CMA Decay + Spreading Activation

**Source:** `src/memory/temporal.ts`
**Papers:** CMA (arXiv:2601.09913), Synapse (arXiv:2601.02744)

Memories have a strength (0–1) that decays exponentially per hour. Accessed memories are reinforced. Retrieval spreads activation to temporally adjacent notes.

```typescript
import { TemporalMemory } from 'swarmwire'

const mem = new TemporalMemory({
  decayRatePerHour: 0.02,     // 2% strength lost per hour
  accessReinforcement: 0.1,   // +10% strength on access
  evictionThreshold: 0.05,    // evict on consolidation if below 5%
  temporalWindowSize: 3,       // how many time-adjacent notes to chain
  activationDepth: 2,          // spreading activation hops
  maxNotes: 5000,
})

await mem.store('k1', 'Project deadline is Friday', {})
await mem.store('k2', 'Meeting notes from standup', {})

const results = await mem.query('project deadline', { maxItems: 5 })
// results[].relevance reflects strength × semantic similarity

// Background eviction of weak memories
const { evicted } = mem.consolidate()

// Stats
const { noteCount, avgStrength, oldestMs } = mem.stats()
```

### Strength lifecycle

```
On store:    strength = 1.0
Over time:   strength *= (1 - decayRate)^hoursElapsed
On access:   strength = min(1.0, strength + accessReinforcement)
consolidate: evict if strength < evictionThreshold
```

---

## SelfEditingMemory — Named Memory Blocks

**Source:** `src/memory/self-editing.ts`
**Reference:** Letta / MemGPT "in-context stateful memory"

Agents read and mutate named, bounded text blocks mid-execution. All edits are versioned with full history and revert support.

```typescript
import { SelfEditingMemory } from 'swarmwire'

const mem = new SelfEditingMemory({
  blocks: [
    { name: 'persona',   content: 'I am a code review assistant.', maxChars: 500 },
    { name: 'context',   content: '',  maxChars: 2000 },
    { name: 'scratchpad', content: '', maxChars: 4000 },
  ],
  maxHistoryPerBlock: 20,
  strictSizing: false,  // truncate instead of throw
})

// Agent reads current state
const ctx = mem.getBlock('context')
console.log(ctx?.content)

// Agent updates memory mid-execution
mem.write('context', 'User is debugging a React hook issue.', 'agent-1')
mem.append('scratchpad', '\n- Check useEffect dependencies', 'agent-1')
mem.patch('persona', 'code review', 'debugging', 'agent-1')

// Version history
const history = mem.getHistory('context')
// [{ blockName, prevContent, nextContent, timestamp, version, editedBy }]

// Revert to version 2
mem.revert('context', 2)

// Format all blocks for injection into agent prompt
const promptSection = mem.toContextString()
// <memory name="persona" version="1">...</memory>
// <memory name="context" version="3">...</memory>
// ...

// MemoryBackend interface — store/query work on block names
await mem.store('notes', 'important finding', {})
const results = await mem.query('finding')

// Stats
const { blockCount, totalChars, totalEdits } = mem.stats()
```

---

## EpisodicMemory — Interaction History

**Source:** `src/memory/episodic.ts`

Stores specific past interactions with temporal ordering, success tracking, and tag-based recall.

```typescript
import { EpisodicMemory } from 'swarmwire'

const mem = new EpisodicMemory({
  maxEntries: 1000,
})

// Record an interaction
const entry = await mem.record({
  sessionId: 'session-42',
  description: 'Code review of auth.ts',
  input: { file: 'auth.ts' },
  output: { issues: ['missing rate limit', 'SQL injection risk'] },
  success: true,
  durationMs: 3400,
  costCents: 8,
  tags: ['code-review', 'security'],
})

// Recall similar past interactions
const episodes = await mem.recall('security code review', {
  limit: 5,
  sessionId: 'session-42',   // optional: filter by session
  tags: ['security'],         // optional: filter by tags
})

// MemoryBackend interface
await mem.store('key', value, { tags: ['label'] })
const items = await mem.query('security issues', { maxItems: 3 })
await mem.forget(entry.id)
```

### EpisodicEntry shape

```typescript
interface EpisodicEntry {
  id: string
  sessionId?: string
  timestamp: number
  description: string
  input: unknown
  output: unknown
  success: boolean
  durationMs: number
  costCents: number
  tags: string[]
}
```

---

## ProceduralMemory — How-To Procedures

**Source:** `src/memory/procedural.ts`

Stores "how to" execution procedures with success rate tracking. Agents retrieve relevant procedures for a given goal.

```typescript
import { ProceduralMemory } from 'swarmwire'

const mem = new ProceduralMemory({ maxProcedures: 500 })

// Learn a new procedure
const proc = await mem.learn({
  name: 'security-audit',
  goal: 'Audit a codebase for security vulnerabilities',
  steps: [
    { order: 1, action: 'Scan for SQL injection patterns', output: 'sql_findings' },
    { order: 2, action: 'Check authentication flows', inputs: ['sql_findings'], output: 'auth_findings' },
    { order: 3, action: 'Review dependency CVEs', output: 'dep_findings' },
    { order: 4, action: 'Compile report', inputs: ['sql_findings', 'auth_findings', 'dep_findings'] },
  ],
  tags: ['security', 'audit'],
})

// Retrieve relevant procedures
const procs = await mem.recallFor('find security vulnerabilities', { limit: 3 })
// sorted by: similarity × successRate

// Record outcome to update success rate
await mem.recordOutcome(proc.id, true)   // success
await mem.recordOutcome(proc.id, false)  // failure

// MemoryBackend interface
await mem.store('key', { goal: '...', steps: [...] }, { tags: ['security'] })
const items = await mem.query('vulnerability scanning', { maxItems: 3 })
```

### Procedure shape

```typescript
interface Procedure {
  id: string
  name: string
  goal: string
  steps: ProcedureStep[]
  successCount: number
  totalCount: number
  lastUsed: number
  createdAt: number
  tags: string[]
}

interface ProcedureStep {
  order: number
  action: string
  inputs?: string[]
  output?: string
}
```

---

## External Vector Store Adapters

**Source:** `src/memory/vector-stores.ts`

Four adapters wrapping external vector databases, all implementing `MemoryBackend`. Peer dependencies are lazy-loaded — only required if installed.

### Flat (in-process)

Zero-dependency in-process vector store with cosine similarity.

```typescript
import { createFlatVectorStore } from 'swarmwire'

const store = createFlatVectorStore({
  dimensions: 128,
  maxEntries: 10_000,
  embedFn: (text) => myEmbedder.embed(text),  // optional
})

await store.store('key', 'document text', {})
const results = await store.query('search query', { maxItems: 5 })
```

### Pinecone

```bash
npm install @pinecone-database/pinecone
```

```typescript
import { createPineconeStore } from 'swarmwire'

const store = createPineconeStore({
  apiKey: process.env.PINECONE_API_KEY!,
  indexName: 'my-swarm-index',
  namespace: 'agents',
  dimensions: 1536,
  embedFn: async (text) => openaiEmbeddings.embed(text),
})

await store.store('doc-1', 'TypeScript async patterns', { tags: ['ts', 'async'] })
const results = await store.query('promise chaining', { maxItems: 10, minRelevance: 0.7 })
await store.forget('doc-1')
```

### Qdrant

```bash
npm install @qdrant/js-client-rest
```

```typescript
import { createQdrantStore } from 'swarmwire'

const store = createQdrantStore({
  url: 'http://localhost:6333',
  collectionName: 'swarm-memory',
  apiKey: process.env.QDRANT_API_KEY,   // optional for local
  dimensions: 1536,
  embedFn: async (text) => myEmbedder.embed(text),
})
```

### Redis (RediSearch)

```bash
npm install ioredis
```

```typescript
import { createRedisVectorStore } from 'swarmwire'

const store = createRedisVectorStore({
  url: 'redis://localhost:6379',
  indexName: 'swarm:mem',
  dimensions: 128,
  embedFn: (text) => myEmbedder.embed(text),
})
```

### Config interface (all adapters)

```typescript
interface VectorStoreConfig {
  dimensions?: number       // default 128
  embedFn?: (text: string) => number[] | Promise<number[]>
  maxEntries?: number       // flat store only
}
```

---

## SleepTimeAgent — Background Consolidation

**Source:** `src/workers/sleep-time-agent.ts`

LLM-driven background consolidation. During idle periods, queries recent memories, asks the LLM to synthesize key insights, and writes them back as compressed summaries.

```typescript
import { SleepTimeAgent } from 'swarmwire'
import { createProvider } from 'swarmwire'

const agent = new SleepTimeAgent({
  memory: myMemoryBackend,
  provider: createProvider('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY! }),
  model: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  queryContext: 'agent execution patterns and outcomes',
  recentItemsLimit: 20,
  insightPrompt: 'Extract key insights from these recent memories:',
  evictAfterConsolidation: false,   // keep originals
  maxCostCents: 10,
})

// One-shot consolidation
const result = await agent.consolidate('focus on error patterns')
console.log(result.insights)       // string[] of extracted insights
console.log(result.stored)         // number of insights written back
console.log(result.costCents)      // LLM cost

// Background periodic consolidation
agent.start(30 * 60 * 1000)  // every 30 minutes
// ... later ...
agent.stop()
```

### Configuration

```typescript
interface SleepTimeAgentConfig {
  memory: MemoryBackend
  provider: Provider
  model: ModelConfig
  queryContext?: string           // what to query for recent memories
  recentItemsLimit?: number       // default 20
  insightPrompt?: string          // system prompt for LLM consolidation
  evictAfterConsolidation?: boolean // default false
  maxCostCents?: number           // budget guard per consolidation run
}
```

---

## Choosing a Backend

| Backend | Persistence | Scale | Semantic Quality | Dependencies |
|---------|-------------|-------|-----------------|-------------|
| ANCS | In-process | 10k items | Bag-of-words | None |
| SelfLearning (EWC) | In-process | 500 patterns | Bag-of-words + learned weights | None |
| Vector (HNSW) | In-process | 100k items | Custom embeddings | None |
| A-MEM | In-process | 10k notes | Cosine + link graph | None |
| TemporalMemory | In-process | 5k notes | Cosine × temporal strength | None |
| SelfEditingMemory | In-process | Blocks-based | Keyword overlap | None |
| EpisodicMemory | In-process | 1k interactions | Cosine | None |
| ProceduralMemory | In-process | 500 procedures | Cosine | None |
| Flat vector store | In-process | 10k items | Custom embeddings | None |
| Pinecone | Durable cloud | Billions | Real embeddings | `@pinecone-database/pinecone` |
| Qdrant | Durable (self-host or cloud) | Billions | Real embeddings | `@qdrant/js-client-rest` |
| Redis | Durable (self-host) | Millions | Real embeddings | `ioredis` |

**Recommended combinations:**

- **Dev/test:** ANCS or TemporalMemory — no deps, works instantly
- **Agent with episodic recall:** EpisodicMemory + ProceduralMemory paired together
- **Living knowledge base:** A-MEM for note-linking, SleepTimeAgent for compression
- **Production, strict budget:** Qdrant or Pinecone with `text-embedding-3-small`
- **Agent that edits its own beliefs:** SelfEditingMemory for structured blocks
