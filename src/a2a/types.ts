/**
 * A2A Protocol Types — spec-compliant type definitions.
 * Based on A2A v0.3 specification: https://a2a-protocol.org/v0.3.0/specification/
 */

// ─── Agent Card ────────────────────────────────────────────────

/** Alias for cross-task threading context identifier. */
export type ContextId = string

export interface AgentCard {
  kind: 'agentCard'
  name: string
  description: string
  url: string
  version: string
  protocolVersion: string
  capabilities: AgentCapabilities
  skills: AgentSkill[]
  defaultInputModes: string[]
  defaultOutputModes: string[]
  provider?: AgentProvider
  iconUrl?: string
  documentationUrl?: string
  securitySchemes?: Record<string, SecurityScheme>
  security?: Record<string, string[]>[]
  supportsAuthenticatedExtendedCard?: boolean
  /** Whether the agent is available for offline discovery. */
  offline?: boolean
}

export interface AgentCapabilities {
  streaming?: boolean
  pushNotifications?: boolean
  stateTransitionHistory?: boolean
}

export interface AgentSkill {
  id: string
  name: string
  description: string
  tags: string[]
  examples?: string[]
  inputModes?: string[]
  outputModes?: string[]
}

export interface AgentProvider {
  organization: string
  url?: string
}

export type SecurityScheme =
  | { type: 'apiKey'; name: string; in: 'header' | 'query' }
  | { type: 'http'; scheme: 'bearer' | 'basic'; bearerFormat?: string }
  | { type: 'oauth2'; flows: Record<string, unknown> }
  | { type: 'openIdConnect'; openIdConnectUrl: string }

// ─── Messages & Parts ──────────────────────────────────────────

export interface A2AMessage {
  role: 'user' | 'agent'
  parts: A2APart[]
  messageId?: string
  contextId?: ContextId
}

export type A2APart = TextPart | FilePart | DataPart

export interface TextPart {
  type: 'text'
  text: string
  mimeType?: string
}

export interface FilePart {
  type: 'file'
  file: FileWithBytes | FileWithUri
  metadata?: Record<string, unknown>
}

export interface FileWithBytes {
  bytes: string // base64-encoded
  name?: string
  mimeType?: string
}

export interface FileWithUri {
  uri: string
  name?: string
  mimeType?: string
}

export interface DataPart {
  type: 'data'
  data: unknown
  mimeType?: string
}

// ─── Task ──────────────────────────────────────────────────────

export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'streaming'
  | 'input-required'
  | 'auth-required'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected'

export interface A2ATaskStatus {
  state: A2ATaskState
  message?: A2AMessage
  timestamp: string // ISO 8601
}

export interface A2ATask {
  kind: 'task'
  id: string
  contextId: ContextId
  status: A2ATaskStatus
  history?: A2AMessage[]
  artifacts?: A2AArtifact[]
  metadata?: Record<string, unknown>
}

export interface A2AArtifact {
  id: string
  name?: string
  description?: string
  parts: A2APart[]
  metadata?: Record<string, unknown>
}

// ─── JSON-RPC ──────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: JsonRpcError
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

// ─── Method Params ─────────────────────────────────────────────

export interface MessageSendParams {
  taskId?: string
  skillId?: string
  message: A2AMessage
  configuration?: TaskConfiguration
}

export interface TaskConfiguration {
  contextId?: string
  metadata?: Record<string, unknown>
}

export interface TaskQueryParams {
  id: string
  historyLength?: number
}

export interface TaskIdParams {
  id: string
}

// ─── Push Notifications ────────────────────────────────────────

export interface PushNotificationConfig {
  url: string
  headers?: Record<string, string>
  authentication?: {
    type: 'bearer' | 'basic'
    credentials: string
  }
}

export interface TaskPushNotificationConfig {
  taskId: string
  config: PushNotificationConfig
}

// ─── SSE Events ────────────────────────────────────────────────

export interface TaskStatusUpdateEvent {
  type: 'task.status.update'
  taskId: string
  status: A2ATaskStatus
  final: boolean
}

export interface TaskArtifactUpdateEvent {
  type: 'task.artifact.update'
  taskId: string
  artifact: A2AArtifact
  append: boolean
  lastChunk: boolean
}

export type A2AStreamEvent = TaskStatusUpdateEvent | TaskArtifactUpdateEvent

// ─── Error Codes ───────────────────────────────────────────────

export const A2AErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  INVALID_TASK_ID: 1001,
  TASK_NOT_FOUND: 1002,
  TASK_NOT_CANCELABLE: 1003,
  UNSUPPORTED_SKILL: 1004,
  INVALID_MESSAGE: 1005,
  AUTH_REQUIRED: 1006,
  AUTH_DENIED: 1007,
  INVALID_WEBHOOK: 1008,
  UNSUPPORTED_TRANSPORT: 1009,
} as const
