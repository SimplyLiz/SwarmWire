# Conflict Resolution

Detect and resolve contradictions between agent outputs in multi-agent workflows.

**Source:** `src/conflict/detector.ts`, `src/conflict/resolver.ts`

---

## Table of Contents

1. [Detection](#detection)
2. [Similarity Algorithms](#similarity-algorithms)
3. [Resolution Strategies](#resolution-strategies)
4. [Configuration](#configuration)
5. [Integration Examples](#integration-examples)

---

## Detection

`detectConflicts()` compares every pair of agent outputs and classifies the relationship as `contradiction`, `disagreement`, or agreement (no conflict).

```typescript
import { detectConflicts } from './conflict/detector.js'
import type { AgentOutput } from './types/agent.js'

const outputs: AgentOutput[] = [
  { agentId: 'a1', agentName: 'security-agent', output: 'The endpoint is vulnerable to SQL injection.' },
  { agentId: 'a2', agentName: 'code-agent', output: 'The endpoint uses parameterized queries and is safe.' },
]

const conflicts = detectConflicts(outputs)
// [
//   {
//     id: 'conflict_1',
//     type: 'contradiction',
//     agentIds: ['a1', 'a2'],
//     stepIds: [],
//     description: 'Agents security-agent and code-agent produced contradictory outputs (similarity: 28%)',
//     outputs: ['The endpoint is vulnerable...', 'The endpoint uses parameterized...'],
//   }
// ]
```

### Conflict Types

| Type              | Condition                                              |
|-------------------|--------------------------------------------------------|
| `contradiction`   | Similarity < `contradictionThreshold` (default 0.3)    |
| `disagreement`    | Similarity >= contradiction threshold but < `agreementThreshold` (default 0.8) |
| (no conflict)     | Similarity >= `agreementThreshold`                     |

---

## Similarity Algorithms

`computeSimilarity()` dispatches based on the type of the two outputs:

### Strings -- Jaccard Similarity

Tokenizes both strings into lowercase word sets, then computes:

```
J(A, B) = |A intersection B| / |A union B|
```

- Returns 1.0 for identical word sets (regardless of order).
- Returns 0.0 when one or both strings are empty.
- Case-insensitive, splits on whitespace.

```typescript
// Example: "The API is secure" vs "The API is vulnerable"
// Words A: {the, api, is, secure}
// Words B: {the, api, is, vulnerable}
// Intersection: 3, Union: 5
// Jaccard = 3/5 = 0.6 -> "disagreement" at default thresholds
```

### Objects -- Structural Key/Value Comparison

For plain objects, computes the average field-level similarity across the union of all keys:

```typescript
// { status: 'safe', score: 0.9 } vs { status: 'unsafe', score: 0.3 }
// Keys: {status, score}
// status: Jaccard('safe', 'unsafe') = 0.0
// score: 0.9 !== 0.3 -> 0.0
// Overall: 0.0 / 2 = 0.0 -> contradiction
```

Missing keys on either side contribute 0 similarity for that field.

### Arrays -- Positional Overlap

Compares elements pairwise by position, then divides by the length of the longer array:

```typescript
// [1, 2, 3] vs [1, 2, 4]
// Position 0: 1===1 -> 1.0
// Position 1: 2===2 -> 1.0
// Position 2: 3!==4 -> 0.0
// Total: 2.0 / 3 = 0.667
```

### Primitives and Type Mismatches

- Numbers/booleans: 1.0 if equal, 0.0 otherwise.
- `null`/`undefined`: 0.0 similarity against anything.
- Different types (string vs object, etc.): 0.0.

---

## Resolution Strategies

`resolveConflict()` takes a `Conflict`, the full output list, and a `ConflictStrategy`:

```typescript
import { resolveConflict } from './conflict/resolver.js'

const resolution = resolveConflict(conflict, outputs, 'vote')
```

### `'vote'` -- Majority Wins

Groups outputs from conflicting agents by exact match (`JSON.stringify`). Picks the group with the most members.

```typescript
const resolution = resolveConflict(conflict, outputs, 'vote')
// {
//   method: 'vote',
//   winner: 'a1',             // agentId of the winning group
//   reasoning: '2/3 agents agreed',
//   confidence: 0.667,        // winnerCount / totalRelevant
// }
```

Best for: 3+ agents where majority consensus is meaningful. With only 2 agents, confidence maxes out at 0.5 unless outputs are identical.

### `'evidence_weight'` -- Most Context Wins

Picks the agent that processed the most tokens (proxy for evidence depth). Confidence is the winner's token share of total tokens.

```typescript
const resolution = resolveConflict(conflict, outputs, 'evidence_weight')
// {
//   method: 'evidence_weight',
//   winner: 'a2',
//   reasoning: 'Agent code-agent processed the most evidence (4200 tokens)',
//   confidence: 0.72,
// }
```

Best for: Workflows where some agents have access to more tools/context than others. The agent that did more work is more likely to be correct.

### `'escalate'` -- Human Review

Does not auto-resolve. Returns confidence 0 and flags the conflict for external handling.

```typescript
const resolution = resolveConflict(conflict, outputs, 'escalate')
// {
//   method: 'escalate',
//   reasoning: 'Conflict escalated for review: Agents security-agent and code-agent...',
//   confidence: 0,
// }
```

Best for: High-stakes decisions, compliance workflows, or when automated resolution confidence is too low.

---

## Configuration

### DetectorOptions

```typescript
interface DetectorOptions {
  /** Minimum similarity below which outputs are contradictory (0-1). Default: 0.3 */
  contradictionThreshold?: number
  /** Minimum similarity above which outputs are aligned (0-1). Default: 0.8 */
  agreementThreshold?: number
}
```

Tuning guidance:

| Scenario                        | contradictionThreshold | agreementThreshold |
|---------------------------------|-----------------------|-------------------|
| Strict (catch everything)       | 0.5                   | 0.9               |
| Default                         | 0.3                   | 0.8               |
| Lenient (only flag clear conflicts) | 0.15              | 0.7               |

### ConflictStrategy

```typescript
type ConflictStrategy = 'vote' | 'evidence_weight' | 'escalate'
```

Set per-pattern in your orchestration config. Different patterns can use different strategies.

---

## Integration Examples

### Multi-agent review pipeline

```typescript
import { detectConflicts } from './conflict/detector.js'
import { resolveConflict } from './conflict/resolver.js'
import type { AgentOutput } from './types/agent.js'

async function reviewWithConflictResolution(
  outputs: AgentOutput[],
  strategy: 'vote' | 'evidence_weight' | 'escalate' = 'vote',
) {
  const conflicts = detectConflicts(outputs, {
    contradictionThreshold: 0.3,
    agreementThreshold: 0.8,
  })

  if (conflicts.length === 0) {
    // All agents agree -- use any output
    return { agreed: true, output: outputs[0]!.output, conflicts: [] }
  }

  const resolutions = conflicts.map((c) => ({
    conflict: c,
    resolution: resolveConflict(c, outputs, strategy),
  }))

  // Check if any resolution has low confidence
  const needsEscalation = resolutions.some((r) => r.resolution.confidence < 0.5)

  if (needsEscalation && strategy !== 'escalate') {
    // Re-resolve with escalation
    return {
      agreed: false,
      output: null,
      conflicts: resolutions,
      escalated: true,
    }
  }

  // Use the winner's output
  const winner = resolutions[0]!.resolution.winner
  const winnerOutput = outputs.find((o) => o.agentId === winner)

  return {
    agreed: false,
    output: winnerOutput?.output,
    conflicts: resolutions,
    escalated: false,
  }
}
```

### Tiered resolution (auto-resolve then escalate)

```typescript
function tieredResolve(conflict: Conflict, outputs: AgentOutput[]) {
  // Try vote first
  const vote = resolveConflict(conflict, outputs, 'vote')
  if (vote.confidence >= 0.6) return vote

  // Fall back to evidence weight
  const evidence = resolveConflict(conflict, outputs, 'evidence_weight')
  if (evidence.confidence >= 0.7) return evidence

  // Escalate if nothing is confident enough
  return resolveConflict(conflict, outputs, 'escalate')
}
```

### Custom thresholds per domain

```typescript
const domainThresholds: Record<string, DetectorOptions> = {
  security: { contradictionThreshold: 0.5, agreementThreshold: 0.9 },
  code:     { contradictionThreshold: 0.3, agreementThreshold: 0.8 },
  creative: { contradictionThreshold: 0.15, agreementThreshold: 0.6 },
}

function detectForDomain(outputs: AgentOutput[], domain: string) {
  const opts = domainThresholds[domain] ?? {}
  return detectConflicts(outputs, opts)
}
```
