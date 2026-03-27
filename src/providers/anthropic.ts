/**
 * Anthropic provider adapter.
 * Peer dependency — only loaded if @anthropic-ai/sdk is installed.
 */

import type {
  Provider,
  ProviderConfig,
  ProviderModelInfo,
  LlmRequest,
  LlmResponse,
  ModelTier,
} from '../types/provider.js'

const ANTHROPIC_MODELS: ProviderModelInfo[] = [
  {
    model: 'claude-haiku-4-5-20251001',
    tier: 'cheap' as ModelTier,
    inputCostPer1kTokens: 0.80,
    outputCostPer1kTokens: 4.00,
    cachedInputCostPer1kTokens: 0.08,
    contextWindow: 200_000,
  },
  {
    model: 'claude-sonnet-4-6-20260320',
    tier: 'standard' as ModelTier,
    inputCostPer1kTokens: 3.00,
    outputCostPer1kTokens: 15.00,
    cachedInputCostPer1kTokens: 0.30,
    contextWindow: 200_000,
  },
  {
    model: 'claude-opus-4-6-20260320',
    tier: 'premium' as ModelTier,
    inputCostPer1kTokens: 15.00,
    outputCostPer1kTokens: 75.00,
    cachedInputCostPer1kTokens: 1.50,
    contextWindow: 200_000,
  },
]

export function createAnthropicProvider(config: ProviderConfig): Provider {
  let clientPromise: Promise<AnthropicClient> | null = null

  function getClient(): Promise<AnthropicClient> {
    if (!clientPromise) {
      clientPromise = (async () => {
        try {
          const mod = await import('@anthropic-ai/sdk')
          const Anthropic = mod.default ?? mod.Anthropic
          return new Anthropic({ apiKey: config.apiKey }) as AnthropicClient
        } catch {
          throw new Error(
            'swarmwire: @anthropic-ai/sdk is required for the Anthropic provider. Install it: npm install @anthropic-ai/sdk'
          )
        }
      })()
    }
    return clientPromise
  }

  const models = config.models ?? ANTHROPIC_MODELS

  const provider: Provider = {
    name: 'anthropic',
    models,

    async chat(request: LlmRequest): Promise<LlmResponse> {
      const client = await getClient()
      const start = performance.now()

      const messages = request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

      const systemMsg = request.systemPrompt
        ?? request.messages.find((m) => m.role === 'system')?.content

      const params: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        messages,
      }
      if (systemMsg) {
        if (request.cacheSystemPrompt) {
          // Anthropic prompt caching: wrap system in array with cache_control
          params.system = [{ type: 'text', text: systemMsg, cache_control: { type: 'ephemeral' } }]
        } else {
          params.system = systemMsg
        }
      }
      if (request.temperature !== undefined) params.temperature = request.temperature

      // Structured output — use modern output_config.format API (SDK >= 0.50)
      // Falls back to tool_use trick for older SDK versions
      if (request.responseFormat) {
        params.output_config = {
          format: {
            type: 'json_schema',
            json_schema: request.responseFormat.schema,
            name: request.responseFormat.name ?? 'response',
          },
        }
      }

      // Try messages.parse() for structured output, fall back to messages.create()
      const messagesApi = (client as { messages: { parse?: (p: unknown) => Promise<AnthropicResponse>; create: (p: unknown) => Promise<AnthropicResponse> } }).messages
      const response = request.responseFormat && messagesApi.parse
        ? await messagesApi.parse(params)
        : await messagesApi.create(params)
      const durationMs = performance.now() - start

      const blocks = response.content as Array<{ type: string; text?: string; input?: unknown }>
      const textBlocks = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')

      // Extract structured output
      let parsed: unknown
      if (request.responseFormat) {
        // Modern API: parsed_output from messages.parse()
        parsed = (response as { parsed_output?: unknown }).parsed_output
        // Fallback: tool_use block (old SDK versions)
        if (parsed === undefined) {
          const toolBlock = blocks.find((b) => b.type === 'tool_use')
          if (toolBlock?.input) parsed = toolBlock.input
        }
        // Last resort: parse content as JSON
        if (parsed === undefined && textBlocks) {
          try { parsed = JSON.parse(textBlocks) } catch { /* leave undefined */ }
        }
      }

      const content = parsed ? JSON.stringify(parsed) : textBlocks

      return {
        content,
        parsed,
        model: response.model as string,
        inputTokens: (response.usage as { input_tokens: number }).input_tokens,
        outputTokens: (response.usage as { output_tokens: number }).output_tokens,
        cachedInputTokens: ((response.usage as Record<string, number>).cache_read_input_tokens) ?? 0,
        finishReason: mapStopReason(response.stop_reason as string),
        durationMs,
      }
    },

    estimateCost(model: string, inputTokens: number, outputTokens: number): number {
      const info = models.find((m) => m.model === model) ?? models.find((m) => model.startsWith(m.model.split('-').slice(0, 3).join('-')))
      if (!info) return 0
      return (inputTokens / 1000) * info.inputCostPer1kTokens + (outputTokens / 1000) * info.outputCostPer1kTokens
    },
  }

  return provider
}

function mapStopReason(reason: string): LlmResponse['finishReason'] {
  switch (reason) {
    case 'end_turn': return 'stop'
    case 'max_tokens': return 'max_tokens'
    case 'tool_use': return 'tool_use'
    default: return 'stop'
  }
}

// Minimal type placeholders — we don't own these types
type AnthropicClient = unknown
type AnthropicResponse = {
  content: unknown
  model: unknown
  usage: unknown
  stop_reason: unknown
}
