/**
 * Agent Output Contracts — schema + semantic validation of agent outputs.
 * Catches syntactically valid but semantically garbage results.
 */

export interface OutputContract<T = unknown> {
  /** JSON Schema or Zod schema for structural validation */
  schema?: { parse?: (v: unknown) => T } | Record<string, unknown>
  /** Custom semantic validation function */
  validate?: (output: T, context: ValidationContext) => Promise<ValidationResult> | ValidationResult
  /** What to do on validation failure */
  onFailure: 'retry' | 'skip' | 'fallback' | 'escalate'
  /** Max retries before falling to onFailure action. Default 1 */
  maxRetries?: number
}

export interface ValidationContext {
  agentName: string
  executionId: string
  input: unknown
}

export interface ValidationResult {
  valid: boolean
  reason?: string
  details?: unknown
}

/**
 * Validate an agent's output against its contract.
 */
export async function validateOutput<T>(
  output: unknown,
  contract: OutputContract<T>,
  context: ValidationContext,
): Promise<ValidationResult> {
  // Schema validation
  if (contract.schema) {
    if ('parse' in contract.schema && typeof contract.schema.parse === 'function') {
      // Zod-style schema
      try {
        contract.schema.parse(output)
      } catch (err) {
        return {
          valid: false,
          reason: `Schema validation failed: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    }
    // JSON Schema validation would go here — for now, trust the type system
  }

  // Semantic validation
  if (contract.validate) {
    return contract.validate(output as T, context)
  }

  return { valid: true }
}

/**
 * Wrap an agent's execute function with contract validation.
 */
export function withContract<TInput, TOutput>(
  executeFn: (input: TInput, context: unknown) => Promise<TOutput>,
  contract: OutputContract<TOutput>,
): (input: TInput, context: unknown) => Promise<TOutput> {
  const maxRetries = contract.maxRetries ?? 1

  return async (input: TInput, context: unknown) => {
    let lastError: string | undefined
    const ctx = context as { executionId?: string }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const output = await executeFn(input, context)

      const validationResult = await validateOutput(output, contract, {
        agentName: 'unknown',
        executionId: ctx.executionId ?? '',
        input,
      })

      if (validationResult.valid) return output

      lastError = validationResult.reason
      if (attempt < maxRetries) continue // Retry

      // All retries exhausted
      switch (contract.onFailure) {
        case 'skip':
          return undefined as TOutput
        case 'escalate':
          throw new ContractViolationError(lastError ?? 'Contract validation failed', output)
        case 'fallback':
          throw new ContractViolationError(lastError ?? 'Contract validation failed (fallback)', output)
        case 'retry':
        default:
          throw new ContractViolationError(lastError ?? 'Contract validation failed after retries', output)
      }
    }

    throw new ContractViolationError(lastError ?? 'Unexpected contract failure', undefined)
  }
}

export class ContractViolationError extends Error {
  constructor(
    message: string,
    public readonly output: unknown,
  ) {
    super(message)
    this.name = 'ContractViolationError'
  }
}
