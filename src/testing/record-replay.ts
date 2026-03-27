/**
 * Record/Replay — deterministic testing for multi-agent systems.
 *
 * RecordingProvider: wraps a real provider, saves all LLM interactions to disk.
 * ReplayProvider: reads fixtures, no LLM calls, deterministic, instant, free.
 *
 * Nobody has solved this well in TypeScript. This is category-defining.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Provider, ProviderModelInfo, LlmRequest, LlmResponse } from '../types/provider.js'

// ─── Fixture Format ───

export interface Fixture {
  version: '1.0'
  provider: string
  recordedAt: string
  interactions: FixtureInteraction[]
}

export interface FixtureInteraction {
  index: number
  request: FixtureRequest
  response: FixtureResponse
  durationMs: number
  costCents: number
}

/** Cleaned request — strips volatile fields for fuzzy matching */
export interface FixtureRequest {
  model: string
  systemPrompt?: string
  messages: Array<{ role: string; content: string }>
  maxTokens?: number
  temperature?: number
  responseFormat?: unknown
  /** Content fingerprint for fuzzy matching */
  fingerprint: string
}

export interface FixtureResponse {
  content: string
  parsed?: unknown
  model: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  finishReason: string
}

// ─── Recording Provider ───

export class RecordingProvider implements Provider {
  readonly name: string
  readonly models: ProviderModelInfo[]
  private interactions: FixtureInteraction[] = []
  private index = 0

  constructor(
    private readonly wrapped: Provider,
    private readonly fixturePath: string,
  ) {
    this.name = wrapped.name
    this.models = wrapped.models
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    const start = performance.now()
    const response = await this.wrapped.chat(request)
    const durationMs = performance.now() - start
    const costCents = this.wrapped.estimateCost(request.model, response.inputTokens, response.outputTokens)

    this.interactions.push({
      index: this.index++,
      request: toFixtureRequest(request),
      response: toFixtureResponse(response),
      durationMs,
      costCents,
    })

    return response
  }

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    return this.wrapped.estimateCost(model, inputTokens, outputTokens)
  }

  /** Save recorded interactions to disk. Call this after execution completes. */
  async save(): Promise<void> {
    const fixture: Fixture = {
      version: '1.0',
      provider: this.name,
      recordedAt: new Date().toISOString(),
      interactions: this.interactions,
    }

    await mkdir(dirname(this.fixturePath), { recursive: true })
    await writeFile(this.fixturePath, JSON.stringify(fixture, null, 2), 'utf-8')
  }

  /** Get interaction count (for assertions). */
  get count(): number {
    return this.interactions.length
  }
}

// ─── Replay Provider ───

export interface ReplayOptions {
  /** If true, throw on unmatched requests. If false, return a stub response. Default true. */
  strict?: boolean
  /** Fallback provider for requests not in the fixture (partial replay). */
  fallback?: Provider
  /** Simulated latency per response (ms). Default 0 (instant). */
  simulatedLatencyMs?: number
}

export class ReplayProvider implements Provider {
  readonly name: string
  readonly models: ProviderModelInfo[]
  private fixture: Fixture | null = null
  private matchedIndices = new Set<number>()
  private options: Required<Omit<ReplayOptions, 'fallback'>> & { fallback?: Provider }

  constructor(
    private readonly fixturePath: string | Fixture,
    options: ReplayOptions & { name?: string } = {},
  ) {
    // If fixture is an object, set name immediately; if file path, set on load()
    if (typeof fixturePath !== 'string' && fixturePath.provider) {
      this.name = options.name ?? fixturePath.provider
    } else {
      this.name = options.name ?? 'replay'
    }
    this.models = []
    this.options = {
      strict: options.strict ?? true,
      fallback: options.fallback,
      simulatedLatencyMs: options.simulatedLatencyMs ?? 0,
    }
  }

