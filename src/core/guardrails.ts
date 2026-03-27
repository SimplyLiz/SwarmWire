/**
 * Guardrails — input/output/tool safety checks with fail-fast tripwires.
 *
 * Inspired by OpenAI Agents SDK:
 * - Input guardrails run before agent execution (or in parallel)
 * - Output guardrails run after agent execution
 * - Tool guardrails run before/after every tool invocation
 * - Tripwire: if a guardrail fails, execution is cancelled immediately
 */

export interface Guardrail<T = unknown> {
  name: string
  /** Run in parallel with agent execution (lower latency) or blocking (safer). Default: parallel */
  mode?: 'parallel' | 'blocking'
  /** The check function. Throw GuardrailTripped to fail fast. Return result for soft failures. */
  check(value: T, context: GuardrailContext): Promise<GuardrailResult>
}

export interface GuardrailContext {
  agentName: string
  executionId: string
  stepId?: string
  /** Which phase: before agent, after agent, before tool, after tool */
  phase: 'input' | 'output' | 'tool-input' | 'tool-output'
  toolName?: string
}

export interface GuardrailResult {
  passed: boolean
  reason?: string
  /** Severity: warn = log and continue, block = stop execution */
  severity?: 'warn' | 'block'
  /** Modified value (for sanitization guardrails) */
  sanitized?: unknown
}

export interface GuardrailConfig {
  /** Guardrails that run on agent input (before or parallel to execution) */
  input?: Guardrail[]
  /** Guardrails that run on agent output (after execution) */
  output?: Guardrail[]
  /** Guardrails that run on every tool call (before tool executes) */
  toolInput?: Guardrail[]
  /** Guardrails that run on every tool result (after tool executes) */
  toolOutput?: Guardrail[]
}

/**
 * Run a set of guardrails against a value.
 * Returns all results. Throws GuardrailTripped on first block-severity failure.
 */
export async function runGuardrails<T>(
  guardrails: Guardrail<T>[],
  value: T,
  context: GuardrailContext,
): Promise<GuardrailRunResult> {
  const results: Array<{ name: string; result: GuardrailResult }> = []
  let sanitizedValue = value

  // Separate blocking and parallel guardrails
  const blocking = guardrails.filter((g) => g.mode === 'blocking')
  const parallel = guardrails.filter((g) => g.mode !== 'blocking')

  // Run blocking guardrails first (sequential)
  for (const guard of blocking) {
    const result = await guard.check(sanitizedValue, context)
    results.push({ name: guard.name, result })

    if (!result.passed && result.severity === 'block') {
      throw new GuardrailTripped(guard.name, result.reason ?? 'Guardrail check failed', context)
    }

    if (result.sanitized !== undefined) {
      sanitizedValue = result.sanitized as T
    }
  }

  // Run parallel guardrails concurrently
  if (parallel.length > 0) {
    const parallelResults = await Promise.all(
      parallel.map(async (guard) => {
        try {
          const result = await guard.check(sanitizedValue, context)
          return { name: guard.name, result }
        } catch (err) {
          if (err instanceof GuardrailTripped) throw err
          return { name: guard.name, result: { passed: false, reason: err instanceof Error ? err.message : String(err), severity: 'block' as const } }
        }
      })
    )

    for (const pr of parallelResults) {
      results.push(pr)
      if (!pr.result.passed && pr.result.severity === 'block') {
        throw new GuardrailTripped(pr.name, pr.result.reason ?? 'Guardrail check failed', context)
      }
      if (pr.result.sanitized !== undefined) {
        sanitizedValue = pr.result.sanitized as T
      }
    }
  }

  return {
    passed: results.every((r) => r.result.passed),
    results,
    sanitizedValue,
    warnings: results.filter((r) => !r.result.passed && r.result.severity === 'warn'),
  }
}

export interface GuardrailRunResult {
  passed: boolean
  results: Array<{ name: string; result: GuardrailResult }>
  sanitizedValue: unknown
  warnings: Array<{ name: string; result: GuardrailResult }>
}

export class GuardrailTripped extends Error {
  constructor(
    public readonly guardrailName: string,
    reason: string,
    public readonly context: GuardrailContext,
  ) {
    super(`Guardrail "${guardrailName}" tripped: ${reason} [phase=${context.phase}, agent=${context.agentName}]`)
    this.name = 'GuardrailTripped'
  }
}

// ─── Built-in Guardrails ───

/** Block prompts that contain PII patterns (emails, SSNs, credit cards) */
export function piiGuardrail(): Guardrail<string> {
  return {
    name: 'pii-detector',
    mode: 'blocking',
    async check(value) {
      const patterns = [
        { name: 'email', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/ },
        { name: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/ },
        { name: 'credit_card', regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/ },
        { name: 'phone', regex: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/ },
      ]

      const found = patterns.filter((p) => p.regex.test(value))
      if (found.length > 0) {
        return { passed: false, severity: 'block', reason: `PII detected: ${found.map((f) => f.name).join(', ')}` }
      }
      return { passed: true }
    },
  }
}

/** Block prompt injection attempts */
export function injectionGuardrail(): Guardrail<string> {
  return {
    name: 'injection-detector',
    mode: 'parallel',
    async check(value) {
      const injectionPatterns = [
        /ignore\s+(all\s+)?previous\s+instructions/i,
        /you\s+are\s+now\s+(?:a\s+)?(?:different|new)/i,
        /\bsystem\s*:\s*/i,
        /\bforgot?\s+(?:all|your)\s+(?:instructions|rules)/i,
        /do\s+not\s+follow\s+(?:any|your)\s+(?:rules|instructions)/i,
      ]

      for (const pattern of injectionPatterns) {
        if (pattern.test(value)) {
          return { passed: false, severity: 'block', reason: 'Potential prompt injection detected' }
        }
      }
      return { passed: true }
    },
  }
}

/** Warn on responses that contain common hallucination markers */
export function hallucinationGuardrail(): Guardrail<string> {
  return {
    name: 'hallucination-detector',
    mode: 'parallel',
    async check(value) {
      const markers = [
        /as of my (?:last )?(?:knowledge )?(?:cutoff|training)/i,
        /I (?:don't|do not) have (?:access|information) (?:about|on) (?:real-time|current)/i,
        /(?:hypothetically|in theory|it's possible that)/i,
      ]

      const hits = markers.filter((m) => m.test(value))
      if (hits.length >= 2) {
        return { passed: false, severity: 'warn', reason: 'Response contains hallucination markers' }
      }
      return { passed: true }
    },
  }
}

/** Enforce maximum output length */
export function maxLengthGuardrail(maxChars: number): Guardrail<string> {
  return {
    name: 'max-length',
    mode: 'parallel',
    async check(value) {
      if (value.length > maxChars) {
        return {
          passed: false,
          severity: 'warn',
          reason: `Output exceeds ${maxChars} chars (got ${value.length})`,
          sanitized: value.slice(0, maxChars),
        }
      }
      return { passed: true }
    },
  }
}

/** Block responses that contain specific forbidden strings */
export function contentFilter(forbidden: string[], severity: 'warn' | 'block' = 'block'): Guardrail<string> {
  return {
    name: 'content-filter',
    mode: 'parallel',
    async check(value) {
      const lower = value.toLowerCase()
      const found = forbidden.filter((f) => lower.includes(f.toLowerCase()))
      if (found.length > 0) {
        return { passed: false, severity, reason: `Forbidden content: ${found.join(', ')}` }
      }
      return { passed: true }
    },
  }
}
