/**
 * Raft consensus implementation — in-process simulation via injected sendFn.
 */

import type { ConsensusConfig, LogEntry, ConsensusResult } from './types.js'

export type RaftState = 'follower' | 'candidate' | 'leader'

export interface RaftMessage {
  type: 'RequestVote' | 'RequestVoteReply' | 'AppendEntries' | 'AppendEntriesReply'
  term: number
  candidateId?: string
  lastLogIndex?: number
  lastLogTerm?: number
  voteGranted?: boolean
  leaderId?: string
  entries?: LogEntry[]
  leaderCommit?: number
  success?: boolean
  prevLogIndex?: number
  prevLogTerm?: number
}

export type RaftSendFn = (toNodeId: string, message: RaftMessage) => Promise<void>

export type RaftEventType = 'election.started' | 'leader.elected' | 'log.committed'

export interface RaftEvent {
  type: RaftEventType
  nodeId: string
  term?: number
  command?: unknown
  index?: number
}

export interface RaftNodeConfig extends ConsensusConfig {
  onEvent?: (event: RaftEvent) => void
}

// Pending propose resolved when command is committed
interface PendingPropose {
  command: unknown
  resolve: (result: ConsensusResult) => void
  reject: (err: Error) => void
}

export class RaftNode {
  readonly nodeId: string
  private peers: string[]
  private sendFn: RaftSendFn
  private onEvent?: (event: RaftEvent) => void
  private electionTimeoutRange: [number, number]
  private heartbeatMs: number

  // Raft state
  private state: RaftState = 'follower'
  private currentTerm = 0
  private votedFor: string | null = null
  private log: LogEntry[] = []
  private commitIndex = -1

  // Election
  private electionTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private votesReceived = new Set<string>()

  // Pending proposals (leader only)
  private pendingProposes: Map<number, PendingPropose> = new Map()

  // next/matchIndex for each peer (leader only)
  private nextIndex: Map<string, number> = new Map()
  private matchIndex: Map<string, number> = new Map()

  constructor(config: RaftNodeConfig, sendFn: RaftSendFn) {
    this.nodeId = config.nodeId
    this.peers = config.peers
    this.sendFn = sendFn
    this.onEvent = config.onEvent
    this.electionTimeoutRange = config.electionTimeoutMs ?? [150, 300]
    this.heartbeatMs = config.heartbeatMs ?? 50
  }

  start(): void {
    this.resetElectionTimer()
  }

  stop(): void {
    if (this.electionTimer) clearTimeout(this.electionTimer)
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    this.electionTimer = null
    this.heartbeatTimer = null
    // Reject any pending proposes
    for (const pending of this.pendingProposes.values()) {
      pending.reject(new Error('Node stopped'))
    }
    this.pendingProposes.clear()
  }

  propose(command: unknown): Promise<ConsensusResult> {
    if (this.state !== 'leader') {
      return Promise.reject(new Error(`Node ${this.nodeId} is not the leader (state: ${this.state})`))
    }

    const entry: LogEntry = {
      term: this.currentTerm,
      index: this.log.length,
      command,
    }
    this.log.push(entry)

    return new Promise((resolve, reject) => {
      if (this.peers.length === 0) {
        // Single node — auto-commit
        entry.committedAt = Date.now()
        this.commitIndex = entry.index
        this.onEvent?.({ type: 'log.committed', nodeId: this.nodeId, term: this.currentTerm, command, index: entry.index })
        resolve({ accepted: true, value: command, term: this.currentTerm, nodeId: this.nodeId })
        return
      }
      this.pendingProposes.set(entry.index, { command, resolve, reject })
      // Trigger replication immediately
      void this.broadcastAppendEntries()
    })
  }

  async receive(fromId: string, msg: RaftMessage): Promise<void> {
    // Update term if we see a higher one — always step down to follower
    if (msg.term > this.currentTerm) {
      this.currentTerm = msg.term
      this.state = 'follower'
      this.votedFor = null
      if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    }

    switch (msg.type) {
      case 'RequestVote':
        await this.handleRequestVote(fromId, msg)
        break
      case 'RequestVoteReply':
        await this.handleRequestVoteReply(fromId, msg)
        break
      case 'AppendEntries':
        await this.handleAppendEntries(fromId, msg)
        break
      case 'AppendEntriesReply':
        await this.handleAppendEntriesReply(fromId, msg)
        break
    }
  }

