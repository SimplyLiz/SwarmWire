/**
 * Provider — LLM provider abstraction.
 * Supports Anthropic, OpenAI, and generic OpenAI-compatible APIs.
 */

export type ModelTier = 'cheap' | 'standard' | 'premium' | 'reasoning'

export interface ModelConfig {
  provider: string
  model: string
  temperature?: number
  maxTokens?: number
}

export interface ProviderConfig {
  name: string
  apiKey?: string
  baseUrl?: string
  defaultModel?: string
  models?: ProviderModelInfo[]
}

export interface ProviderModelInfo {
  model: string
  tier: ModelTier
  inputCostPer1kTokens: number
  outputCostPer1kTokens: number
  cachedInputCostPer1kTokens?: number
  contextWindow: number
}

export interface LlmRequest {
  model: string
  systemPrompt?: string
  messages: LlmMessage[]
  maxTokens?: number
  temperature?: number
  tools?: LlmToolDef[]
  /** Structured output — forces the model to respond with valid JSON matching the schema.
   *  OpenAI: maps to response_format. Anthropic: maps to tool_use with forced tool. */
  responseFormat?: ResponseFormat
}

export interface ResponseFormat {
  type: 'json_schema'
  /** JSON Schema that the response must conform to */
  schema: Record<string, unknown>
  /** Schema name (required by some providers). Default: 'response' */
  name?: string
}

export interface LlmMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface LlmToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface LlmResponse {
  content: string
  /** Parsed structured output when responseFormat was used */
  parsed?: unknown
  model: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  finishReason: 'stop' | 'max_tokens' | 'tool_use' | 'error'
  durationMs: number
  toolCalls?: LlmToolCall[]
}

export interface LlmToolCall {
  id: string
  name: string
  input: unknown
}

export interface Provider {
  readonly name: string
  readonly models: ProviderModelInfo[]
  chat(request: LlmRequest): Promise<LlmResponse>
  estimateCost(model: string, inputTokens: number, outputTokens: number): number
}
