# Changelog

All notable changes to SwarmWire are documented here.

---

## [1.5.0] — 2026-04-09

### New Features

**Execution**
- `reduceTrajectory` — AgentDiet-style trajectory pruning (drop empty/duplicate/superseded tool results, token budget trim). 39-60% input token reduction.
- `SpeculativeToolExecutor` — PASTE-inspired prefetch of likely tool calls in parallel while the LLM generates.
- `createReducedSkillSet` / `selectRelevantTools` — Progressive skill disclosure: compact one-liners first, full schemas on demand. ~48% prompt compression.

**Memory**
- `AMem` — A-MEM Zettelkasten living memory graph. On every write, notes auto-link to related memories via cosine similarity.
- `TemporalMemory` — CMA temporal decay + spreading activation. Strength decays per-hour, reinforces on access, propagates relevance to temporal neighbors.
- `SelfEditingMemory` — Letta/MemGPT-style named memory blocks. Agents read and mutate versioned text blocks mid-execution. Full edit history + revert.
- `createFlatVectorStore` / `createPineconeStore` / `createQdrantStore` / `createRedisVectorStore` — External vector store adapters, all implementing `MemoryBackend`.
- `SleepTimeAgent` — LLM-driven background consolidation. Synthesizes insights from recent memory during idle periods.

**Core**
- `ReputationBoard` — `MessageBoard` extended with per-agent reputation scoring. Upvotes, citations, correct answers drive scores. Findings weighted by sender reputation.
- Typed DI — `AgentContext<TDeps>` and `AgentDefinition<TInput, TOutput, TDeps>`. Agents declare typed dependencies; `context.deps` is fully typed at callsite.

**Testing & Evaluation**
- `evalTrajectory` / `compareTrajectories` — TRACE-style multi-dimension trajectory evaluation: step efficiency, tool precision, backtrack rate, plan adherence, outcome quality.

**Workflow**
- `StateMachine` / `buildLinearStateMachine` — LangGraph-style directed graph with cycles, conditional edges, and `maxIterations` guard.

**Patterns**
- `runLoop` — LoopAgent primitive. Runs an agent iteratively until convergence (`shouldStop` predicate, DONE signal, or `maxIterations`). Full iteration history.

**Session**
- `BranchManager` — Fork a session at any message index to explore alternative continuations. Diff, merge, and tree visualization.

**Observability**
- `exportToOTLP` / `createOTelExporter` / `withOTelExport` — Auto-push traces to any OTLP/HTTP endpoint (Jaeger, Tempo, Honeycomb, OTEL Collector) after execution.

---

## [1.4.0] — 2026-04-08

### New Features

**Execution**
- `TimeTravelStore` — Rewind to any step and fork execution from that point with optional step modifications.
- `RollbackManager` — Snapshot state before tool calls; undo individual or full-execution actions in reverse order.

**Optimizer**
- `PromptOptimizer` — DSPy-style prompt optimization. Bootstraps few-shot examples from `DistillationCollector`, generates prompt variants via LLM, scores against training pairs.

**Testing**
- `EvalHarness` — Named harnesses with run history, pass-rate tracking, and regression detection. Computes trend (`improving` / `stable` / `degrading`) from last 3 runs.

**Tools**
- `createNodeSandbox` / `createDockerSandbox` / `createE2BSandbox` — Code execution sandbox with three backends. Returns a `Tool` for `agent.tools[]`.
- `createBrowserTool` — Playwright-backed browser automation tool (navigate, click, type, screenshot, extract).
- `createComputerUseTool` — Anthropic Computer Use API tool wrapper.

**Patterns**
- `runHierarchy` — Formal authority levels with escalation. Low-confidence outputs escalate to higher-authority agents.

**Session**
- `SessionManager` — Named persistent conversation sessions. `swarm.runInSession()` prepends prior context automatically.

**Workflow**
- `EventFlow` — Event-driven workflow runtime. Steps subscribe to events, emit new ones; execution is queue-driven rather than DAG-fixed.

**Memory**
- `EpisodicMemory` — Stores specific past interactions with temporal ordering and tag-based recall.
- `ProceduralMemory` — Stores "how to" procedures with success rate tracking.

**A2A Protocol — v1.0**
- `kind: 'task'` on `A2ATask`, `ContextId` type alias for cross-task threading.
- `AgentCard.offline?`, `A2ATaskState` gains `'streaming'`, `A2AMessage` gains `messageId` and `contextId`.
- `tasks/sendSubscribe` JSON-RPC method for SSE push.
- `streamSubscribe()` client function.
- Default `protocolVersion` bumped to `'1.0'`.

**Catalog**
- `AgentCatalog` — Runtime agent discovery by capability, tag, availability, or semantic description. Heartbeat-based liveness.

**Voice**
- `VoicePipeline` — STT → LLM → TTS pipeline. Factory methods for Deepgram, ElevenLabs, OpenAI STT/TTS.

---

## [1.3.0] — prior

### New Features
- Hooks system (`HookRegistry`, priority-ordered hooks, swarm event bridging)
- Consensus protocols (`RaftNode`, `ByzantineNode`, `GossipNode`)
- Hive-Mind pattern (`runHiveMind`)
- Federation hub (`FederationHub`)
- `ReasoningBank` — trajectory-based pattern memory with EWC
- Vector quantization (`createQuantizer` — binary, scalar, product)
- `AttentionRouter` — multi-head attention-based agent routing
- `RLRouter` / `RLRouterPPO` — reinforcement learning routers

---

## [1.2.0] — prior

### New Features
- A/B testing engine
- Judge agent for quality evaluation
- Weight table for dynamic routing
- Distillation collector for training pairs (LLMRouter)

---

## [1.1.0] — prior

### New Features
- Self-learning memory with Elastic Weight Consolidation (EWC)
- Vector memory with HNSW-like approximate nearest neighbor search
- 3-tier intelligent model routing
- Token optimizer (pattern caching, prompt compression, batch optimization)
- Knowledge graph with PageRank-based importance
- Background worker system (memory optimizer, pattern learner, metrics, health check)
- Threat detection system (SQL/command/XSS injection, path traversal, secrets, PII)
- ADR framework for spec-driven development
- 10 new agent templates (17 total)

---

## [1.0.0] — initial release

- Budget-first multi-agent orchestration
- Orchestrator-worker, pipeline, map-reduce, debate, blackboard, fan-out patterns
- Anthropic, OpenAI, Gemini, Ollama, generic OpenAI-compatible providers
- Circuit breaker, failover, rate limiter
- Routing stack: SemanticCache, LatencyRouter, CascadeRouter, SpeculativeCascade, QueryDecomposer
- MCP tool loading
- A2A v0.3 protocol
- Record/Replay testing, evals framework
- Guardrails (PII, injection, hallucination, length, content filter)
- Output contracts (schema + semantic validation)
- Approval gates
- YAML workflow compiler
- Dry-run cost projection
- Differential execution (skip unchanged steps)
- SSE streaming transport
- OpenTelemetry export
- Plugin system
- 7 agent templates
