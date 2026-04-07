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
| **Core** | `src/core/` | `Swarm` class, `createAgent()`, MCP tool loader, `MessageBoard` (inter-agent messaging), `stub-board` (no-op board for patterns), guardrails (input/output/tool guards with built-ins: PII, injection, hallucination, max-length, content-filter), output contracts (schema + semantic validation) |
| **Budget** | `src/budget/` | `BudgetLedger` (hard enforcement), cost optimizer |
| **Planner** | `src/planner/` | Task scorer, DAG builder, model router, adaptive router, cascade router, semantic cache, speculative cascade, query decomposer, latency router, **3-tier intelligent routing** |
| **Executor** | `src/executor/` | Parallel DAG runner, checkpoint/resume, dry-run cost projection, differential execution |
| **Patterns** | `src/patterns/` | Orchestrator-worker, pipeline, map-reduce, debate, blackboard |
| **Providers** | `src/providers/` | Anthropic, OpenAI, Gemini, Ollama adapters, generic OpenAI-compatible (LiteLLM/vLLM), circuit breaker, failover, rate limiter, model cascade on quality |
| **Conflict** | `src/conflict/` | Contradiction detector (Jaccard/structural), resolver (vote/evidence/escalate) |
| **Context** | `src/context/` | Token-budget-aware context packer |
| **A2A** | `src/a2a/` | Agent2Agent protocol — server, client, agent cards |
| **Pool** | `src/pool/` | Worker pool with lifecycle, concurrency, warm pooling |
| **Trace** | `src/trace/` | Human-readable execution reports, DAG visualization |
| **Workflow** | `src/workflow/` | YAML workflow parser + compiler to executable Plans |
| **Templates** | `src/templates/` | 17 pre-built agent templates (researcher, code-reviewer, synthesizer, data-analyst, qa-tester, writer, planner, security-auditor, devops-engineer, database-engineer, api-designer, performance-engineer, documentation-specialist, architecture-advisor, debugger, refactoring-specialist, integration-specialist, test-automation-engineer) |
| **Adapters** | `src/adapters/` | Claude Agent SDK wrapper |
| **Orchestrator** | `src/orchestrator/` | Evolving orchestrator (bandit-based adaptive sequencing), **A/B testing engine**, **Judge agent for quality evaluation**, **Weight table for dynamic routing**, **Distillation collector for training pairs** |
| **Persistence** | `src/persistence/` | Save/load state to disk or memory backend |
| **Memory** | `src/memory/` | ANCS memory backend, **self-learning memory with EWC**, **vector memory with HNSW-like search** |
| **Testing** | `src/testing/` | `RecordingProvider` (wraps real provider, saves fixtures), `ReplayProvider` (loads fixtures, zero-cost deterministic replay), evals framework |
| **Optimizer** | `src/optimizer/` | Token optimizer with pattern caching, compression, and batch optimization |
| **Workers** | `src/workers/` | Background worker system for continuous optimization (memory optimizer, pattern learner, metrics collector, cache cleanup, health check) |
| **Security** | `src/security/` | Threat detection system (SQL/command/XSS injection, path traversal, hardcoded secrets, prompt injection, PII detection) |
| **Spec** | `src/spec/` | Architecture Decision Records (ADRs) framework for spec-driven development |
| **Graph** | `src/graph/` | Knowledge graph with PageRank-based importance, graph-enhanced ranked retrieval |

### Data Flow

```
Task → Scorer → Planner (DAG) → Executor
                                    |
                            Approval gate (if step.gate set)
                                    |
                            Budget Ledger (gates each step)
                                    |
                            Input guardrails → Agent.execute(input, context)
                                    |
                            context.llm() / context.llm<T>() → Provider → LLM API
                                    |                          (Anthropic/OpenAI/Gemini/Ollama/generic)
                            Cost event recorded → Ledger
                                    |
                            Output guardrails → Output contract validation
                                    |
                            Step result → next step (or merge)
                                    |
                            ExecutionResult with cost summary
                                    |
                            Optional: Self-learning memory update, Pattern storage, Graph update
```

## Key Features (Expanded)

