/**
 * Federation types — cross-swarm coordination.
 */

export interface SwarmRegistration {
  id: string
  metadata: Record<string, unknown>
  registeredAt: number
  lastSeen: number
}

export interface EphemeralAgent {
  id: string
  swarmId: string
  agentType: string
  task: string
  expiresAt: number
  status: 'active' | 'completed' | 'expired'
}

export interface ConsensusProposal {
  id: string
  proposerId: string
  type: string
  value: unknown
  /** Map<voterId, approve> */
  votes: Map<string, boolean>
  result?: boolean
  createdAt: number
}

export interface FederationMessage {
  id: string
  fromSwarmId: string
  toSwarmId: string | '*'
  payload: unknown
  timestamp: number
}

export interface FederationConfig {
  cleanupIntervalMs?: number
  defaultTtlMs?: number
  consensusQuorum?: number
}
