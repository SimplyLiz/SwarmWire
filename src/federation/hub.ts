/**
 * FederationHub — in-process multi-swarm coordination.
 */

import type {
  SwarmRegistration,
  EphemeralAgent,
  ConsensusProposal,
  FederationMessage,
  FederationConfig,
} from './types.js'

let idCounter = 0
function nextId(prefix: string): string {
  return `${prefix}_${++idCounter}_${Date.now().toString(36)}`
}

export class FederationHub {
  swarms: Map<string, SwarmRegistration> = new Map()
  private ephemeralAgents: Map<string, EphemeralAgent> = new Map()
  private messages: FederationMessage[] = []
  private proposals: Map<string, ConsensusProposal> = new Map()
  private config: Required<FederationConfig>
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: Partial<FederationConfig> = {}) {
    this.config = {
      cleanupIntervalMs: config.cleanupIntervalMs ?? 5000,
      defaultTtlMs: config.defaultTtlMs ?? 30000,
      consensusQuorum: config.consensusQuorum ?? 0.51,
    }
  }

  // ---------------------------------------------------------------------------
  // Swarm management
  // ---------------------------------------------------------------------------

  registerSwarm(id: string, metadata: Record<string, unknown>): SwarmRegistration {
    const now = Date.now()
    const reg: SwarmRegistration = {
      id,
      metadata,
      registeredAt: now,
      lastSeen: now,
    }
    this.swarms.set(id, reg)
    return reg
  }

  unregisterSwarm(id: string): boolean {
    return this.swarms.delete(id)
  }

  listSwarms(): SwarmRegistration[] {
    return [...this.swarms.values()]
  }

  // ---------------------------------------------------------------------------
  // Ephemeral agents
  // ---------------------------------------------------------------------------

  spawnEphemeral(swarmId: string, agentType: string, task: string, ttlMs?: number): EphemeralAgent {
    const ttl = ttlMs ?? this.config.defaultTtlMs
    const agent: EphemeralAgent = {
      id: nextId('eph'),
      swarmId,
      agentType,
      task,
      expiresAt: Date.now() + ttl,
      status: 'active',
    }
    this.ephemeralAgents.set(agent.id, agent)
    return agent
  }

  terminateEphemeral(id: string): boolean {
    const agent = this.ephemeralAgents.get(id)
    if (!agent) return false
    agent.status = 'completed'
    return true
  }

  /**
   * List ephemeral agents.
   * @param swarmId Filter by swarm. Omit for all.
   * @param includeExpired Include expired agents. Default false.
   */
  listEphemeral(swarmId?: string, includeExpired = false): EphemeralAgent[] {
    let agents = [...this.ephemeralAgents.values()]

    if (swarmId !== undefined) {
      agents = agents.filter((a) => a.swarmId === swarmId)
    }

    if (!includeExpired) {
      agents = agents.filter((a) => a.status !== 'expired')
    }

    return agents
  }

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------

  broadcast(fromSwarmId: string, payload: unknown): FederationMessage[] {
    const sent: FederationMessage[] = []

    for (const swarm of this.swarms.values()) {
      if (swarm.id === fromSwarmId) continue
      const msg: FederationMessage = {
        id: nextId('msg'),
        fromSwarmId,
        toSwarmId: swarm.id,
        payload,
        timestamp: Date.now(),
      }
      this.messages.push(msg)
      sent.push(msg)
    }

    return sent
  }

  getMessages(swarmId?: string): FederationMessage[] {
    if (swarmId === undefined) return [...this.messages]
    return this.messages.filter((m) => m.toSwarmId === swarmId || m.toSwarmId === '*')
  }

  // ---------------------------------------------------------------------------
  // Consensus
  // ---------------------------------------------------------------------------

  proposeConsensus(proposerId: string, type: string, value: unknown): ConsensusProposal {
    const proposal: ConsensusProposal = {
      id: nextId('proposal'),
      proposerId,
      type,
      value,
      votes: new Map(),
      createdAt: Date.now(),
    }
    this.proposals.set(proposal.id, proposal)
    return proposal
  }

  vote(proposalId: string, voterId: string, approve: boolean): ConsensusProposal {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) throw new Error(`Proposal ${proposalId} not found`)

    proposal.votes.set(voterId, approve)

    // Check if consensus reached
    this.checkConsensus(proposal)

    return proposal
  }

  private checkConsensus(proposal: ConsensusProposal): void {
    if (proposal.result !== undefined) return // already decided

    const total = this.swarms.size
    if (total === 0) return

    let approves = 0
    let rejects = 0

    for (const v of proposal.votes.values()) {
      if (v) approves++
      else rejects++
    }

    const quorum = this.config.consensusQuorum

    if (approves / total >= quorum) {
      proposal.result = true
    } else if (rejects / total > 1 - quorum) {
      proposal.result = false
    }
  }

  getProposal(id: string): ConsensusProposal | undefined {
    return this.proposals.get(id)
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupIntervalMs)
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  private cleanup(): void {
    const now = Date.now()

    for (const agent of this.ephemeralAgents.values()) {
      if (agent.status === 'active' && now > agent.expiresAt) {
        agent.status = 'expired'
      }
    }

    // Prune completed and old expired agents
    for (const [id, agent] of this.ephemeralAgents.entries()) {
      if (
        agent.status === 'completed' ||
        (agent.status === 'expired' && now - agent.expiresAt > 60_000)
      ) {
        this.ephemeralAgents.delete(id)
      }
    }
  }
}
