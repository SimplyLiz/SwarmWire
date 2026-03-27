# SwarmWire — Development Guide

## Quick Commands

```bash
npm test                     # Run all tests (vitest)
npm run test:watch           # Watch mode
npm run typecheck            # TypeScript check (no emit)
npm run build                # Compile to dist/
npm run lint                 # ESLint
npm run clean                # Remove dist/
```

## Architecture

**Stack:** TypeScript, ES Modules, Vitest, Zod (validation only)

**Entry point:** `src/index.ts` (barrel exports)

**Top-level API:** `src/core/swarm.ts` — the `Swarm` class users interact with

### Module Map

| Module | Path | Purpose |
|--------|------|---------|
| **Types** | `src/types/` | All TypeScript interfaces — agent, budget, plan, task, execution, provider, tool, memory, pattern |
| **Core** | `src/core/` | `Swarm` class, `createAgent()`, MCP tool loader, `MessageBoard` (inter-agent messaging), `stub-board` (no-op board for patterns) |
| **Budget** | `src/budget/` | `BudgetLedger` (hard enforcement), cost optimizer |
| **Planner** | `src/planner/` | Task scorer, DAG builder, model router, adaptive router, cascade router, semantic cache, speculative cascade, query decomposer, latency router |
| **Executor** | `src/executor/` | Parallel DAG runner, checkpoint/resume |
| **Patterns** | `src/patterns/` | Orchestrator-worker, pipeline, map-reduce, debate, blackboard |
| **Providers** | `src/providers/` | Anthropic, OpenAI adapters, circuit breaker, failover, rate limiter |
| **Conflict** | `src/conflict/` | Contradiction detector (Jaccard/structural), resolver (vote/evidence/escalate) |
| **Context** | `src/context/` | Token-budget-aware context packer |
| **A2A** | `src/a2a/` | Agent2Agent protocol — server, client, agent cards |
| **Pool** | `src/pool/` | Worker pool with lifecycle, concurrency, warm pooling |
| **Trace** | `src/trace/` | Human-readable execution reports, DAG visualization |
| **Workflow** | `src/workflow/` | YAML workflow parser + compiler to executable Plans |
| **Templates** | `src/templates/` | 7 pre-built agent templates |
| **Adapters** | `src/adapters/` | Claude Agent SDK wrapper |
| **Orchestrator** | `src/orchestrator/` | Evolving orchestrator (bandit-based adaptive sequencing) |
| **Persistence** | `src/persistence/` | Save/load state to disk or memory backend |
| **Memory** | `src/memory/` | ANCS memory backend |

### Data Flow

```
Task → Scorer → Planner (DAG) → Executor
                                    |
                            Budget Ledger (gates each step)
                                    |
                            Agent.execute(input, context)
                                    |
                            context.llm() → Provider → LLM API
                                    |
                            Cost event recorded → Ledger
                                    |
                            Step result → next step (or merge)
                                    |
                            ExecutionResult with cost summary
```

## Conventions

- ES Modules (`"type": "module"` in package.json)
- Strict TypeScript (`noUncheckedIndexedAccess`, `noImplicitOverride`)
- No runtime dependencies except `zod` — LLM SDKs are optional peer deps
- Provider adapters lazy-import SDKs at call time (not at module load)
- All public types exported from `src/types/`
- Patterns are standalone functions, not methods on Swarm (composable)
- Budget is always a hard constraint, never advisory
- Agent `execute()` receives an `AgentContext` with `llm()`, `tool()`, `trace()`, `getStepOutput()`, `board` (MessageBoard access)

## Testing

- All tests in `tests/unit/` — pure unit tests, no external services
- Tests use mock providers that return canned responses
- 25 test files, 210 tests
- Run with `npm test`

## Peer Dependencies

Optional — only loaded if installed:
- `@anthropic-ai/sdk` — for Anthropic provider
- `openai` — for OpenAI provider
- `@anthropic-ai/claude-agent-sdk` — for Claude Agent SDK adapter

## Key Design Decisions

- **Library, not framework**: users call SwarmWire, it doesn't call them
- **Budget-first**: the #1 gap in every competitor
- **Progressive disclosure**: `swarm.run('prompt')` → full DAG control
- **Patterns as functions**: composable, not inheritance-based
- **No YAML dependency**: hand-rolled minimal YAML parser for workflow subset
- **Evolving orchestrator uses bandit, not RL**: practical without training loop
