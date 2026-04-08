/**
 * Consensus algorithm shared types.
 */

export interface ConsensusConfig {
  nodeId: string
  peers: string[]
  /** Election timeout range [min, max] in ms. Default [150, 300]. */
  electionTimeoutMs?: [number, number]
  heartbeatMs?: number
  gossipFanout?: number
  gossipTtl?: number
}

export interface LogEntry {
  term: number
  index: number
  command: unknown
  committedAt?: number
}

export interface ConsensusResult<T = unknown> {
  accepted: boolean
  value: T
  term?: number
  round?: number
  nodeId: string
}

export interface GossipMessage {
  id: string
  type: string
  payload: unknown
  ttl: number
  originId: string
  hops: number
}
