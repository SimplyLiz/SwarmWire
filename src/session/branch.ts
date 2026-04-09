/**
 * Conversation Branching — fork a session at any point to explore
 * alternative continuations without losing the original thread.
 *
 * Inspired by Mistral's conversation branching and tree-of-thought patterns.
 * Integrates with SessionManager (src/session/index.ts).
 */

import type { Session, ConversationMessage } from './index.js'

export interface BranchPoint {
  /** ID of the message after which the branch diverges */
  afterMessageIndex: number
  branchId: string
  createdAt: number
  label?: string
}

export interface BranchedSession extends Session {
  /** ID of the parent session this was forked from */
  parentId: string
  /** Index in parent session's messages array at which this branch diverges */
  branchAfterIndex: number
  /** Branch label (e.g., 'alternative-A') */
  branchLabel?: string
}

export interface BranchTree {
  /** Root session ID */
  rootId: string
  /** All sessions in the tree keyed by session ID */
  sessions: Map<string, Session | BranchedSession>
  /** Adjacency list: parentId → [childId, ...] */
  children: Map<string, string[]>
}

export interface BranchManagerConfig {
  /** Max branches per session. Default 10 */
  maxBranchesPerSession?: number
}

export class BranchManager {
  private readonly branches: Map<string, BranchedSession> = new Map()
  private readonly childIndex: Map<string, string[]> = new Map()
  private readonly maxBranches: number

  constructor(config: BranchManagerConfig = {}) {
    this.maxBranches = config.maxBranchesPerSession ?? 10
  }

  /**
   * Fork a session at a given message index.
   * The new session starts with a copy of all messages up to (and including) that index.
   *
   * @param session The session to fork
   * @param afterMessageIndex Branch after this index (0-based). -1 forks from start.
   * @param label Optional human-readable label for this branch
   */
  fork(
    session: Session,
    afterMessageIndex: number,
    label?: string,
  ): BranchedSession {
    const existing = this.childIndex.get(session.id) ?? []
    if (existing.length >= this.maxBranches) {
      throw new Error(`Session "${session.id}" already has ${this.maxBranches} branches`)
    }

    const clampedIndex = Math.min(afterMessageIndex, session.messages.length - 1)
    const messages: ConversationMessage[] = session.messages
      .slice(0, clampedIndex + 1)
      .map((m) => ({ ...m }))

    const branchId = `branch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`

    const branch: BranchedSession = {
      id: branchId,
      name: label ?? `${session.name}/${branchId.slice(-6)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages,
      context: { ...session.context },
      archived: false,
      parentId: session.id,
      branchAfterIndex: clampedIndex,
      branchLabel: label,
    }

    this.branches.set(branchId, branch)
    const children = this.childIndex.get(session.id) ?? []
    children.push(branchId)
    this.childIndex.set(session.id, children)

    return branch
  }

  /** Get a branch by ID */
  getBranch(branchId: string): BranchedSession | undefined {
    return this.branches.get(branchId)
  }

  /** List all branches of a session */
  listBranches(sessionId: string): BranchedSession[] {
    const ids = this.childIndex.get(sessionId) ?? []
    return ids.map((id) => this.branches.get(id)).filter((b): b is BranchedSession => b !== undefined)
  }

  /** Append a message to a branch */
  appendMessage(branchId: string, message: ConversationMessage): void {
    const branch = this.branches.get(branchId)
    if (!branch) throw new Error(`Branch "${branchId}" not found`)
    branch.messages.push(message)
    branch.updatedAt = Date.now()
  }

  /** Delete a branch */
  deleteBranch(branchId: string): boolean {
    const branch = this.branches.get(branchId)
    if (!branch) return false

    // Remove from parent's child list
    const siblings = this.childIndex.get(branch.parentId) ?? []
    this.childIndex.set(branch.parentId, siblings.filter((id) => id !== branchId))
    this.branches.delete(branchId)
    return true
  }

  /**
   * Merge a branch back into the original session.
   * Appends all messages in the branch (after the divergence point) to the session.
   */
  merge(branchId: string, targetSession: Session): ConversationMessage[] {
    const branch = this.branches.get(branchId)
    if (!branch) throw new Error(`Branch "${branchId}" not found`)

    const newMessages = branch.messages.slice(branch.branchAfterIndex + 1)
    for (const msg of newMessages) {
      targetSession.messages.push({ ...msg })
    }
    targetSession.updatedAt = Date.now()
    return newMessages
  }

  /**
   * Build the full branch tree rooted at a session.
   */
  buildTree(rootSession: Session, allSessions: Map<string, Session>): BranchTree {
    const sessions = new Map<string, Session | BranchedSession>()
    const children = new Map<string, string[]>()

    const visit = (sessionId: string) => {
      const session = allSessions.get(sessionId) ?? this.branches.get(sessionId)
      if (!session) return
      sessions.set(sessionId, session)

      const branchChildren = this.childIndex.get(sessionId) ?? []
      children.set(sessionId, branchChildren)
      for (const childId of branchChildren) visit(childId)
    }

    visit(rootSession.id)

    return { rootId: rootSession.id, sessions, children }
  }

  /**
   * Compute diff between two branches — returns messages unique to each.
   */
  diff(
    branchAId: string,
    branchBId: string,
  ): { onlyInA: ConversationMessage[]; onlyInB: ConversationMessage[] } {
    const a = this.branches.get(branchAId)
    const b = this.branches.get(branchBId)
    if (!a || !b) throw new Error('Both branches must exist')

    const divergeAt = Math.min(a.branchAfterIndex, b.branchAfterIndex)
    const onlyInA = a.messages.slice(divergeAt + 1)
    const onlyInB = b.messages.slice(divergeAt + 1)

    return { onlyInA, onlyInB }
  }
}