  /** Load the fixture. Called automatically on first chat() if not called manually. */
  async load(): Promise<void> {
    if (typeof this.fixturePath === 'string') {
      const content = await readFile(this.fixturePath, 'utf-8')
      this.fixture = JSON.parse(content) as Fixture
    } else {
      this.fixture = this.fixturePath
    }
    ;(this as { name: string }).name = this.fixture.provider ?? 'replay'
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    if (!this.fixture) await this.load()
    if (!this.fixture) throw new Error('ReplayProvider: no fixture loaded')

    const fingerprint = computeFingerprint(request)
    const reqModel = request.model

    // Find best matching interaction (not yet matched)
    let bestMatch: FixtureInteraction | null = null
    let bestScore = -1

    for (const interaction of this.fixture.interactions) {
      if (this.matchedIndices.has(interaction.index)) continue

      const score = matchScore(fingerprint, reqModel, interaction.request)
      if (score > bestScore) {
        bestScore = score
        bestMatch = interaction
      }
    }

    // Accept if score is above threshold
    if (bestMatch && bestScore >= 0.5) {
      this.matchedIndices.add(bestMatch.index)

      if (this.options.simulatedLatencyMs > 0) {
        await sleep(this.options.simulatedLatencyMs)
      }

      return fromFixtureResponse(bestMatch.response)
    }

    // No match — fallback or error
    if (this.options.fallback) {
      return this.options.fallback.chat(request)
    }

    if (this.options.strict) {
      throw new ReplayMismatchError(request, this.fixture.interactions.length, this.matchedIndices.size)
    }

    // Non-strict: return stub
    return {
      content: '[REPLAY STUB: no matching fixture]',
      model: reqModel,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      finishReason: 'stop',
      durationMs: 0,
    }
  }

  estimateCost(): number {
    return 0 // Replay is free
  }

  /** How many fixture interactions have been matched. */
  get matchedCount(): number {
    return this.matchedIndices.size
  }

  /** How many fixture interactions exist. */
  get totalCount(): number {
    return this.fixture?.interactions.length ?? 0
  }

  /** Unmatched interactions (useful for debugging). */
  get unmatched(): FixtureInteraction[] {
    if (!this.fixture) return []
    return this.fixture.interactions.filter((i) => !this.matchedIndices.has(i.index))
  }
}

export class ReplayMismatchError extends Error {
  constructor(
    public readonly request: LlmRequest,
    public readonly fixtureCount: number,
    public readonly matchedCount: number,
  ) {
    const preview = request.messages[0]?.content.slice(0, 80) ?? ''
    super(
      `ReplayProvider: no matching fixture for request (model=${request.model}, content="${preview}..."). ` +
      `${matchedCount}/${fixtureCount} fixtures matched so far.`
    )
    this.name = 'ReplayMismatchError'
  }
}

// ─── Matching Logic ───

/**
 * Compute a content fingerprint for fuzzy matching.
 * Strips volatile fields (timestamps, random IDs, exact whitespace).
 */
function computeFingerprint(request: LlmRequest): string {
  const parts: string[] = []
  if (request.systemPrompt) parts.push(normalize(request.systemPrompt))
  for (const msg of request.messages) parts.push(normalize(msg.content))
  return parts.join('|')
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<UUID>') // UUIDs
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\dZ+-]*\b/g, '<TIMESTAMP>') // ISO timestamps
    .replace(/\b\d{10,13}\b/g, '<EPOCH>') // Unix timestamps
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Score how well a request matches a fixture interaction.
 * 0 = no match, 1 = perfect match.
 */
function matchScore(fingerprint: string, model: string, fixtureReq: FixtureRequest): number {
  let score = 0

  // Model match (weighted heavily)
  if (model === fixtureReq.model) score += 0.3
  else score += 0.1 // Different model, might still match content

  // Content fingerprint similarity (Jaccard on words)
  const wordsA = new Set(fingerprint.split(/\s+/))
  const wordsB = new Set(fixtureReq.fingerprint.split(/\s+/))
  let intersection = 0
  for (const w of wordsA) if (wordsB.has(w)) intersection++
  const union = wordsA.size + wordsB.size - intersection
  const jaccard = union > 0 ? intersection / union : 0
  score += jaccard * 0.7

  return score
}

// ─── Helpers ───

function toFixtureRequest(request: LlmRequest): FixtureRequest {
  return {
    model: request.model,
    systemPrompt: request.systemPrompt,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    maxTokens: request.maxTokens,
    temperature: request.temperature,
    responseFormat: request.responseFormat,
    fingerprint: computeFingerprint(request),
  }
}

function toFixtureResponse(response: LlmResponse): FixtureResponse {
  return {
    content: response.content,
    parsed: response.parsed,
    model: response.model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    cachedInputTokens: response.cachedInputTokens,
    finishReason: response.finishReason,
  }
}

function fromFixtureResponse(fixture: FixtureResponse): LlmResponse {
  return {
    content: fixture.content,
    parsed: fixture.parsed,
    model: fixture.model,
    inputTokens: fixture.inputTokens,
    outputTokens: fixture.outputTokens,
    cachedInputTokens: fixture.cachedInputTokens,
    finishReason: fixture.finishReason as LlmResponse['finishReason'],
    durationMs: 0,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
