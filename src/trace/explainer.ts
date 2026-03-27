/**
 * Plan Explainer — human-readable execution traces for debugging.
 */

import type { ExecutionResult } from '../types/execution.js'
import type { Plan } from '../types/plan.js'

/**
 * Generate a human-readable explanation of a plan execution.
 */
export function explainExecution(result: ExecutionResult): string {
  const lines: string[] = []
  const { plan, cost, trace, conflicts, partial } = result

  // Header
  lines.push(`# Execution Report: ${plan.id}`)
  lines.push(`Status: ${partial ? 'PARTIAL' : 'COMPLETE'} | Mode: ${plan.mode}`)
  lines.push(`Duration: ${formatMs(cost.totalLatencyMs)} | Cost: ${cost.totalCostCents.toFixed(2)}¢ | Tokens: ${formatNum(cost.totalTokens)}`)
  lines.push('')

  // Step timeline
  lines.push('## Steps')
  lines.push('')
  for (const step of plan.steps) {
    const agent = 'name' in step.agent ? step.agent.name : (step.agent as { name: string }).name
    const status = stepStatusIcon(step.status)
    const costStr = step.cost ? ` | ${step.cost.costCents.toFixed(2)}¢` : ''
    const deps = step.dependencies.length > 0 ? ` (after: ${step.dependencies.join(', ')})` : ''
    const error = step.error ? ` | ERROR: ${step.error}` : ''

    lines.push(`  ${status} ${step.id}: ${agent}${deps}${costStr}${error}`)
  }
  lines.push('')

  // Cost breakdown
  lines.push('## Cost Breakdown')
  lines.push('')
  lines.push('### Per Agent')
  for (const [name, agentCost] of cost.perAgent) {
    lines.push(`  ${name}: ${agentCost.costCents.toFixed(2)}¢ (${formatNum(agentCost.tokens)} tokens, ${agentCost.calls} calls)`)
  }
  lines.push('')
  lines.push('### Per Provider')
  for (const [name, provCost] of cost.perProvider) {
    const cache = provCost.cacheHits > 0 ? ` (${provCost.cacheHits} cache hits)` : ''
    lines.push(`  ${name}: ${provCost.costCents.toFixed(2)}¢ (${formatNum(provCost.tokens)} tokens)${cache}`)
  }
  lines.push('')

  // Budget usage
  lines.push(`Budget used: ${(cost.budgetUsed * 100).toFixed(0)}%`)
  if (cost.savings.promptCachingCents > 0 || cost.savings.tierRoutingCents > 0) {
    lines.push('### Savings')
    if (cost.savings.promptCachingCents > 0) lines.push(`  Prompt caching: ${cost.savings.promptCachingCents.toFixed(2)}¢`)
    if (cost.savings.tierRoutingCents > 0) lines.push(`  Tier routing: ${cost.savings.tierRoutingCents.toFixed(2)}¢`)
    if (cost.savings.earlyStopCents > 0) lines.push(`  Early stop: ${cost.savings.earlyStopCents.toFixed(2)}¢`)
  }
  lines.push('')

  // Conflicts
  if (conflicts && conflicts.length > 0) {
    lines.push('## Conflicts')
    for (const c of conflicts) {
      const resolved = c.resolution ? ` → resolved via ${c.resolution.method}` : ' → UNRESOLVED'
      lines.push(`  ${c.type}: ${c.description}${resolved}`)
    }
    lines.push('')
  }

  // Trace spans (compact)
  if (trace.spans.length > 0) {
    lines.push('## Trace')
    const sorted = [...trace.spans].sort((a, b) => a.startedAt - b.startedAt)
    for (const span of sorted) {
      const indent = span.parentId ? '    ' : '  '
      const costStr = span.costCents ? ` ${span.costCents.toFixed(2)}¢` : ''
      const tokenStr = span.tokens ? ` ${formatNum(span.tokens)}tok` : ''
      const statusIcon = span.status === 'ok' ? '✓' : '✗'
      lines.push(`${indent}${statusIcon} ${span.name} (${formatMs(span.durationMs)}${costStr}${tokenStr})`)
    }
  }

  return lines.join('\n')
}

/**
 * Generate a compact one-line summary.
 */
export function summarizeExecution(result: ExecutionResult): string {
  const { cost, plan, partial } = result
  const status = partial ? 'PARTIAL' : 'OK'
  const steps = plan.steps.length
  const completed = plan.steps.filter((s) => s.status === 'complete').length
  return `[${status}] ${completed}/${steps} steps | ${formatMs(cost.totalLatencyMs)} | ${cost.totalCostCents.toFixed(2)}¢ | ${formatNum(cost.totalTokens)} tokens`
}

/**
 * Generate a DAG visualization (ASCII).
 */
export function visualizePlan(plan: Plan): string {
  const lines: string[] = ['## Plan DAG', '']

  // Group by dependency depth
  const depths = new Map<string, number>()
  for (const step of plan.steps) {
    const depth = step.dependencies.length === 0
      ? 0
      : Math.max(...step.dependencies.map((d) => (depths.get(d) ?? 0) + 1))
    depths.set(step.id, depth)
  }

  const maxDepth = Math.max(0, ...depths.values())
  for (let d = 0; d <= maxDepth; d++) {
    const atDepth = plan.steps.filter((s) => depths.get(s.id) === d)
    const names = atDepth.map((s) => {
      const agent = 'name' in s.agent ? s.agent.name : '?'
      return `[${agent}]`
    })
    const prefix = d === 0 ? '' : '  '.repeat(d) + '↓ '
    lines.push(`${prefix}${names.join('  ')}`)
  }

  return lines.join('\n')
}

function stepStatusIcon(status: string): string {
  switch (status) {
    case 'complete': return '✓'
    case 'failed': return '✗'
    case 'skipped': return '⊘'
    case 'running': return '⟳'
    default: return '○'
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function formatNum(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}
