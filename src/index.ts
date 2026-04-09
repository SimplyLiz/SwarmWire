// SwarmWire — Multi-agent orchestration library
// https://github.com/swarmwire/swarmwire

// Core
export { Swarm, createAgent, MessageBoard, PluginRegistry, definePlugin } from './core/index.js'
export type { SwarmConfig, SwarmRunOptions } from './core/index.js'
export type { Message, MessageType, MessageFilter, BoardStats, PostOptions } from './core/messageboard.js'
export type { SwarmWirePlugin, PluginContext, PluginMiddleware } from './core/plugins.js'

// Types
export type {
  Agent,
  AgentDefinition,
  AgentContext,
  AgentOutput,
  AgentCost,
  AgentResultStatus,
} from './types/agent.js'

export type {
  Budget,
  BudgetEstimate,
  BudgetUsage,
  CostEvent,
  CostSummary,
  ModelPreference,
} from './types/budget.js'

export type {
  ExecutionResult,
  ExecutionTrace,
  TraceSpan,
  EvidenceRef,
  Conflict,
  ConflictResolution,
} from './types/execution.js'

export type {
  Plan,
  Step,
  StepInput,
  AgentRef,
  ExecutionMode,
} from './types/plan.js'

export type {
  Task,
  TaskScore,
  TaskFactors,
  TaskDifficulty,
} from './types/task.js'

export type {
  Provider,
  ProviderConfig,
  ProviderModelInfo,
  ModelConfig,
  ModelTier,
  LlmRequest,
  LlmResponse,
  ResponseFormat,
} from './types/provider.js'

export type { Tool } from './types/tool.js'

export type {
  MemoryBackend,
  MemoryItem,
  StoreMeta,
  QueryOpts,
} from './types/memory.js'

export type {
  PatternName,
  SwarmEvent,
  MergeStrategy,
  ConflictStrategy,
} from './types/pattern.js'

// Providers
export { createProvider } from './providers/index.js'
export { createAnthropicProvider } from './providers/anthropic.js'
export { createOpenAIProvider } from './providers/openai.js'
export { createGeminiProvider } from './providers/gemini.js'
export { createOllamaProvider } from './providers/ollama.js'
export { withCircuitBreaker, withFailover, CircuitOpenError } from './providers/circuit-breaker.js'
export type { CircuitBreakerConfig } from './providers/circuit-breaker.js'

// Budget
export { BudgetLedger } from './budget/index.js'

// Planner
export { scoreTask, buildPlan, routeModel, matchAgent } from './planner/index.js'
export { CascadeRouter, buildModelLadder } from './planner/cascade-router.js'
export type { CascadeRouterConfig, CascadeResult, CascadeTrace, CascadeStats, ModelLadder, ModelRung, ModelStat, QualityEstimatorFn } from './planner/cascade-router.js'
export { SemanticCache } from './planner/semantic-cache.js'
export type { SemanticCacheConfig, CacheBackend, CacheEntry, CacheStats } from './planner/semantic-cache.js'
export { speculativeCascade } from './planner/speculative-cascade.js'
export type { SpeculativeCascadeConfig, SpeculativeResult } from './planner/speculative-cascade.js'
export { decomposeQuery, executeDecomposed } from './planner/query-decomposer.js'
export type { DecomposedQuery, Subtask, DecompositionResult, SubtaskResponse } from './planner/query-decomposer.js'
export { LatencyRouter } from './planner/latency-router.js'
export type { LatencyRouterConfig } from './planner/latency-router.js'

// Executor
export { executePlan } from './executor/index.js'
export { createCheckpoint, restoreFromCheckpoint, serializeCheckpoint, deserializeCheckpoint } from './executor/checkpoint.js'
export type { Checkpoint, StepSnapshot } from './executor/checkpoint.js'

// Patterns
export { runOrchestratorWorker } from './patterns/orchestrator-worker.js'
export { runPipeline } from './patterns/pipeline.js'
export { runMapReduce } from './patterns/map-reduce.js'
export { runDebate } from './patterns/debate.js'
export { runBlackboard, Blackboard } from './patterns/blackboard.js'
export type { BlackboardConfig, BlackboardState, BlackboardEntry } from './patterns/blackboard.js'
export { runFanOut } from './patterns/fan-out.js'
export type { FanOutConfig } from './patterns/fan-out.js'

