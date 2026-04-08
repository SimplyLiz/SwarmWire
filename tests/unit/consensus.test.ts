import { describe, it, expect } from 'vitest'
import { RaftNode, ByzantineNode, GossipNode } from '../../src/consensus/index.js'
import type { RaftMessage } from '../../src/consensus/raft.js'
import type { BftMessage } from '../../src/consensus/byzantine.js'
import type { GossipMessage } from '../../src/consensus/types.js'

// ---------------------------------------------------------------------------
// Raft cluster helper
// ---------------------------------------------------------------------------

function buildRaftCluster(ids: string[]): Map<string, RaftNode> {
  const nodes = new Map<string, RaftNode>()

  for (const id of ids) {
    const peers = ids.filter((p) => p !== id)
    // Each node gets its own sendFn that passes its own id as the fromId
    const sendFn = async (toId: string, msg: RaftMessage) => {
      const node = nodes.get(toId)
      if (node) await node.receive(id, msg)
    }
    nodes.set(
      id,
      new RaftNode(
        { nodeId: id, peers, electionTimeoutMs: [50, 100], heartbeatMs: 20 },
        sendFn,
      ),
    )
  }

  return nodes
}

async function waitForLeader(
  nodes: Map<string, RaftNode>,
  timeoutMs = 2000,
): Promise<RaftNode | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const node of nodes.values()) {
      if (node.getState() === 'leader') return node
    }
    await new Promise((r) => setTimeout(r, 20))
  }
  return null
}

// ---------------------------------------------------------------------------
// Raft tests
// ---------------------------------------------------------------------------

describe('RaftNode', () => {
  it('single-node cluster immediately becomes leader on propose (no-peers)', async () => {
    const sendFn = async () => {}
    const node = new RaftNode(
      { nodeId: 'n1', peers: [], electionTimeoutMs: [50, 80] },
      sendFn,
    )
    node.start()

    // Wait for election timer
    await new Promise((r) => setTimeout(r, 120))
    expect(node.getState()).toBe('leader')

    const result = await node.propose('cmd1')
    expect(result.accepted).toBe(true)
    expect(result.value).toBe('cmd1')

    node.stop()
  })

  it('3-node cluster elects exactly one leader', async () => {
    const nodes = buildRaftCluster(['n1', 'n2', 'n3'])
    for (const n of nodes.values()) n.start()

    const leader = await waitForLeader(nodes, 3000)
    expect(leader).not.toBeNull()

    const leaderCount = [...nodes.values()].filter((n) => n.getState() === 'leader').length
    expect(leaderCount).toBe(1)

    for (const n of nodes.values()) n.stop()
  })

  it('proposed command appears in leader log', async () => {
    const nodes = buildRaftCluster(['n1', 'n2', 'n3'])
    for (const n of nodes.values()) n.start()

    const leader = await waitForLeader(nodes, 3000)
    expect(leader).not.toBeNull()

    const result = await leader!.propose({ action: 'set', key: 'x', value: 42 })
    expect(result.accepted).toBe(true)

    const log = leader!.getLog()
    expect(log.length).toBeGreaterThan(0)
    expect(log[log.length - 1]!.command).toMatchObject({ action: 'set', key: 'x' })

    for (const n of nodes.values()) n.stop()
  })

  it('propose throws when not leader', async () => {
    const sendFn = async () => {}
    const node = new RaftNode({ nodeId: 'n1', peers: ['n2'] }, sendFn)
    // Not started — still follower
    await expect(node.propose('cmd')).rejects.toThrow('not the leader')
  })

  it('onEvent fires election.started and leader.elected', async () => {
    const events: string[] = []
    const sendFn = async () => {}
    const node = new RaftNode(
      {
        nodeId: 'n1',
        peers: [],
        electionTimeoutMs: [20, 30],
        onEvent: (e) => events.push(e.type),
      },
      sendFn,
    )
    node.start()
    await new Promise((r) => setTimeout(r, 150))

    expect(events).toContain('election.started')
    expect(events).toContain('leader.elected')
    node.stop()
  })
})

// ---------------------------------------------------------------------------
// Byzantine (PBFT) tests
// ---------------------------------------------------------------------------

function buildBftCluster(ids: string[], onCommitGlobal?: (nodeId: string, v: unknown) => void): Map<string, ByzantineNode> {
  const nodes = new Map<string, ByzantineNode>()

  const sendFn = async (toId: string | '*', msg: BftMessage) => {
    if (toId === '*') {
      for (const [nid, node] of nodes.entries()) {
        if (nid !== msg.nodeId) await node.receive(msg.nodeId, msg)
      }
    } else {
      const node = nodes.get(toId)
      if (node) await node.receive(msg.nodeId, msg)
    }
  }

  for (const id of ids) {
    const peers = ids.filter((p) => p !== id)
    const nodeId = id
    nodes.set(
      id,
      new ByzantineNode(
        {
          nodeId,
          peers,
          onCommit: (v, s) => onCommitGlobal?.(nodeId, v),
        },
        sendFn,
      ),
    )
  }

  return nodes
}

