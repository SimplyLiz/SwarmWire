/**
 * Gossip protocol node — epidemic-style message dissemination.
 */

import type { ConsensusConfig, GossipMessage } from './types.js'

export type GossipSendFn = (toNodeId: string, message: GossipMessage) => Promise<void>

export interface GossipNodeConfig extends ConsensusConfig {
  onMessage?: (msg: GossipMessage) => void
}

export class GossipNode {
  readonly nodeId: string
  private peers: string[]
  private fanout: number
  private defaultTtl: number
  private sendFn: GossipSendFn
  private onMessage?: (msg: GossipMessage) => void

  private seen: Set<string> = new Set()
  private pending: GossipMessage[] = []
  private state: Map<string, unknown> = new Map()

  constructor(config: GossipNodeConfig, sendFn: GossipSendFn) {
    this.nodeId = config.nodeId
    this.peers = config.peers
    this.fanout = config.gossipFanout ?? 3
    this.defaultTtl = config.gossipTtl ?? 5
    this.sendFn = sendFn
    this.onMessage = config.onMessage
  }

  /**
   * Create and enqueue a message for dissemination.
   */
  broadcast(type: string, payload: unknown): GossipMessage {
    const id = `${this.nodeId}_${Date.now()}_${Math.random()}`
    const msg: GossipMessage = {
      id,
      type,
      payload,
      ttl: this.defaultTtl,
      originId: this.nodeId,
      hops: 0,
    }
    this.seen.add(id)
    this.pending.push(msg)

    // Store in local state if it's a key-value set
    if (type === 'set' && payload && typeof payload === 'object' && 'key' in payload) {
      const kv = payload as { key: string; value: unknown }
      this.state.set(kv.key, kv.value)
    }

    return msg
  }

  /**
   * Pick K random peers and forward pending messages.
   */
  async tick(): Promise<void> {
    if (this.pending.length === 0 || this.peers.length === 0) return

    // Pick K random peers
    const shuffled = [...this.peers].sort(() => Math.random() - 0.5)
    const targets = shuffled.slice(0, this.fanout)

    const toSend = [...this.pending]
    this.pending = []

    const nextPending: GossipMessage[] = []

    for (const msg of toSend) {
      const forwarded: GossipMessage = {
        ...msg,
        ttl: msg.ttl - 1,
        hops: msg.hops + 1,
      }

      await Promise.all(
        targets.map((peer) => this.sendFn(peer, forwarded).catch(() => undefined)),
      )

      if (forwarded.ttl > 0) {
        nextPending.push(forwarded)
      }
    }

    this.pending = nextPending
  }

  /**
   * Receive a gossip message from a peer.
   */
  receive(msg: GossipMessage): void {
    if (this.seen.has(msg.id)) return

    this.seen.add(msg.id)

    // Store in local state if it's a key-value set
    if (msg.type === 'set' && msg.payload && typeof msg.payload === 'object' && 'key' in msg.payload) {
      const kv = msg.payload as { key: string; value: unknown }
      this.state.set(kv.key, kv.value)
    }

    this.onMessage?.(msg)

    // Re-enqueue for further forwarding if TTL remains
    if (msg.ttl > 0) {
      this.pending.push(msg)
    }
  }

  getState(): Map<string, unknown> {
    return new Map(this.state)
  }

  getPending(): GossipMessage[] {
    return [...this.pending]
  }

  hasSeen(id: string): boolean {
    return this.seen.has(id)
  }
}