// Conflict
export { detectConflicts, resolveConflict } from './conflict/index.js'
export type { DetectorOptions } from './conflict/index.js'

// Context
export { packContext, estimateTokens, sourceFromStepOutput } from './context/index.js'
export type { ContextBundle, ContextSource, PackOptions } from './context/index.js'

// MCP
export { loadMcpTools } from './core/mcp.js'
export type { McpServerConfig } from './core/mcp.js'

// Memory backends
export { ancsMemory } from './memory/ancs.js'
export type { AncsMemoryConfig } from './memory/ancs.js'

// A2A Protocol
export { toAgentCard, startA2AServer, importA2AAgent, cancelA2ATask, requestInput, A2AErrorCodes } from './a2a/index.js'
export type {
  AgentCard, AgentCapabilities, AgentSkill, AgentProvider, SecurityScheme,
  A2AServerConfig, A2ATask, A2ATaskState, A2ATaskStatus, A2AArtifact,
  A2AMessage, A2APart, TextPart, FilePart, DataPart,
  A2AClientConfig, A2AClientAuth,
  JsonRpcRequest, JsonRpcResponse, JsonRpcError,
  MessageSendParams, TaskQueryParams, TaskIdParams,
  PushNotificationConfig, TaskPushNotificationConfig,
  TaskStatusUpdateEvent, TaskArtifactUpdateEvent, A2AStreamEvent,
  ToAgentCardOptions,
} from './a2a/index.js'

// Worker Pool
export { WorkerPool } from './pool/index.js'
export type { WorkerPoolConfig, Worker, WorkerStatus, PoolStatus } from './pool/index.js'

// Adaptive Router
export { AdaptiveRouter } from './planner/adaptive-router.js'
export type { ExecutionRecord, AgentScore } from './planner/adaptive-router.js'

// Rate Limiter
export { withRateLimit } from './providers/rate-limiter.js'
export type { RateLimiterConfig } from './providers/rate-limiter.js'

// Trace / Explainer
export { explainExecution, summarizeExecution, visualizePlan } from './trace/index.js'

// Cost Optimizer
export { analyzeCosts, analyzeHistory } from './budget/optimizer.js'
export type { CostRecommendation } from './budget/optimizer.js'

// YAML Workflows
export { parseWorkflow, compileWorkflow, WorkflowParseError } from './workflow/index.js'
export type { WorkflowDef, WorkflowStepDef, WorkflowInputDef, CompileOptions } from './workflow/index.js'

// Agent Templates
export * as templates from './templates/index.js'

// SDK Adapters
export { fromClaudeAgentSDK } from './adapters/index.js'
export type { ClaudeAgentConfig } from './adapters/index.js'

// Evolving Orchestrator
export { EvolvingOrchestrator } from './orchestrator/index.js'
export type { EvolvingConfig } from './orchestrator/index.js'

// Persistence
export { saveState, loadState, saveStateToMemory, loadStateFromMemory, emptyState } from './persistence/index.js'
export type { SwarmWireState } from './persistence/index.js'

// Testing — Record/Replay
export { RecordingProvider, ReplayProvider, ReplayMismatchError } from './testing/index.js'
export type { Fixture, FixtureInteraction, ReplayOptions } from './testing/index.js'
export { runEval, runEvalSuite, runEvalBatch, nonEmpty, lengthCheck, containsKeywords, schemaMatch, similarityToExpected, noRegression, noHallucination } from './testing/evals.js'
export type { Eval, EvalSuite, EvalResult, SuiteResult, EvalContext } from './testing/evals.js'

// Guardrails
export { runGuardrails, GuardrailTripped, piiGuardrail, injectionGuardrail, hallucinationGuardrail, maxLengthGuardrail, contentFilter } from './core/guardrails.js'
export type { Guardrail, GuardrailConfig, GuardrailContext, GuardrailResult, GuardrailRunResult } from './core/guardrails.js'

// Dry-Run
export { dryRun } from './executor/dry-run.js'
export type { DryRunResult, StepEstimate } from './executor/dry-run.js'