  getState(): RaftState { return this.state }
  getTerm(): number { return this.currentTerm }
  getLog(): LogEntry[] { return this.log }

  private resetElectionTimer(): void {
    if (this.electionTimer) clearTimeout(this.electionTimer)
    const [min, max] = this.electionTimeoutRange
    const timeout = min + Math.random() * (max - min)
    this.electionTimer = setTimeout(() => void this.startElection(), timeout)
  }

  private async startElection(): Promise<void> {
    this.state = 'candidate'
    this.currentTerm++
    this.votedFor = this.nodeId
    this.votesReceived = new Set([this.nodeId])

    this.onEvent?.({ type: 'election.started', nodeId: this.nodeId, term: this.currentTerm })

    // Single-node cluster — immediately win election
    if (this.peers.length === 0) {
      await this.becomeLeader()
      return
    }

    const lastLogIndex = this.log.length - 1
    const lastLogTerm = lastLogIndex >= 0 ? (this.log[lastLogIndex]?.term ?? 0) : 0

    const msg: RaftMessage = {
      type: 'RequestVote',
      term: this.currentTerm,
      candidateId: this.nodeId,
      lastLogIndex,
      lastLogTerm,
    }

    await Promise.all(this.peers.map((peer) => this.sendFn(peer, msg).catch(() => undefined)))
    this.resetElectionTimer()
  }

  private async handleRequestVote(fromId: string, msg: RaftMessage): Promise<void> {
    const lastLogIndex = this.log.length - 1
    const lastLogTerm = lastLogIndex >= 0 ? (this.log[lastLogIndex]?.term ?? 0) : 0

    const logOk =
      (msg.lastLogTerm ?? 0) > lastLogTerm ||
      ((msg.lastLogTerm ?? 0) === lastLogTerm && (msg.lastLogIndex ?? -1) >= lastLogIndex)

    const voteGranted =
      msg.term >= this.currentTerm &&
      (this.votedFor === null || this.votedFor === (msg.candidateId ?? '')) &&
      logOk

    if (voteGranted) {
      this.votedFor = msg.candidateId ?? fromId
      this.resetElectionTimer()
    }

    await this.sendFn(fromId, {
      type: 'RequestVoteReply',
      term: this.currentTerm,
      voteGranted,
    })
  }

  private async handleRequestVoteReply(_fromId: string, msg: RaftMessage): Promise<void> {
    if (this.state !== 'candidate' || msg.term !== this.currentTerm) return

    if (msg.voteGranted) {
      this.votesReceived.add(_fromId)
      const majority = Math.floor((this.peers.length + 1) / 2) + 1
      if (this.votesReceived.size >= majority) {
        await this.becomeLeader()
      }
    }
  }

  private async becomeLeader(): Promise<void> {
    if (this.state === 'leader') return
    this.state = 'leader'
    if (this.electionTimer) clearTimeout(this.electionTimer)

    // Initialize nextIndex and matchIndex
    for (const peer of this.peers) {
      this.nextIndex.set(peer, this.log.length)
      this.matchIndex.set(peer, -1)
    }

    this.onEvent?.({ type: 'leader.elected', nodeId: this.nodeId, term: this.currentTerm })
    await this.broadcastAppendEntries()
    this.scheduleHeartbeat()
  }

  private scheduleHeartbeat(): void {
    if (this.state !== 'leader') return
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
    this.heartbeatTimer = setTimeout(() => {
      void this.broadcastAppendEntries().then(() => this.scheduleHeartbeat())
    }, this.heartbeatMs)
  }

