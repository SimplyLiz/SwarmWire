/**
 * Tool — a function an agent can call.
 */

export interface Tool<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute(input: TInput): Promise<TOutput>
}
