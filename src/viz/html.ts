/**
 * Self-contained HTML dashboard exporter.
 *
 * Generates a standalone HTML file with an embedded Mermaid diagram,
 * cost breakdown, and step table. No server required — open directly
 * in any browser.
 *
 * Uses Mermaid.js from CDN (cdn.jsdelivr.net). Requires internet access
 * to render. For offline use, bundle Mermaid separately.
 */

import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exec } from 'node:child_process'
import type { ExecutionResult } from '../types/execution.js'
import type { Step } from '../types/plan.js'
import { executionToMermaid, type VizConfig } from './mermaid.js'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function agentName(step: Step): string {
  const a = step.agent as { name?: string; id?: string }
  return a.name ?? a.id ?? 'agent'
}

function statusBadge(status: string): string {
  const classes: Record<string, string> = {
    complete: 'badge-complete',
    failed:   'badge-failed',
    skipped:  'badge-skipped',
    running:  'badge-running',
    pending:  'badge-pending',
  }
  return `<span class="badge ${classes[status] ?? ''}">${esc(status)}</span>`
}

function fmtCost(cents: number): string {
  if (cents < 1) return `${(cents * 100).toFixed(1)}mc`
  return `${cents.toFixed(2)}¢`
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function stepRows(steps: Step[]): string {
  return steps.map((step) => {
    const agent = esc(agentName(step))
    const cost = step.cost ? fmtCost(step.cost.costCents) : '—'
    const dur = step.cost ? fmtDuration(step.cost.durationMs) : '—'
    const err = step.error ? `<br><small style="color:#fca5a5">${esc(step.error.slice(0, 80))}</small>` : ''
    return `
      <tr>
        <td>${agent}${err}</td>
        <td>${statusBadge(step.status)}</td>
        <td class="num">${cost}</td>
        <td class="num">${dur}</td>
      </tr>`
  }).join('')
}

function agentCostRows(result: ExecutionResult): string {
  const perAgent = result.cost.perAgent
  if (!perAgent || perAgent.size === 0) return '<tr><td colspan="3">No per-agent data</td></tr>'
  return [...perAgent.entries()]
    .sort((a, b) => b[1].costCents - a[1].costCents)
    .map(([name, summary]) => `
      <tr>
        <td>${esc(name)}</td>
        <td class="num">${fmtCost(summary.costCents)}</td>
        <td class="num">${summary.calls}</td>
      </tr>`).join('')
}

/**
 * Generate a self-contained HTML dashboard for an ExecutionResult.
 *
 * @example
 * ```typescript
 * const html = toHTML(result, { title: 'Research Pipeline' })
 * await fs.writeFile('report.html', html)
 * ```
 */
export function toHTML(result: ExecutionResult, cfg: VizConfig = {}): string {
  const title = cfg.title ?? `SwarmWire · ${result.plan.task.input?.toString().slice(0, 60) ?? 'Execution Report'}`
  const diagram = executionToMermaid(result, cfg)
  const totalCost = fmtCost(result.cost.totalCostCents)
  const totalTokens = result.cost.totalTokens.toLocaleString()
  const totalDur = fmtDuration(result.cost.totalLatencyMs)
  const stepCount = result.plan.steps.length
  const completedCount = result.plan.steps.filter((s) => s.status === 'complete').length
  const overallStatus = result.plan.status

  const statusColor: Record<string, string> = {
    complete: '#22c55e',
    failed:   '#ef4444',
    running:  '#3b82f6',
    draft:    '#f59e0b',
    approved: '#8b5cf6',
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 28px;
      min-height: 100vh;
    }
    header { margin-bottom: 20px; }
    h1 { font-size: 1.25rem; font-weight: 600; color: #f8fafc; margin-bottom: 4px; }
    .subtitle { font-size: 0.8rem; color: #64748b; }
    .cards {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 14px 20px;
      min-width: 120px;
    }
    .card-label { font-size: 0.7rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.07em; }
    .card-value { font-size: 1.4rem; font-weight: 700; color: #f8fafc; margin-top: 4px; line-height: 1.2; }
    .card-value.status { color: ${statusColor[overallStatus] ?? '#e2e8f0'}; }
    .layout {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 20px;
    }
    @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
    .panel {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 20px;
    }
    .panel h2 {
      font-size: 0.7rem;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      margin-bottom: 16px;
    }
    .mermaid-wrap {
      background: #fff;
      border-radius: 6px;
      padding: 12px;
      overflow: auto;
    }
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    th {
      text-align: left;
      color: #64748b;
      padding: 6px 8px;
      border-bottom: 1px solid #334155;
      font-weight: 500;
      font-size: 0.7rem;
      text-transform: uppercase;
    }
    td { padding: 8px; border-bottom: 1px solid #1e293b; color: #cbd5e1; vertical-align: middle; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; font-family: monospace; font-size: 0.8rem; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .badge-complete { background: #14532d; color: #86efac; }
    .badge-failed   { background: #450a0a; color: #fca5a5; }
    .badge-skipped  { background: #1e293b; color: #64748b; border: 1px solid #334155; }
    .badge-running  { background: #1e3a5f; color: #93c5fd; }
    .badge-pending  { background: #422006; color: #fcd34d; }
    small { font-size: 0.72rem; }
  </style>
</head>
<body>
  <header>
    <h1>${esc(title)}</h1>
    <div class="subtitle">Generated by SwarmWire · Plan ID: ${esc(result.plan.id)}</div>
  </header>

  <div class="cards">
    <div class="card">
      <div class="card-label">Status</div>
      <div class="card-value status">${esc(overallStatus)}</div>
    </div>
    <div class="card">
      <div class="card-label">Total Cost</div>
      <div class="card-value">${esc(totalCost)}</div>
    </div>
    <div class="card">
      <div class="card-label">Tokens</div>
      <div class="card-value">${esc(totalTokens)}</div>
    </div>
    <div class="card">
      <div class="card-label">Duration</div>
      <div class="card-value">${esc(totalDur)}</div>
    </div>
    <div class="card">
      <div class="card-label">Steps</div>
      <div class="card-value">${completedCount}/${stepCount}</div>
    </div>
  </div>

  <div class="layout">
    <div class="panel">
      <h2>Execution DAG</h2>
      <div class="mermaid-wrap">
        <pre class="mermaid">${esc(diagram)}</pre>
      </div>
    </div>

    <div class="panel">
      <h2>Steps</h2>
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Status</th>
            <th>Cost</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          ${stepRows(result.plan.steps)}
        </tbody>
      </table>
    </div>
  </div>

  <div class="panel">
    <h2>Cost by Agent</h2>
    <table>
      <thead>
        <tr><th>Agent</th><th>Cost</th><th>LLM Calls</th></tr>
      </thead>
      <tbody>
        ${agentCostRows(result)}
      </tbody>
    </table>
  </div>

  <script>
    mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'loose' });
  </script>
</body>
</html>`
}

/**
 * Write a self-contained HTML report to a file.
 *
 * @example
 * ```typescript
 * await exportHTML(result, './reports/run-2026-04-10.html')
 * ```
 */
export async function exportHTML(
  result: ExecutionResult,
  filePath: string,
  cfg?: VizConfig,
): Promise<void> {
  await writeFile(filePath, toHTML(result, cfg), 'utf-8')
}

/**
 * Export to a temp file and open in the default browser.
 * macOS, Linux (xdg-open), and Windows (start) are supported.
 *
 * @example
 * ```typescript
 * await openInBrowser(result, { title: 'Debug run' })
 * ```
 */
export async function openInBrowser(
  result: ExecutionResult,
  cfg?: VizConfig,
): Promise<string> {
  const filePath = join(tmpdir(), `swarmwire-viz-${Date.now()}.html`)
  await exportHTML(result, filePath, cfg)

  const cmd =
    process.platform === 'darwin' ? `open "${filePath}"` :
    process.platform === 'win32'  ? `start "" "${filePath}"` :
                                    `xdg-open "${filePath}"`

  await new Promise<void>((resolve, reject) =>
    exec(cmd, (err) => err ? reject(err) : resolve()),
  )

  return filePath
}