  private async broadcastAppendEntries(): Promise<void> {
    if (this.state !== 'leader') return

    await Promise.all(
      this.peers.map(async (peer) => {
        const nextIdx = this.nextIndex.get(peer) ?? this.log.length
        const prevLogIndex = nextIdx - 1
        const prevLogTerm = prevLogIndex >= 0 ? (this.log[prevLogIndex]?.term ?? 0) : 0
        const entries = this.log.slice(nextIdx)

        const msg: RaftMessage = {
          type: 'AppendEntries',
          term: this.currentTerm,
          leaderId: this.nodeId,
          prevLogIndex,
          prevLogTerm,
          entries,
          leaderCommit: this.commitIndex,
        }

        try {
          await this.sendFn(peer, msg)
        } catch {
          // Network failure — ignore
        }
      }),
    )
  }

  private async handleAppendEntries(fromId: string, msg: RaftMessage): Promise<void> {
    // Reject if stale term
    if (msg.term < this.currentTerm) {
      await this.sendFn(fromId, { type: 'AppendEntriesReply', term: this.currentTerm, success: false })
      return
    }

    // Valid leader — reset election timer, step down if candidate
    if (this.state === 'candidate') this.state = 'follower'
    this.resetElectionTimer()

    const prevLogIndex = msg.prevLogIndex ?? -1
    const prevLogTerm = msg.prevLogTerm ?? 0

    // Check log consistency
    if (prevLogIndex >= 0) {
      const entry = this.log[prevLogIndex]
      if (!entry || entry.term !== prevLogTerm) {
        await this.sendFn(fromId, { type: 'AppendEntriesReply', term: this.currentTerm, success: false })
        return
      }
    }

    // Append new entries
    const entries = msg.entries ?? []
    let insertIdx = prevLogIndex + 1
    for (const entry of entries) {
      if (insertIdx < this.log.length) {
        if (this.log[insertIdx]!.term !== entry.term) {
          // Conflict — truncate from here
          this.log.splice(insertIdx)
        } else {
          insertIdx++
          continue
        }
      }
      this.log.push(entry)
      insertIdx++
    }

    // Update commitIndex
    if ((msg.leaderCommit ?? -1) > this.commitIndex) {
      this.commitIndex = Math.min(msg.leaderCommit!, this.log.length - 1)
    }

    await this.sendFn(fromId, {
      type: 'AppendEntriesReply',
      term: this.currentTerm,
      success: true,
      lastLogIndex: this.log.length - 1,
    })
  }

  private async handleAppendEntriesReply(fromId: string, msg: RaftMessage): Promise<void> {
    if (this.state !== 'leader') return

    if (msg.success) {
      const lastIdx = (msg as RaftMessage & { lastLogIndex?: number }).lastLogIndex
      if (lastIdx !== undefined) {
        this.nextIndex.set(fromId, lastIdx + 1)
        this.matchIndex.set(fromId, lastIdx)
      }
      // Check if we can advance commitIndex
      this.tryAdvanceCommitIndex()
    } else {
      // Decrement nextIndex and retry
      const ni = this.nextIndex.get(fromId) ?? 0
      if (ni > 0) {
        this.nextIndex.set(fromId, ni - 1)
        void this.broadcastAppendEntries()
      }
    }
  }

  private tryAdvanceCommitIndex(): void {
    // Find highest N such that a majority of matchIndex >= N and log[N].term == currentTerm
    for (let n = this.log.length - 1; n > this.commitIndex; n--) {
      const entry = this.log[n]
      if (!entry || entry.term !== this.currentTerm) continue

      const replicatedCount = 1 + // self
        this.peers.filter((p) => (this.matchIndex.get(p) ?? -1) >= n).length

      const majority = Math.floor((this.peers.length + 1) / 2) + 1
      if (replicatedCount >= majority) {
        this.commitIndex = n
        // Resolve pending proposes up to commitIndex
        for (let i = 0; i <= n; i++) {
          const pending = this.pendingProposes.get(i)
          if (pending) {
            const logEntry = this.log[i]!
            logEntry.committedAt = Date.now()
            this.onEvent?.({ type: 'log.committed', nodeId: this.nodeId, term: this.currentTerm, command: logEntry.command, index: i })
            pending.resolve({ accepted: true, value: logEntry.command, term: this.currentTerm, nodeId: this.nodeId })
            this.pendingProposes.delete(i)
          }
        }
        break
      }
    }
  }
}
