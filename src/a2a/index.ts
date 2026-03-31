// A2A Protocol — Agent2Agent interop
// Types
export type {
  AgentCard,
  AgentCapabilities,
  AgentSkill,
  AgentProvider,
  SecurityScheme,
  A2AMessage,
  A2APart,
  TextPart,
  FilePart,
  DataPart,
  FileWithBytes,
  FileWithUri,
  A2ATask,
  A2ATaskState,
  A2ATaskStatus,
  A2AArtifact,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  MessageSendParams,
  TaskQueryParams,
  TaskIdParams,
  PushNotificationConfig,
  TaskPushNotificationConfig,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  A2AStreamEvent,
} from './types.js'
export { A2AErrorCodes } from './types.js'

// Agent Card
export { toAgentCard } from './agent-card.js'
export type { ToAgentCardOptions } from './agent-card.js'

// Server
export { startA2AServer, requestInput } from './server.js'
export type { A2AServerConfig } from './server.js'

// Client
export { importA2AAgent, cancelA2ATask } from './client.js'
export type { A2AClientConfig, A2AClientAuth } from './client.js'
