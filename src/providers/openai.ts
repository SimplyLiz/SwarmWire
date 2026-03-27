/**
 * OpenAI provider adapter.
 * Peer dependency — only loaded if openai is installed.
 */

import type {
  Provider,
  ProviderConfig,
  ProviderModelInfo,
  LlmRequest,
  LlmResponse,
  ModelTier,
} from '../types/provider.js'

const OPENAI_MODELS: ProviderModelInfo[] = [
  {
    model: 'gpt-4o-mini',
    tier: 'cheap' as ModelTier,
    inputCostPer1kTokens: 0.15,
    outputCostPer1kTokens: 0.60,
    cachedInputCostPer1kTokens: 0.075,
    contextWindow: 128_000,
  },
  {
    model: 'gpt-4o',
    tier: 'standard' as ModelTier,
    inputCostPer1kTokens: 2.50,
    outputCostPer1kTokens: 10.00,
    cachedInputCostPer1kTokens: 1.25,
    contextWindow: 128_000,
  },
  {
    model: 'o3',
    tier: 'reasoning' as ModelTier,
    inputCostPer1kTokens: 10.00,
    outputCostPer1kTokens: 40.00,
    cachedInputCostPer1kTokens: 5.00,
    contextWindow: 200_000,
  },
]

export function createOpenAIProvider(config: ProviderConfig): Provider {
  let clientPromise: Promise<OpenAIClient> | null = null

  function getClient(): Promise<OpenAIClient> {
    if (!clientPromise) {
      clientPromise = (async () => {
        try {
          const mod = await import('openai')
          const OpenAI = mod.default ?? mod.OpenAI
          return new OpenAI({
            apiKey: config.apiKey,
            ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
          }) as OpenAIClient
        } catch {
          throw new Error(
            'swarmwire: openai is required for the OpenAI provider. Install it: npm install openai'
          )
        }
      })()
    }
    return clientPromise
  }

  const models = config.models ?? OPENAI_MODELS

  const provider: Provider = {
    name: config.name || 'openai',
    models,

    async chat(request: LlmRequest): Promise<LlmResponse> {
      const client = await getClient()
      const start = performance.now()

      const messages: Array<{ role: string; content: string }> = []
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt })
      }
      for (const m of request.messages) {
        messages.push({ role: m.role, content: m.content })
      }

      const params: Record<string, unknown> = {
        model: request.model,
        messages,
        max_tokens: request.maxTokens ?? 4096,
      }
      if (request.temperature !== undefined) params.temperature = request.temperature
      if (request.responseFormat) {
        params.response_format = {
          type: 'json_schema',
          json_schema: {
            name: request.responseFormat.name ?? 'response',
            schema: request.responseFormat.schema,
            strict: true,
          },
        }
      }

      // Use parse() for structured output (returns message.parsed), fall back to create()
      const chatClient = client as { chat: { completions: { parse?: (p: unknown) => Promise<OpenAIResponse>; create: (p: unknown) => Promise<OpenAIResponse> } } }
      const response = request.responseFormat && chatClient.chat.completions.parse
        ? await chatClient.chat.completions.parse(params)
        : await chatClient.chat.completions.create(params)
      const durationMs = performance.now() - start

      const choice = (response.choices as Array<{ message: { content: string; parsed?: unknown }; finish_reason: string }>)[0]
      const usage = response.usage as { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } }

      // Parse structured output
      let parsed: unknown
      const content = choice?.message?.content ?? ''
      if (request.responseFormat) {
        // parse() adds message.parsed; create() does not
        parsed = choice?.message?.parsed
        if (parsed === undefined && content) {
          try { parsed = JSON.parse(content) } catch { /* leave undefined */ }
        }
      }

      return {
        content,
        parsed,
        model: response.model as string,
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
        finishReason: mapFinishReason(choice?.finish_reason ?? 'stop'),
        durationMs,
      }
    },

    estimateCost(model: string, inputTokens: number, outputTokens: number): number {
      const info = models.find((m) => m.model === model) ?? models.find((m) => model.startsWith(m.model))
      if (!info) return 0
      return (inputTokens / 1000) * info.inputCostPer1kTokens + (outputTokens / 1000) * info.outputCostPer1kTokens
    },
  }

  return provider
}

function mapFinishReason(reason: string): LlmResponse['finishReason'] {
  switch (reason) {
    case 'stop': return 'stop'
    case 'length': return 'max_tokens'
    case 'tool_calls': return 'tool_use'
    default: return 'stop'
  }
}

type OpenAIClient = unknown
type OpenAIResponse = { choices: unknown; model: unknown; usage: unknown }
