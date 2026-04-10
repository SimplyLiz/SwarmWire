/**
 * Mermaid diagram generators for SwarmWire.
 *
 * Converts ExecutionResult, ExecutionTrace, and StateMachineConfig into
 * Mermaid diagram syntax that renders in GitHub, Notion, Obsidian, VS Code,
 * and any Mermaid-compatible tool.
 */

import type { ExecutionResult, ExecutionTrace } from '../types/execution.js'
import type { Step } from '../types/plan.js'

export interface VizConfig {
  /** Chart title. Default: 'Execution' */
  title?: string
  /** Show cost per step. Default: true */
  showCost?: boolean
  /** Show duration per step. Default: true */
  showDuration?: boolean
  /** Show token counts. Default: false */
  showTokens?: boolean
}

const STATUS_FILL: Record<string, string> = {
  complete: '#22c55e',
  failed:   '#ef4444',
  running:  '#3b82f6',
  skipped:  '#6b7280',
  pending:  '#f59e0b',
}

const STATUS_STROKE: Record<string, string> = {
  complete: '#16a34a',
  failed:   '#dc2626',
  running:  '#2563eb',
  skipped:  '#4b5563',
  pending:  '#d97706',
}

const STATUS_ICON: Record<string, string> = {
  complete: '✓',
  failed:   '✗',
  running:  '…',
  skipped:  '–',
  pending:  '○',
}

function agentName(step: Step): string {
  const a = step.agent as { name?: string; id?: string }
  return a.name ?? a.id ?? 'agent'
}

/** Sanitize a string for use as a Mermaid node ID */
function nodeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_')
}

/**
 * Convert an ExecutionResult into a Mermaid flowchart.
 *
 * @example
 * ```typescript
 * const diagram = executionToMermaid(result)
 * console.log(diagram)
 * // flowchart TD
 * //   step_1["researcher ✓ · 12¢ · 1200ms"]
 * //   ...
 * ```
 */
export function executionToMermaid(result: ExecutionResult, cfg: VizConfig = {}): string {
  const { showCost = true, showDuration = true } = cfg
  const steps = result.plan.steps
  const lines: string[] = ['flowchart TD']

  // Nodes
  for (const step of steps) {
    const agent = agentName(step)
    const icon = STATUS_ICON[step.status] ?? '?'
    const parts: string[] = [`${agent} ${icon}`]
    if (showCost && step.cost) parts.push(`${step.cost.costCents.toFixed(1)}¢`)
    if (showDuration && step.cost) parts.push(`${step.cost.durationMs}ms`)
    if (step.status === 'failed' && step.error) parts.push(`ERR: ${step.error.slice(0, 30)}`)
    const label = parts.join(' · ')
    lines.push(`    ${nodeId(step.id)}["${label}"]`)
  }

  lines.push('')

  // Edges
  for (const step of steps) {
    for (const dep of step.dependencies) {
      lines.push(`    ${nodeId(dep)} --> ${nodeId(step.id)}`)
    }
  }

  lines.push('')

  // Styles
  for (const step of steps) {
    const fill = STATUS_FILL[step.status] ?? '#6b7280'
    const stroke = STATUS_STROKE[step.status] ?? '#4b5563'
    lines.push(`    style ${nodeId(step.id)} fill:${fill},stroke:${stroke},color:#fff`)
  }

  return lines.join('\n')
}

/**
 * Convert an ExecutionTrace into a Mermaid Gantt chart.
 * Shows each step's duration relative to execution start.
 */
export function traceToMermaidGantt(trace: ExecutionTrace, cfg: VizConfig = {}): string {
  const { title = 'Execution Timeline' } = cfg
  const origin = trace.startedAt
  const stepSpans = trace.spans.filter((s) => s.type === 'step' && s.durationMs > 0)

  const lines = [
    'gantt',
    `    title ${title}`,
    '    dateFormat x',
    '    axisFormat %Lms',
  ]

  for (const span of stepSpans) {
    const name = span.name.replace(/[:#]/g, ' ')
    const start = span.startedAt - origin
    const dur = Math.max(1, span.durationMs)
    const status = span.status === 'ok' ? 'done' : 'crit'
    lines.push(`    section ${name}`)
    lines.push(`    ${name} :${status}, ${start}, ${dur}`)
  }

  return lines.join('\n')
}

/**
 * Convert StateMachineConfig edges into a Mermaid flowchart.
 * Separate from `StateMachine.toMermaid()` for cases where you have
 * the config but not an instantiated machine.
 */
export function stateMachineConfigToMermaid(
  edges: Array<{ from: string; to: string | ((...args: unknown[]) => unknown); label?: string }>,
  entryNode?: string,
): string {
  const END = '__end__'
  const lines = ['flowchart TD']
  const nodes = new Set<string>()

  for (const edge of edges) {
    const from = edge.from
    const isConditional = typeof edge.to === 'function'
    const to = isConditional ? '((conditional))' : (edge.to as string)
    const label = edge.label ?? (isConditional ? 'conditional' : '')
    const arrow = label ? ` -->|${label}|` : ' -->'
    lines.push(`    ${from}${arrow} ${to}`)
    nodes.add(from)
    if (!isConditional) nodes.add(to)
  }

  lines.push('')

  // Style END node
  if ([...nodes].includes(END)) {
    lines.push(`    style ${END} fill:#374151,stroke:#1f2937,color:#fff`)
  }

  // Style entry node
  if (entryNode) {
    lines.push(`    style ${entryNode} fill:#1d4ed8,stroke:#1e40af,color:#fff`)
  }

  return lines.join('\n')
}
