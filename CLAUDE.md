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
| **Core** | `src/core/` | `Swarm` class, `createAgent()`, MCP tool loader, `MessageBoard`, `ReputationBoard` (reputation-weighted board), `stub-board`, guardrails, output contracts |
| **Budget** | `src/budget/` | `BudgetLedger` (hard enforcement), cost optimizer |
| **Planner** | `src/planner/` | Task scorer, DAG builder, model router, adaptive router, cascade router, semantic cache, speculative cascade, query decomposer, latency router, attention router, RL router, 3-tier routing |
| **Executor** | `src/executor/` | Parallel DAG runner, checkpoint/resume, dry-run, differential execution, time-travel debugging, rollback manager, trajectory reducer (AgentDiet), speculative tool executor (PASTE) |
| **Patterns** | `src/patterns/` | Orchestrator-worker, pipeline, map-reduce, debate, blackboard, fan-out, hive-mind, hierarchy, loop-agent |
| **Providers** | `src/providers/` | Anthropic, OpenAI, Gemini, Ollama, generic OpenAI-compatible (LiteLLM/vLLM), circuit breaker, failover, rate limiter, model cascade on quality |
| **Conflict** | `src/conflict/` | Contradiction detector (Jaccard/structural), resolver (vote/evidence/escalate) |
| **Context** | `src/context/` | Token-budget-aware context packer |
| **A2A** | `src/a2a/` | Agent2Agent protocol v1.0 — server, client, agent cards, contextId, streaming state, `tasks/sendSubscribe` |
| **Pool** | `src/pool/` | Worker pool with lifecycle, concurrency, warm pooling |
| **Trace** | `src/trace/` | Human-readable execution reports, DAG visualization, OTel export (`toOTelSpans`, `toOTLPJson`), OTel auto-exporter (OTLP push) |
| **Workflow** | `src/workflow/` | YAML workflow parser + compiler, event-driven workflows (`EventFlow`), graph state machine (`StateMachine`) |
| **Templates** | `src/templates/` | 17 pre-built agent templates |
| **Adapters** | `src/adapters/` | Claude Agent SDK wrapper |
| **Orchestrator** | `src/orchestrator/` | Evolving orchestrator, A/B testing, judge agent, weight table, distillation collector |
| **Persistence** | `src/persistence/` | Save/load state to disk or memory backend |
| **Memory** | `src/memory/` | ANCS, self-learning (EWC), vector (HNSW-like), A-MEM (Zettelkasten graph), temporal (CMA decay), self-editing blocks (Letta), episodic, procedural, external vector store adapters (Pinecone/Qdrant/Redis/flat) |
| **Session** | `src/session/` | Named persistent sessions, `SessionManager`, conversation branching (`BranchManager`) |
| **Testing** | `src/testing/` | `RecordingProvider`, `ReplayProvider`, evals framework, `EvalHarness` (run history + regression), trajectory evaluation (TRACE) |
| **Optimizer** | `src/optimizer/` | Token optimizer, prompt optimizer (DSPy-style) |
| **Workers** | `src/workers/` | Background workers (memory optimizer, pattern learner, metrics, health check), sleep-time compute agent |
| **Security** | `src/security/` | Threat detection (SQL/command/XSS injection, path traversal, secrets, prompt injection, PII) |
| **Tools** | `src/tools/` | Code execution sandbox (Node vm / Docker / E2B), browser tool (Playwright), computer use (Anthropic), skill reducer (progressive disclosure) |
| **Voice** | `src/voice/` | Voice agent pipeline (STT → LLM → TTS), Deepgram/ElevenLabs/OpenAI providers |
| **Catalog** | `src/catalog/` | Agent discovery catalog with semantic search |
| **Hooks** | `src/hooks/` | Hook registry, priority-ordered hooks, swarm event bridging |
| **Consensus** | `src/consensus/` | Raft, Byzantine fault-tolerant, Gossip consensus |
| **Federation** | `src/federation/` | Multi-swarm federation hub |
| **Spec** | `src/spec/` | Architecture Decision Records (ADRs) |
| **Graph** | `src/graph/` | Knowledge graph with PageRank, graph-enhanced retrieval |
| **Viz** | `src/viz/` | Mermaid diagrams (`executionToMermaid`, `traceToMermaidGantt`), HTML dashboard (`toHTML`, `exportHTML`, `openInBrowser`), `StateMachine.toMermaid()` |

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
- 71 test files, 621 tests
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