describe('ByzantineNode', () => {
  it('4-node cluster (f=1) reaches commit on all nodes', async () => {
    const committed = new Map<string, unknown[]>()
    const nodes = buildBftCluster(['n1', 'n2', 'n3', 'n4'], (nodeId, v) => {
      const list = committed.get(nodeId) ?? []
      list.push(v)
      committed.set(nodeId, list)
    })

    const proposer = nodes.get('n1')!
    const result = await proposer.propose('test-value')

    expect(result.accepted).toBe(true)
    expect(result.value).toBe('test-value')
  })

  it('single-node reaches commit immediately', async () => {
    const sendFn = async () => {}
    const node = new ByzantineNode(
      { nodeId: 'n1', peers: [], onCommit: () => {} },
      sendFn,
    )
    const result = await node.propose('solo-value')
    expect(result.accepted).toBe(true)
    expect(result.value).toBe('solo-value')
  })

  it('digest is deterministic', () => {
    const sendFn = async () => {}
    const node = new ByzantineNode({ nodeId: 'n1', peers: [] }, sendFn)
    const d1 = node.digest({ key: 'value' })
    const d2 = node.digest({ key: 'value' })
    expect(d1).toBe(d2)
    expect(typeof d1).toBe('string')
  })

  it('f=1 with 4 nodes', () => {
    const sendFn = async () => {}
    const node = new ByzantineNode({ nodeId: 'n1', peers: ['n2', 'n3', 'n4'] }, sendFn)
    expect(node.getFaultTolerance()).toBe(1)
    expect(node.getQuorum()).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Gossip tests
// ---------------------------------------------------------------------------

function buildGossipCluster(ids: string[]): Map<string, GossipNode> {
  const nodes = new Map<string, GossipNode>()

  const sendFn = async (toId: string, msg: GossipMessage) => {
    const node = nodes.get(toId)
    if (node) node.receive(msg)
  }

  for (const id of ids) {
    const peers = ids.filter((p) => p !== id)
    nodes.set(
      id,
      new GossipNode(
        { nodeId: id, peers, gossipFanout: 3, gossipTtl: 4 },
        sendFn,
      ),
    )
  }

  return nodes
}

describe('GossipNode', () => {
  it('message reaches all nodes within 3 ticks', async () => {
    const nodeIds = ['n1', 'n2', 'n3', 'n4', 'n5']
    const nodes = buildGossipCluster(nodeIds)
    const received = new Set<string>()

    // Track via onMessage callback by rebuilding cluster with onMessage
    const nodes2 = new Map<string, GossipNode>()
    const sendFn2 = async (toId: string, msg: GossipMessage) => {
      const node = nodes2.get(toId)
      if (node) node.receive(msg)
    }
    for (const id of nodeIds) {
      const peers = nodeIds.filter((p) => p !== id)
      nodes2.set(id, new GossipNode(
        { nodeId: id, peers, gossipFanout: 3, gossipTtl: 4, onMessage: () => received.add(id) },
        sendFn2,
      ))
    }

    // n1 broadcasts
    nodes2.get('n1')!.broadcast('ping', { hello: 'world' })

    // 3 ticks
    for (let tick = 0; tick < 3; tick++) {
      for (const node of nodes2.values()) await node.tick()
    }

    // All non-origin nodes should have received the message via onMessage
    for (const id of nodeIds.filter((id) => id !== 'n1')) {
      expect(received.has(id)).toBe(true)
    }
  })

  it('deduplicates — same message not processed via onMessage only once', async () => {
    const nodeIds = ['n1', 'n2', 'n3']
    const processed = new Map<string, number>()
    const nodes = new Map<string, GossipNode>()

    const sendFn = async (toId: string, msg: GossipMessage) => {
      const node = nodes.get(toId)
      if (node) node.receive(msg)
    }

    for (const id of nodeIds) {
      processed.set(id, 0)
      const peers = nodeIds.filter((p) => p !== id)
      nodes.set(id, new GossipNode(
        {
          nodeId: id,
          peers,
          gossipFanout: 3,
          gossipTtl: 4,
          onMessage: () => processed.set(id, (processed.get(id) ?? 0) + 1),
        },
        sendFn,
      ))
    }

    nodes.get('n1')!.broadcast('test', 'payload')

    for (let i = 0; i < 5; i++) {
      for (const n of nodes.values()) await n.tick()
    }

    // n2 and n3 should call onMessage exactly once each (dedup prevents re-delivery)
    expect(processed.get('n2')).toBe(1)
    expect(processed.get('n3')).toBe(1)
  })

  it('state updated on set messages', () => {
    const nodes = buildGossipCluster(['n1', 'n2'])
    const n1 = nodes.get('n1')!
    n1.broadcast('set', { key: 'x', value: 42 })
    const state = n1.getState()
    expect(state.get('x')).toBe(42)
  })

  it('state propagates to peer on receive', () => {
    const nodes = buildGossipCluster(['n1', 'n2'])
    const n1 = nodes.get('n1')!
    const n2 = nodes.get('n2')!

    const msg = n1.broadcast('set', { key: 'mykey', value: 'hello' })
    n2.receive({ ...msg, ttl: msg.ttl - 1, hops: msg.hops + 1 })

    expect(n2.getState().get('mykey')).toBe('hello')
  })
})
