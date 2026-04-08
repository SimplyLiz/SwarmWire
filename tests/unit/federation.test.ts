import { describe, it, expect, afterEach } from 'vitest'
import { FederationHub } from '../../src/federation/hub.js'

describe('FederationHub', () => {
  let hub: FederationHub

  afterEach(() => {
    hub?.stop()
  })

  describe('swarm registration', () => {
    it('registers and lists swarms', () => {
      hub = new FederationHub()
      hub.registerSwarm('swarm-1', { region: 'us-east' })
      hub.registerSwarm('swarm-2', { region: 'eu-west' })

      const swarms = hub.listSwarms()
      expect(swarms).toHaveLength(2)
      expect(swarms.map((s) => s.id)).toContain('swarm-1')
      expect(swarms.map((s) => s.id)).toContain('swarm-2')
    })

    it('unregisters a swarm', () => {
      hub = new FederationHub()
      hub.registerSwarm('s1', {})
      hub.registerSwarm('s2', {})

      expect(hub.unregisterSwarm('s1')).toBe(true)
      expect(hub.listSwarms()).toHaveLength(1)
      expect(hub.unregisterSwarm('nonexistent')).toBe(false)
    })
  })

  describe('ephemeral agents', () => {
    it('spawns ephemeral agent with TTL', () => {
      hub = new FederationHub()
      hub.registerSwarm('s1', {})

      const agent = hub.spawnEphemeral('s1', 'researcher', 'analyze data', 60000)
      expect(agent.status).toBe('active')
      expect(agent.swarmId).toBe('s1')
      expect(agent.agentType).toBe('researcher')
      expect(agent.expiresAt).toBeGreaterThan(Date.now())
    })

    it('terminates ephemeral agent', () => {
      hub = new FederationHub()
      hub.registerSwarm('s1', {})

      const agent = hub.spawnEphemeral('s1', 'worker', 'task')
      expect(hub.terminateEphemeral(agent.id)).toBe(true)
      expect(hub.terminateEphemeral('nonexistent')).toBe(false)

      const agents = hub.listEphemeral('s1')
      const found = agents.find((a) => a.id === agent.id)
      expect(found?.status).toBe('completed')
    })

    it('listEphemeral filters by swarmId', () => {
      hub = new FederationHub()
      hub.registerSwarm('s1', {})
      hub.registerSwarm('s2', {})

      hub.spawnEphemeral('s1', 'type1', 'task1')
      hub.spawnEphemeral('s1', 'type2', 'task2')
      hub.spawnEphemeral('s2', 'type3', 'task3')

      const s1Agents = hub.listEphemeral('s1')
      expect(s1Agents).toHaveLength(2)

      const allAgents = hub.listEphemeral()
      expect(allAgents).toHaveLength(3)
    })

    it('expired agents filtered by default', () => {
      hub = new FederationHub()
      hub.registerSwarm('s1', {})

      const agent = hub.spawnEphemeral('s1', 'worker', 'task', 1) // 1ms TTL
      // Manually set expired
      agent.status = 'expired'

      const active = hub.listEphemeral('s1', false)
      expect(active.find((a) => a.id === agent.id)).toBeUndefined()

      const withExpired = hub.listEphemeral('s1', true)
      expect(withExpired.find((a) => a.id === agent.id)).toBeDefined()
    })
  })

  describe('messaging', () => {
    it('broadcasts to all other swarms', () => {
      hub = new FederationHub()
      hub.registerSwarm('s1', {})
      hub.registerSwarm('s2', {})
      hub.registerSwarm('s3', {})

      const sent = hub.broadcast('s1', { event: 'ping' })
      expect(sent).toHaveLength(2) // s2 and s3

      const s2Messages = hub.getMessages('s2')
      expect(s2Messages).toHaveLength(1)
      expect(s2Messages[0]!.fromSwarmId).toBe('s1')
    })

    it('getMessages with no arg returns all', () => {
      hub = new FederationHub()
      hub.registerSwarm('s1', {})
      hub.registerSwarm('s2', {})

      hub.broadcast('s1', 'hello')
      expect(hub.getMessages()).toHaveLength(1)
    })
  })

  describe('consensus', () => {
    it('resolves proposal when quorum reached (2/3)', () => {
      hub = new FederationHub({ consensusQuorum: 0.51 })
      hub.registerSwarm('s1', {})
      hub.registerSwarm('s2', {})
      hub.registerSwarm('s3', {})

      const proposal = hub.proposeConsensus('s1', 'config-change', { newConfig: true })
      expect(proposal.result).toBeUndefined()

      hub.vote(proposal.id, 's1', true)
      const after1 = hub.getProposal(proposal.id)!
      expect(after1.result).toBeUndefined() // 1/3 < 0.51

      hub.vote(proposal.id, 's2', true)
      const after2 = hub.getProposal(proposal.id)!
      expect(after2.result).toBe(true) // 2/3 >= 0.51
    })

    it('rejects proposal when too many rejections', () => {
      hub = new FederationHub({ consensusQuorum: 0.67 })
      hub.registerSwarm('s1', {})
      hub.registerSwarm('s2', {})
      hub.registerSwarm('s3', {})

      const proposal = hub.proposeConsensus('s1', 'deploy', { version: '2.0' })

      hub.vote(proposal.id, 's1', false)
      hub.vote(proposal.id, 's2', false)

      const p = hub.getProposal(proposal.id)!
      // 2/3 rejects > 1 - 0.67 = 0.33 → result = false
      expect(p.result).toBe(false)
    })

    it('throws for unknown proposal', () => {
      hub = new FederationHub()
      expect(() => hub.vote('nonexistent', 's1', true)).toThrow('not found')
    })
  })

  describe('cleanup', () => {
    it('marks expired agents on cleanup interval', async () => {
      hub = new FederationHub({ cleanupIntervalMs: 50 })
      hub.registerSwarm('s1', {})

      const agent = hub.spawnEphemeral('s1', 'worker', 'task', 1) // 1ms TTL
      expect(agent.status).toBe('active')

      hub.start()
      await new Promise((r) => setTimeout(r, 100))

      // After cleanup runs, expired agent should be marked
      const all = hub.listEphemeral('s1', true)
      // agent may be pruned or expired
      const found = all.find((a) => a.id === agent.id)
      if (found) expect(found.status).toBe('expired')

      hub.stop()
    })
  })
})
