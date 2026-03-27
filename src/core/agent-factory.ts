/**
 * Agent factory — creates Agent instances from definitions.
 */

import type { Agent, AgentDefinition, AgentContext } from '../types/agent.js'

let agentCounter = 0

export function createAgent<TInput = unknown, TOutput = unknown>(
  def: AgentDefinition<TInput, TOutput>,
): Agent<TInput, TOutput> {
  const id = `agent_${++agentCounter}_${def.name}`

  const executeFn = (def.execute ?? defaultExecute) as (input: TInput, context: AgentContext) => Promise<TOutput>

  return {
    id,
    name: def.name,
    role: def.role,
    capabilities: def.capabilities ?? [],
    tools: def.tools ?? [],
    model: def.model,
    modelTier: def.modelTier ?? 'standard',
    systemPrompt: def.systemPrompt,
    maxTokens: def.maxTokens,
    maxCostCents: def.maxCostCents,
    timeoutMs: def.timeoutMs,
    guardrails: def.guardrails,
    execute: executeFn,
  }
}

/**
 * Default execute — sends input as a prompt to the LLM via context.
 */
async function defaultExecute(input: unknown, context: AgentContext): Promise<unknown> {
  const prompt = typeof input === 'string' ? input : JSON.stringify(input, null, 2)
  return context.llm(prompt)
}
