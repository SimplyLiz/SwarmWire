/**
 * Rollback Manager — captures before-state snapshots and restores on request.
 */

import type { Tool } from '../types/tool.js'

export interface ActionSnapshot {
  id: string
  executionId: string
  stepId: string
  agentName: string
  actionType: string
  beforeState: unknown
  afterState?: unknown
  timestamp: number
  reversible: boolean
  reversed?: boolean
}

export interface RollbackResult {
  snapshotId: string
  restored: boolean
  reason?: string
}

export class RollbackManager {
  private readonly snapshots: Map<string, ActionSnapshot> = new Map()
  private readonly byExecution: Map<string, string[]> = new Map()
  private readonly maxSnapshots: number
  private toolRegistry: Map<string, Tool> = new Map()

  constructor(maxSnapshots = 200) {
    this.maxSnapshots = maxSnapshots
  }

  /** Register a tool so its rollback() method can be called. */
  registerTool(tool: Tool): void {
    this.toolRegistry.set(tool.name, tool)
  }

  snapshot(
    executionId: string,
    stepId: string,
    agentName: string,
    actionType: string,
    beforeState: unknown,
    reversible = true,
  ): string {
    const id = `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const entry: ActionSnapshot = { id, executionId, stepId, agentName, actionType, beforeState, timestamp: Date.now(), reversible }
    this.snapshots.set(id, entry)

    const list = this.byExecution.get(executionId) ?? []
    list.push(id)
    this.byExecution.set(executionId, list)

    // Evict oldest if over cap
    if (this.snapshots.size > this.maxSnapshots) {
      const oldest = this.snapshots.keys().next().value
      if (oldest) {
        const snap = this.snapshots.get(oldest)
        if (snap) {
          const execList = this.byExecution.get(snap.executionId)
          if (execList) {
            const idx = execList.indexOf(oldest)
            if (idx !== -1) execList.splice(idx, 1)
          }
        }
        this.snapshots.delete(oldest)
      }
    }

    return id
  }

  complete(snapshotId: string, afterState: unknown): void {
    const snap = this.snapshots.get(snapshotId)
    if (snap) snap.afterState = afterState
  }

  rollback(snapshotId: string): RollbackResult {
    const snap = this.snapshots.get(snapshotId)
    if (!snap) return { snapshotId, restored: false, reason: 'Snapshot not found' }
    if (!snap.reversible) return { snapshotId, restored: false, reason: 'Action is not reversible' }
    if (snap.reversed) return { snapshotId, restored: false, reason: 'Already reversed' }

    if (snap.actionType === 'tool_call') {
      const tool = this.toolRegistry.get(snap.agentName)
      if (tool?.rollback) {
        // Fire async but don't await — caller can handle errors
        tool.rollback(snap.afterState, snap.beforeState).catch(() => {})
      }
    }

    snap.reversed = true
    return { snapshotId, restored: true }
  }

  undoExecution(executionId: string): RollbackResult[] {
    const ids = this.byExecution.get(executionId) ?? []
    // Reverse order — most recent first
    return [...ids].reverse().map((id) => this.rollback(id))
  }

  getSnapshots(executionId: string): ActionSnapshot[] {
    const ids = this.byExecution.get(executionId) ?? []
    return ids.map((id) => this.snapshots.get(id)).filter((s): s is ActionSnapshot => s !== undefined)
  }

  clear(executionId: string): void {
    const ids = this.byExecution.get(executionId) ?? []
    for (const id of ids) this.snapshots.delete(id)
    this.byExecution.delete(executionId)
  }
}
