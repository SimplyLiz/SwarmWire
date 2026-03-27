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
export { toAgentCard, startA2AServer, importA2AAgent } from './a2a/index.js'
export type { AgentCard, AgentCapabilities, AgentSkill, A2AServerConfig, A2ATask, A2AClientConfig } from './a2a/index.js'

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