// Differential Execution
export { diffPlans, applyPreviousResults } from './executor/diff-execute.js'
export type { DiffResult } from './executor/diff-execute.js'

// OpenTelemetry
export { toOTelSpans, toOTLPJson } from './trace/otel.js'
export type { OTelSpan, OTelExportConfig } from './trace/otel.js'

// Agent Contracts
export { validateOutput, withContract, ContractViolationError } from './core/contracts.js'
export type { OutputContract, ValidationResult, ValidationContext } from './core/contracts.js'

// Model Cascade
export { chatWithCascade } from './providers/model-cascade.js'
export type { FallbackModel, ModelCascadeConfig, ModelCascadeResult } from './providers/model-cascade.js'

// Plan types (approval gates)
export type { ApprovalGate, ApprovalCallback } from './types/plan.js'

// SSE Transport
export { sseHeaders, sseEvent, pipeToSSE } from './transport/index.js'
export type { PipeOptions } from './transport/index.js'

// Hooks
export { HookRegistry, HookPriority, bridgeSwarmEvents } from './hooks/index.js'
export type { HookEvent, HookFn, HookContext, HookRegistration, HookStats } from './hooks/index.js'

// Consensus
export { RaftNode, ByzantineNode, GossipNode } from './consensus/index.js'
export type { ConsensusConfig, ConsensusResult, LogEntry, GossipMessage } from './consensus/index.js'

// Patterns — Hive-Mind
export { runHiveMind } from './patterns/hive-mind.js'
export type { HiveMindConfig, TaskAnalysis, DelegationPlan, AgentDomain } from './patterns/hive-mind.js'

// Federation
export { FederationHub } from './federation/index.js'
export type { FederationConfig, SwarmRegistration, EphemeralAgent, ConsensusProposal as FederationProposal } from './federation/index.js'

// Memory — ReasoningBank + Quantization
export { ReasoningBank } from './memory/reasoning-bank.js'
export { createQuantizer } from './memory/vector.js'
export type { Trajectory, Pattern as ReasoningPattern, RetrievalResult, ReasoningBankConfig } from './memory/reasoning-bank.js'
export type { QuantizationConfig, VectorCodec } from './memory/vector.js'

// Planner — Attention + RL Routers
export { AttentionRouter } from './planner/attention-router.js'
export { RLRouter, RLRouterPPO } from './planner/rl-router.js'
export type { AttentionRouterConfig, AttentionResult, AttentionMechanism } from './planner/attention-router.js'
export type { RLRouterConfig, RLState, RLAction, Experience } from './planner/rl-router.js'

// Executor — Trajectory Reducer + Speculative Tools
export { reduceTrajectory, classifyMessage } from './executor/trajectory-reducer.js'
export type { TrajectoryMessage, ReducerConfig, ReducerStats } from './executor/trajectory-reducer.js'
export { SpeculativeToolExecutor, createKeywordPredictor } from './executor/speculative-tools.js'
export type { SpeculativeToolConfig, SpeculativePrediction, PrefetchResult, SpeculativeStats } from './executor/speculative-tools.js'

// Tools — Skill Reducer
export { createReducedSkillSet, createReducedSkillSetAsync, selectRelevantTools } from './tools/skill-reducer.js'
export type { SkillSummary, SkillReducerConfig, ReducedSkillSet } from './tools/skill-reducer.js'

// Memory — A-MEM + Temporal + Self-Editing + Vector Stores
export { AMem } from './memory/a-mem.js'
export type { AMemNote, AMemConfig } from './memory/a-mem.js'
export { TemporalMemory } from './memory/temporal.js'
export type { TemporalNote, TemporalMemoryConfig } from './memory/temporal.js'
export { SelfEditingMemory } from './memory/self-editing.js'
export type { MemoryBlock, BlockEdit, SelfEditingMemoryConfig } from './memory/self-editing.js'
export { createFlatVectorStore, createPineconeStore, createQdrantStore, createRedisVectorStore } from './memory/vector-stores.js'
export type { VectorStoreConfig, PineconeConfig, QdrantConfig, RedisVectorConfig } from './memory/vector-stores.js'

// Core — Reputation Board
export { ReputationBoard } from './core/reputation-board.js'
export type { ReputationScore, ReputationConfig, WeightedMessage } from './core/reputation-board.js'

