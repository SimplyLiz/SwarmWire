import { describe, it, expect, vi } from 'vitest'
import { StateMachine, buildLinearStateMachine, END } from '../../src/workflow/state-machine.js'
import type { StateNode, StateMachineContext } from '../../src/workflow/state-machine.js'

type S = { count: number; value: string }

function counter(name: string, inc = 1): StateNode<S> {
  return {
    name,
    async execute(state) {
      return { ...state, count: state.count + inc }
    },
  }
}

describe('StateMachine', () => {
  it('runs a simple two-node machine', async () => {
    const machine = new StateMachine<S>({
      nodes: [counter('a'), counter('b')],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: END },
      ],
      entryNode: 'a',
    })
    const result = await machine.run({ count: 0, value: '' })
    expect(result.finalState.count).toBe(2)
    expect(result.iterations).toBe(2)
    expect(result.terminated).toBe('completed')
  })

  it('visits nodes in order in history', async () => {
    const machine = buildLinearStateMachine<S>([counter('x'), counter('y'), counter('z')])
    const result = await machine.run({ count: 0, value: '' })
    expect(result.visitHistory).toEqual(['x', 'y', 'z'])
  })

  it('supports conditional edges', async () => {
    const machine = new StateMachine<S>({
      nodes: [
        counter('start'),
        counter('low'),
        counter('high', 10),
      ],
      edges: [
        { from: 'start', to: (s) => s.count >= 1 ? 'high' : 'low' },
        { from: 'high', to: END },
        { from: 'low', to: END },
      ],
      entryNode: 'start',
    })
    const result = await machine.run({ count: 0, value: '' })
    expect(result.visitHistory).toContain('high')
  })

  it('terminates at maxIterations', async () => {
    // Loop back to itself
    const node: StateNode<S> = { name: 'loop', async execute(s) { return s } }
    const machine = new StateMachine<S>({
      nodes: [node],
      edges: [{ from: 'loop', to: 'loop' }],
      entryNode: 'loop',
      maxIterations: 3,
    })
    const result = await machine.run({ count: 0, value: '' })
    expect(result.terminated).toBe('max_iterations')
    expect(result.iterations).toBe(3)
  })

  it('returns error result for unknown node', async () => {
    const machine = new StateMachine<S>({
      nodes: [],
      edges: [],
      entryNode: 'missing',
    })
    const result = await machine.run({ count: 0, value: '' })
    expect(result.terminated).toBe('error')
    expect(result.error).toContain('missing')
  })

  it('handles node execution error', async () => {
    const boom: StateNode<S> = {
      name: 'boom',
      async execute() { throw new Error('explosion') },
    }
    const machine = new StateMachine<S>({
      nodes: [boom],
      edges: [{ from: 'boom', to: END }],
      entryNode: 'boom',
    })
    const result = await machine.run({ count: 0, value: '' })
    expect(result.terminated).toBe('error')
    expect(result.error).toContain('explosion')
  })

  it('calls onTrace callback', async () => {
    const traces: string[] = []
    const machine = buildLinearStateMachine<S>([counter('a')], {
      onTrace: (event) => traces.push(event),
    })
    await machine.run({ count: 0, value: '' })
    expect(traces).toContain('node.enter')
    expect(traces).toContain('node.exit')
  })

  it('addNode and addEdge work at runtime', async () => {
    const machine = new StateMachine<S>({ nodes: [], edges: [], entryNode: 'a' })
    machine.addNode(counter('a'))
    machine.addEdge({ from: 'a', to: END })
    const result = await machine.run({ count: 0, value: '' })
    expect(result.finalState.count).toBe(1)
  })

  it('toDot returns DOT format', () => {
    const machine = buildLinearStateMachine<S>([counter('x'), counter('y')])
    const dot = machine.toDot()
    expect(dot).toContain('"x"')
    expect(dot).toContain('"y"')
    expect(dot).toContain('->')
  })
})

describe('buildLinearStateMachine', () => {
  it('throws with empty node list', () => {
    expect(() => buildLinearStateMachine<S>([])).toThrow()
  })

  it('single node terminates after one step', async () => {
    const machine = buildLinearStateMachine<S>([counter('only')])
    const result = await machine.run({ count: 0, value: '' })
    expect(result.iterations).toBe(1)
    expect(result.finalState.count).toBe(1)
  })
})