### Intelligent Capabilities
- **Self-Learning Memory**: Pattern-based learning with Elastic Weight Consolidation (EWC) to prevent catastrophic forgetting
- **Vector Memory**: HNSW-like approximate nearest neighbor search for semantic retrieval
- **3-Tier Model Routing**: Automatically routes tasks to appropriate model complexity (cheap/standard/premium)
- **Token Optimization**: Pattern caching, prompt compression, optimal batching (30-50% token savings)
- **Knowledge Graph**: PageRank-based importance calculation, graph-enhanced search ranking
- **Background Workers**: Continuous optimization (memory consolidation, pattern learning, metrics, health checks)

### Enterprise-Grade Security
- **Threat Detection**: SQL injection, command injection, XSS, path traversal, hardcoded secrets
- **Prompt Injection Protection**: Detects and blocks jailbreak attempts
- **PII Detection**: Email, SSN, phone, credit card, IP address detection
- **Auto-Sanitization**: Optional automatic threat neutralization

### Spec-Driven Development
- **ADR Framework**: Architecture Decision Records with Markdown serialization
- **Compliance Checking**: Verify code follows architectural decisions
- **Living Documentation**: Auto-updating specs as requirements evolve

### Agent Templates (17 Specialized Agents)
- `researcher` — Find, analyze, and summarize information
- `codeReviewer` — Review code for quality, security, performance
- `synthesizer` — Merge multiple perspectives into coherent output
- `dataAnalyst` — Analyze data, find patterns, generate insights
- `qaTester` — Find edge cases, generate test scenarios
- `writer` — Produce clear, well-structured written content
- `planner` — Decompose complex tasks into actionable steps
- `securityAuditor` — Identify vulnerabilities and compliance issues
- `devopsEngineer` — Design deployment pipelines and infrastructure
- `databaseEngineer` — Design schemas, optimize queries, handle migrations
- `apiDesigner` — Design REST/GraphQL APIs with proper contracts
- `performanceEngineer` — Identify bottlenecks and optimize performance
- `documentationSpecialist` — Create comprehensive technical documentation
- `architectureAdvisor` — Provide architectural guidance and patterns
- `debugger` — Systematically diagnose and fix bugs
- `refactoringSpecialist` — Improve code quality through refactoring
- `integrationSpecialist` — Design and implement system integrations
- `testAutomationEngineer` — Build scalable test automation frameworks

## Conventions

- ES Modules (`"type": "module"` in package.json)
- Strict TypeScript (`noUncheckedIndexedAccess`, `noImplicitOverride`)
- No runtime dependencies except `zod` — LLM SDKs are optional peer deps
- Provider adapters lazy-import SDKs at call time (not at module load)
- All public types exported from `src/types/`
- Patterns are standalone functions, not methods on Swarm (composable)
- Budget is always a hard constraint, never advisory
- Agent `execute()` receives an `AgentContext` with `llm()`, `llm<T>()` (structured output via `responseFormat`), `tool()`, `trace()`, `getStepOutput()`, `board` (MessageBoard access)
- Agent definitions accept a `guardrails` config with `input`, `output`, `toolInput`, `toolOutput` arrays
- Steps can have an `ApprovalGate` — pauses execution until `onApproval` callback resolves

## Testing

- All tests in `tests/unit/` — pure unit tests, no external services
- Tests use mock providers that return canned responses
- 29 test files, 265 tests
- Run with `npm test`

## Peer Dependencies

Optional — only loaded if installed:
- `@anthropic-ai/sdk` — for Anthropic provider
- `openai` — for OpenAI provider (also used by Gemini, Ollama, and generic providers)
- `@anthropic-ai/claude-agent-sdk` — for Claude Agent SDK adapter

## Key Design Decisions

- **Library, not framework**: users call SwarmWire, it doesn't call them
- **Budget-first**: the #1 gap in every competitor
- **Progressive disclosure**: `swarm.run('prompt')` → full DAG control
- **Patterns as functions**: composable, not inheritance-based
- **No YAML dependency**: hand-rolled minimal YAML parser for workflow subset
- **Evolving orchestrator uses bandit, not RL**: practical without training loop
- **Intelligent by default, optional**: Advanced features like self-learning, vector search, and graph ranking are available but not required for basic use