// Testing — Trajectory Eval
export { evalTrajectory, compareTrajectories } from './testing/trajectory-eval.js'
export type { Trajectory as EvalTrajectory, TrajectoryStep, TrajectoryEvalConfig, TrajectoryEvalResult, TrajectoryCompareResult } from './testing/trajectory-eval.js'

// Workers — Sleep-Time Agent
export { SleepTimeAgent } from './workers/sleep-time-agent.js'
export type { SleepTimeAgentConfig, ConsolidationResult } from './workers/sleep-time-agent.js'

// Workflow — State Machine
export { StateMachine, buildLinearStateMachine, END } from './workflow/state-machine.js'
export type { StateNode, StateEdge, StateMachineConfig, StateMachineResult, StateMachineContext } from './workflow/state-machine.js'

// Patterns — Loop Agent
export { runLoop, loopResultToExecution } from './patterns/loop-agent.js'
export type { LoopAgentConfig, LoopResult } from './patterns/loop-agent.js'

// Session — Conversation Branching
export { BranchManager } from './session/branch.js'
export type { BranchedSession, BranchPoint, BranchTree, BranchManagerConfig } from './session/branch.js'

// Trace — OTel Auto-Exporter
export { exportToOTLP, createOTelExporter, withOTelExport } from './trace/otel-exporter.js'
export type { OTelExporterConfig, ExportResult } from './trace/otel-exporter.js'

// Executor — Rollback + Time-Travel
export { RollbackManager } from './executor/rollback.js'
export type { ActionSnapshot, RollbackResult } from './executor/rollback.js'
export { TimeTravelStore } from './executor/time-travel.js'
export type { TimelineEntry, ForkOptions, ForkResult } from './executor/time-travel.js'

// Session Management
export { SessionManager } from './session/index.js'
export type { Session, ConversationMessage, SessionConfig } from './session/index.js'

// Eval Harness
export { EvalHarness } from './testing/eval-harness.js'
export type { HarnessConfig, HarnessRunRecord, HarnessReport } from './testing/eval-harness.js'

// Prompt Optimizer
export { PromptOptimizer } from './optimizer/prompt-optimizer.js'
export type { PromptOptimizerConfig, OptimizationResult, FewShotExample, OptimizationMetric } from './optimizer/prompt-optimizer.js'

// Memory — Episodic + Procedural
export { EpisodicMemory } from './memory/episodic.js'
export { ProceduralMemory } from './memory/procedural.js'
export type { EpisodicEntry, EpisodicMemoryConfig } from './memory/episodic.js'
export type { Procedure, ProcedureStep, ProceduralMemoryConfig } from './memory/procedural.js'

// Workflow — Event-Driven
export { EventFlow } from './workflow/event-driven.js'
export type { FlowEvent, FlowContext, FlowStepDef, FlowStepHandler, EventFlowConfig, EventFlowResult } from './workflow/event-driven.js'

// Patterns — Hierarchy
export { runHierarchy } from './patterns/hierarchy.js'
export type { HierarchyConfig, AuthorityLevel, AuthorityDecision } from './patterns/hierarchy.js'

// Agent Discovery Catalog
export { AgentCatalog } from './catalog/index.js'
export type { CatalogEntry, CatalogConfig, DiscoveryQuery } from './catalog/index.js'

// Tools — Code Sandbox
export { createNodeSandbox, createDockerSandbox, createE2BSandbox, createCodeExecutionTool } from './tools/code-sandbox.js'
export type { CodeSandbox, SandboxResult, NodeSandboxConfig, DockerSandboxConfig } from './tools/code-sandbox.js'

// Tools — Browser
export { createBrowserTool, createComputerUseTool } from './tools/browser.js'
export type { BrowserAction, BrowserResult, BrowserConfig, ComputerUseConfig } from './tools/browser.js'

// Voice Pipeline
export { VoicePipeline } from './voice/index.js'
export type { STTProvider, TTSProvider, VoicePipelineConfig, VoiceTurn } from './voice/index.js'

// A2A — streamSubscribe
export { streamSubscribe } from './a2a/client.js'
export type { ContextId } from './a2a/types.js'
