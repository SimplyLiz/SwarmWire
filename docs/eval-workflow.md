# Eval-Driven Development Workflow

> Record → Replay → Eval → CI. The recommended way to build production agent systems with SwarmWire.

---

## The Problem

Multi-agent systems are hard to test:
- LLM calls are non-deterministic — same input, different output every time
- Each test run costs money ($0.50-$5+ per execution)
- Tests are slow (seconds to minutes per LLM call)
- No way to regression-test — "did my prompt change break something?"
- CI pipelines can't run against live LLMs (cost, flakiness, rate limits)

## The Solution: Record/Replay + Evals

SwarmWire solves this with a 4-phase workflow:

```
Phase 1: RECORD          Phase 2: DEVELOP          Phase 3: EVAL           Phase 4: CI
┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐    ┌──────────────┐
│ Run with real │    │ Replay from      │    │ Run eval suite   │    │ CI runs      │
│ LLM provider  │───►│ fixture (free,   │───►│ against replay   │───►│ replay +     │
│ Save fixture  │    │ instant, determi-│    │ output. Score    │    │ eval on every│
│ to JSON       │    │ nistic)          │    │ against threshold│    │ PR.          │
└──────────────┘    └──────────────────┘    └──────────────────┘    └──────────────┘
     $$$                    $0                    $0                      $0
     ~10s                  <100ms                <100ms                  <1s
```

---

## Phase 1: Record

Run your agent system against real LLM providers. SwarmWire records every LLM interaction to a JSON fixture file.

```typescript
import { Swarm, RecordingProvider, createProvider } from 'swarmwire'

// Wrap your real provider with RecordingProvider
const realProvider = createProvider('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY })
const recorder = new RecordingProvider(realProvider, './fixtures/research-run.json')

const swarm = new Swarm({ providers: [recorder] })

// Define and run your agents as normal
const researcher = swarm.agent({
  name: 'researcher',
  role: 'Research topics',
  model: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260320' },
})

const result = await swarm.run('Research TypeScript ORMs', {
  agents: [researcher],
  budget: { maxCostCents: 50 },
})

// Save the fixture — human-readable JSON
await recorder.save()
console.log(`Recorded ${recorder.count} interactions to ./fixtures/research-run.json`)
```

The fixture file looks like this:

```json
{
  "version": "1.0",
  "provider": "anthropic",
  "recordedAt": "2026-03-26T14:30:00.000Z",
  "interactions": [
    {
      "index": 0,
      "request": {
        "model": "claude-sonnet-4-6-20260320",
        "messages": [{ "role": "user", "content": "Research TypeScript ORMs..." }],
        "fingerprint": "research typescript orms..."
      },
      "response": {
        "content": "Here are the top TypeScript ORMs...",
        "model": "claude-sonnet-4-6-20260320",
        "inputTokens": 250,
        "outputTokens": 800
      },
      "durationMs": 2340,
      "costCents": 3.75
    }
  ]
}
```

Fixtures are human-readable and reviewable in PRs. Volatile fields (UUIDs, timestamps) are normalized for fuzzy matching.

---

## Phase 2: Develop

Replace the real provider with `ReplayProvider`. Now every run is instant, deterministic, and free.

```typescript
import { Swarm, ReplayProvider } from 'swarmwire'

const replayer = new ReplayProvider('./fixtures/research-run.json', {
  name: 'anthropic',  // Must match the provider name agents use
})

const swarm = new Swarm({ providers: [replayer] })

// Same agent setup, same task — but instant and free
const researcher = swarm.agent({
  name: 'researcher',
  role: 'Research topics',
  model: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260320' },
})

const result = await swarm.run('Research TypeScript ORMs')
// result.cost.totalCostCents === 0
// Deterministic — same output every time
```

### Partial Replay

When you add new agents or change prompts, some requests won't match the fixture. Use `fallback` to call the real LLM only for unmatched requests:

```typescript
const replayer = new ReplayProvider('./fixtures/research-run.json', {
  name: 'anthropic',
  strict: false,                          // Don't throw on mismatch
  fallback: createProvider('anthropic', { apiKey: '...' }),  // Call real LLM for new requests
})
```

---

## Phase 3: Eval

Run quality metrics against the replay output. Define pass/fail thresholds.

```typescript
import { runEvalSuite, nonEmpty, lengthCheck, containsKeywords, noHallucination } from 'swarmwire'

// Define your eval suite
const qualitySuite = {
  name: 'research-quality',
  evals: [
    nonEmpty(),                                    // Output isn't empty
    lengthCheck(200, 10000),                       // Reasonable length
    containsKeywords(['prisma', 'drizzle', 'typeorm']),  // Mentions key ORMs
    noHallucination(),                             // No hallucination markers
  ],
  threshold: 0.8,                                  // Average score must be >= 80%
  perEvalThreshold: 0.5,                           // No individual eval below 50%
}

// Run against replay output
const evalResult = await runEvalSuite(qualitySuite, task.input, result.output)

console.log(`Score: ${(evalResult.averageScore * 100).toFixed(0)}%`)
console.log(`Passed: ${evalResult.passed}`)

for (const r of evalResult.results) {
  console.log(`  ${r.evalName}: ${(r.score * 100).toFixed(0)}%`)
}

if (!evalResult.passed) {
  process.exit(1)  // Fail the build
}
```

### Custom Evals

Built-in evals cover common cases. For domain-specific checks, write custom evals:

