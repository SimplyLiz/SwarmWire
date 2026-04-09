/**
 * SkillReducer — compress tool/skill definitions using progressive disclosure.
 *
 * Agents receive compact summaries first; full definitions are revealed only
 * when routing determines they're needed. Achieves ~48% prompt compression
 * with no quality loss (less context noise = better decisions).
 *
 * Reference: https://arxiv.org/abs/2603.29919
 */

import type { Tool } from '../types/tool.js'

export interface SkillSummary {
  name: string
  /** One-line description (≤60 chars) */
  summary: string
  /** Full tool for when the agent needs the detail */
  full: Tool
}

export interface SkillReducerConfig {
  /** Max summary length in chars. Default 60 */
  maxSummaryLength?: number
  /** If provided, generate summaries with this LLM instead of truncating */
  summarizeFn?: (tool: Tool) => Promise<string>
}

export interface ReducedSkillSet {
  /** Compact summaries for initial prompt injection */
  compact: SkillSummary[]
  /** Resolve a tool name to its full definition */
  resolve(name: string): Tool | undefined
  /** Get the compact listing as a prompt string */
  toPromptString(): string
  /** Expand specific tools to full definitions */
  expand(names: string[]): Tool[]
}

/**
 * Build a reduced skill set from a list of tools.
 */
export function createReducedSkillSet(
  tools: Tool[],
  config: SkillReducerConfig = {},
): ReducedSkillSet {
  const maxLen = config.maxSummaryLength ?? 60
  const summaries: SkillSummary[] = tools.map((tool) => ({
    name: tool.name,
    summary: truncateSummary(tool.description, maxLen),
    full: tool,
  }))

  const byName = new Map(tools.map((t) => [t.name, t]))

  return {
    compact: summaries,
    resolve: (name) => byName.get(name),
    toPromptString: () =>
      summaries.map((s) => `- ${s.name}: ${s.summary}`).join('\n'),
    expand: (names) =>
      names.map((n) => byName.get(n)).filter((t): t is Tool => t !== undefined),
  }
}

/**
 * Async version: uses a summarizeFn to generate LLM-quality summaries.
 */
export async function createReducedSkillSetAsync(
  tools: Tool[],
  config: SkillReducerConfig,
): Promise<ReducedSkillSet> {
  const maxLen = config.maxSummaryLength ?? 60
  const summaries: SkillSummary[] = await Promise.all(
    tools.map(async (tool) => ({
      name: tool.name,
      summary: config.summarizeFn
        ? await config.summarizeFn(tool)
        : truncateSummary(tool.description, maxLen),
      full: tool,
    })),
  )

  const byName = new Map(tools.map((t) => [t.name, t]))

  return {
    compact: summaries,
    resolve: (name) => byName.get(name),
    toPromptString: () =>
      summaries.map((s) => `- ${s.name}: ${s.summary}`).join('\n'),
    expand: (names) =>
      names.map((n) => byName.get(n)).filter((t): t is Tool => t !== undefined),
  }
}

/**
 * Progressive disclosure router: given a task description, return the minimal
 * set of tools the agent likely needs (keyword-based first pass).
 */
export function selectRelevantTools(task: string, skillSet: ReducedSkillSet): Tool[] {
  const lower = task.toLowerCase()
  const relevant = skillSet.compact.filter((s) => {
    const words = s.name.toLowerCase().split(/[_\-\s]+/).concat(s.summary.toLowerCase().split(/\s+/))
    return words.some((w) => w.length > 3 && lower.includes(w))
  })

  return relevant.length > 0
    ? skillSet.expand(relevant.map((r) => r.name))
    : skillSet.expand(skillSet.compact.slice(0, 3).map((s) => s.name))
}

function truncateSummary(description: string, maxLen: number): string {
  const firstSentence = description.split(/[.!?]/)[0]?.trim() ?? description
  if (firstSentence.length <= maxLen) return firstSentence
  return firstSentence.slice(0, maxLen - 1) + '…'
}
