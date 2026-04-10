/**
 * Byzantine Fault-Tolerant consensus — 3-phase PBFT.
 * Pure in-process, communication via injected sendFn.
 */

import type { ConsensusConfig, ConsensusResult } from './types.js'

export interface BftMessage {
  type: 'PrePrepare' | 'Prepare' | 'Commit' | 'Reply'
  seqNum: number
  view: number
  digest: string
  nodeId: string
  value?: unknown
}

export type BftSendFn = (toNodeId: string | '*', message: BftMessage) => Promise<void>

export interface ByzantineNodeConfig extends ConsensusConfig {
  onCommit?: (value: unknown, seqNum: number) => void
}

/**
 * djb2 hash — used as a deterministic digest with no crypto dependency.
 */
function djb2Hash(value: unknown): string {
  const str = JSON.stringify(value)
  let h = 5381
  for (const c of str) {
    h = ((h << 5) + h) ^ c.charCodeAt(0)
  }
  return (h >>> 0).toString(16)
}

interface PhaseState {
  value: unknown
  prepares: Set<string>
  commits: Set<string>
  committed: boolean
}

export class ByzantineNode {
  readonly nodeId: string
  private peers: string[]
  private sendFn: BftSendFn
  private onCommit?: (value: unknown, seqNum: number) => void

  private view = 0
  private seqNum = 0
  private f: number
  private quorum: number

  // Map from seqNum → phase state
  private phases: Map<number, PhaseState> = new Map()

  // Pending proposals
  private pending: Map<number, { resolve: (r: ConsensusResult) => void; reject: (e: Error) => void }> = new Map()

  constructor(config: ByzantineNodeConfig, sendFn: BftSendFn) {
    this.nodeId = config.nodeId
    this.peers = config.peers
    this.sendFn = sendFn
    this.onCommit = config.onCommit

    // f = floor((n-1)/3) where n = total nodes (peers + self)
    this.f = Math.floor(this.peers.length / 3)
    this.quorum = 2 * this.f + 1
  }

  /**
   * Primary node proposes a value. In this simplified in-process PBFT,
   * any node can call propose() — it sends PrePrepare to all peers.
   */
  async propose(value: unknown): Promise<ConsensusResult> {
    const seq = this.seqNum++
    const dig = djb2Hash(value)

    // Single-node: commit immediately without network round-trips
    if (this.peers.length === 0) {
      const state: PhaseState = {
        value,
        prepares: new Set([this.nodeId]),
        commits: new Set(),
        committed: true,
      }
      this.phases.set(seq, state)
      this.onCommit?.(value, seq)
      return { accepted: true, value, round: seq, nodeId: this.nodeId }
    }

    const state: PhaseState = {
      value,
      prepares: new Set([this.nodeId]),
      commits: new Set(),
      committed: false,
    }
    this.phases.set(seq, state)

    // Register pending promise BEFORE sending so handleCommit can resolve it
    const resultPromise = new Promise<ConsensusResult>((resolve, reject) => {
      this.pending.set(seq, { resolve, reject })
    })

    const prePrepareMsg: BftMessage = {
      type: 'PrePrepare',
      seqNum: seq,
      view: this.view,
      digest: dig,
      nodeId: this.nodeId,
      value,
    }

    // Send to all peers (async, non-blocking relative to promise setup above)
    void this.sendFn('*', prePrepareMsg)

    return resultPromise
  }

  async receive(_fromId: string, msg: BftMessage): Promise<void> {
    switch (msg.type) {
      case 'PrePrepare':
        await this.handlePrePrepare(msg)
        break
      case 'Prepare':
        await this.handlePrepare(msg)
        break
      case 'Commit':
        await this.handleCommit(msg)
        break
    }
  }

  // Buffer for prepares/commits received before PrePrepare arrives
  private prepareBuffer: Map<number, Set<string>> = new Map()
  private commitBuffer: Map<number, Set<string>> = new Map()

  private async handlePrePrepare(msg: BftMessage): Promise<void> {
    const { seqNum, value, digest } = msg

    // Verify digest
    if (digest !== djb2Hash(value)) return

    let state = this.phases.get(seqNum)
    if (!state) {
      state = {
        value,
        prepares: new Set([this.nodeId]),
        commits: new Set(),
        committed: false,
      }
      // Replay buffered prepares/commits
      const bufferedPrepares = this.prepareBuffer.get(seqNum)
      if (bufferedPrepares) {
        for (const nodeId of bufferedPrepares) state.prepares.add(nodeId)
        this.prepareBuffer.delete(seqNum)
      }
      const bufferedCommits = this.commitBuffer.get(seqNum)
      if (bufferedCommits) {
        for (const nodeId of bufferedCommits) state.commits.add(nodeId)
        this.commitBuffer.delete(seqNum)
      }
      this.phases.set(seqNum, state)
    }

    // Broadcast Prepare
    const prepareMsg: BftMessage = {
      type: 'Prepare',
      seqNum,
      view: this.view,
      digest,
      nodeId: this.nodeId,
    }
    await this.sendFn('*', prepareMsg)

    // Check if buffered messages already reached quorum
    await this.checkPrepareQuorum(seqNum, state, digest)
  }

  private async checkPrepareQuorum(seqNum: number, state: PhaseState, digest: string): Promise<void> {
    if (state.prepares.size >= this.quorum && !state.commits.has(this.nodeId)) {
      state.commits.add(this.nodeId)
      const commitMsg: BftMessage = {
        type: 'Commit',
        seqNum,
        view: this.view,
        digest,
        nodeId: this.nodeId,
      }
      await this.sendFn('*', commitMsg)
      await this.checkCommitQuorum(seqNum, state)
    }
  }

  private async handlePrepare(msg: BftMessage): Promise<void> {
    const state = this.phases.get(msg.seqNum)
    if (!state) {
      // Buffer the prepare for when PrePrepare arrives
      const buf = this.prepareBuffer.get(msg.seqNum) ?? new Set()
      buf.add(msg.nodeId)
      this.prepareBuffer.set(msg.seqNum, buf)
      return
    }

    state.prepares.add(msg.nodeId)

    // Quorum of prepares → move to commit phase
    await this.checkPrepareQuorum(msg.seqNum, state, msg.digest)
  }

  private async checkCommitQuorum(seqNum: number, state: PhaseState): Promise<void> {
    if (state.commits.size >= this.quorum && !state.committed) {
      state.committed = true
      this.onCommit?.(state.value, seqNum)

      const pending = this.pending.get(seqNum)
      if (pending) {
        pending.resolve({ accepted: true, value: state.value, round: seqNum, nodeId: this.nodeId })
        this.pending.delete(seqNum)
      }
    }
  }

  private async handleCommit(msg: BftMessage): Promise<void> {
    const state = this.phases.get(msg.seqNum)
    if (!state) {
      // Buffer commit for when state arrives
      const buf = this.commitBuffer.get(msg.seqNum) ?? new Set()
      buf.add(msg.nodeId)
      this.commitBuffer.set(msg.seqNum, buf)
      return
    }
    if (state.committed) return

    state.commits.add(msg.nodeId)
    await this.checkCommitQuorum(msg.seqNum, state)
  }

  digest(value: unknown): string {
    return djb2Hash(value)
  }

  getFaultTolerance(): number { return this.f }
  getQuorum(): number { return this.quorum }
}