```typescript
import type { Eval } from 'swarmwire'

// Check that ORM recommendations include performance benchmarks
const hasBenchmarks: Eval<string, string> = {
  name: 'has-benchmarks',
  score(_input, output) {
    const benchmarkPatterns = [/\d+\s*(ms|tps|qps|ops\/s)/i, /benchmark/i, /latency/i]
    const hits = benchmarkPatterns.filter((p) => p.test(output))
    return hits.length / benchmarkPatterns.length
  },
}

// Check that output doesn't recommend deprecated libraries
const noDeprecated: Eval<string, string> = {
  name: 'no-deprecated',
  score(_input, output) {
    const deprecated = ['sequelize v5', 'typeorm 0.2', 'knex 0.x']
    const found = deprecated.filter((d) => output.toLowerCase().includes(d))
    return found.length === 0 ? 1 : 0
  },
}
```

### Regression Testing

Compare current output against a known-good baseline:

```typescript
import { similarityToExpected, noRegression } from 'swarmwire'

const regressionSuite = {
  name: 'regression',
  evals: [
    similarityToExpected(),   // Compare to ground truth
    noRegression(),           // At least as good as previous run
  ],
  threshold: 0.7,
}

const result = await runEvalSuite(regressionSuite, input, currentOutput, {
  expected: knownGoodOutput,       // Ground truth
  previous: lastRunOutput,         // Previous run's output
})
```

---

## Phase 4: CI

Put it all together in a test file that runs in CI:

```typescript
// tests/eval/research-quality.test.ts
import { describe, it, expect } from 'vitest'
import { Swarm, ReplayProvider, runEvalSuite, nonEmpty, lengthCheck, containsKeywords, noHallucination } from 'swarmwire'

describe('Research pipeline quality', () => {
  it('meets quality threshold on recorded fixture', async () => {
    // Replay — instant, free, deterministic
    const replayer = new ReplayProvider('./fixtures/research-run.json', { name: 'anthropic' })
    const swarm = new Swarm({ providers: [replayer] })

    const researcher = swarm.agent({
      name: 'researcher',
      role: 'Research topics',
      model: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260320' },
    })

    const result = await swarm.run('Research TypeScript ORMs')

    // Eval
    const evalResult = await runEvalSuite({
      name: 'research-quality',
      evals: [nonEmpty(), lengthCheck(200, 10000), containsKeywords(['prisma', 'drizzle']), noHallucination()],
      threshold: 0.8,
    }, 'Research TypeScript ORMs', result.output as string)

    expect(evalResult.passed).toBe(true)
    expect(evalResult.averageScore).toBeGreaterThan(0.8)
  })

  it('does not regress from baseline', async () => {
    // Load baseline from a known-good fixture
    const baseline = await import('./baselines/research-baseline.json', { with: { type: 'json' } })

    const replayer = new ReplayProvider('./fixtures/research-run.json', { name: 'anthropic' })
    const swarm = new Swarm({ providers: [replayer] })
    swarm.agent({ name: 'researcher', role: 'Research', model: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260320' } })

    const result = await swarm.run('Research TypeScript ORMs')

    // Output should be at least as good as baseline
    const evalResult = await runEvalSuite({
      name: 'regression',
      evals: [{ name: 'no-regression', score: (_i, output, ctx) => {
        if (!ctx?.previous) return 1
        const curr = String(output).length
        const prev = String(ctx.previous).length
        return curr >= prev * 0.8 ? 1 : curr / prev  // Allow 20% shorter
      }}],
      threshold: 0.7,
    }, 'Research TypeScript ORMs', result.output as string, { previous: baseline.output })

    expect(evalResult.passed).toBe(true)
  })

  it('costs $0 in CI', async () => {
    const replayer = new ReplayProvider('./fixtures/research-run.json', { name: 'anthropic' })
    const swarm = new Swarm({ providers: [replayer] })
    swarm.agent({ name: 'researcher', role: 'Research', model: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260320' } })

    const result = await swarm.run('Research TypeScript ORMs')
    expect(result.cost.totalCostCents).toBe(0)
  })
})
```

### GitHub Actions Integration

```yaml
# .github/workflows/ci.yml
- name: Run eval tests
  run: npm test -- tests/eval/
```

No API keys needed in CI. No cost. No flakiness. Deterministic.

---

## Workflow Summary

```
Developer workflow:
1. npm run record          # Run with real LLMs, save fixtures ($$$, slow)
2. npm run dev             # Iterate using replay (free, instant)
3. npm test                # Evals pass locally
4. git push                # CI runs replay + evals (free, fast)

Fixture management:
- fixtures/ committed to git (human-readable JSON)
- Re-record when prompts change significantly
- Partial replay for incremental changes
- Baselines/ for regression testing
```

### When to Re-Record

- After changing system prompts significantly
- After adding new agents to the pipeline
- After changing the task input format
- Periodically (monthly) to catch model behavior drift

### When NOT to Re-Record

- Changing post-processing logic (evals catch regressions)
- Refactoring agent code that doesn't change LLM calls
- Changing budget/cost settings
- Adding guardrails (they run on the same output)

---

## Built-in Evals Reference

| Eval | What It Checks | Score |
|------|---------------|-------|
| `nonEmpty()` | Output is not null/empty/[] | 0 or 1 |
| `lengthCheck(min, max)` | Content length in range | 0-1 proportional |
| `containsKeywords(kw[])` | Keywords present in output | fraction found |
| `schemaMatch(keys[])` | Object has required keys | fraction present |
| `similarityToExpected()` | Jaccard similarity to ground truth | 0-1 |
| `noRegression()` | At least as good as previous run | 0-1 |
| `noHallucination()` | No hedging/uncertainty markers | 0-1 |

All evals return 0-1 scores. Suite passes when average >= threshold.
