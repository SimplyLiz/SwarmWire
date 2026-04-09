import { describe, it, expect } from 'vitest'
import { EventFlow } from '../../src/workflow/event-driven.js'
import type { FlowEvent, FlowContext } from '../../src/workflow/event-driven.js'

describe('EventFlow', () => {
  it('processes initial events', async () => {
    const flow = new EventFlow({ steps: [] })
    const result = await flow.run([{ type: 'start', payload: 'hello', timestamp: Date.now() }])
    expect(result.processed).toBe(1)
    expect(result.history).toHaveLength(1)
  })

  it('step subscribed to event type fires when that event is emitted', async () => {
    const fired: string[] = []

    const flow = new EventFlow({
      steps: [
        {
          name: 'listener',
          handles: ['data.ready'],
          handler: async (event: FlowEvent) => {
            fired.push(event.type)
            return null
          },
        },
      ],
    })

    await flow.run([{ type: 'data.ready', payload: { x: 1 }, timestamp: Date.now() }])
    expect(fired).toContain('data.ready')
  })

  it('step does not fire for events it does not handle', async () => {
    const fired: string[] = []

    const flow = new EventFlow({
      steps: [
        {
          name: 'listener',
          handles: ['specific.event'],
          handler: async (event: FlowEvent) => { fired.push(event.type); return null },
        },
      ],
    })

    await flow.run([{ type: 'other.event', payload: null, timestamp: Date.now() }])
    expect(fired).toHaveLength(0)
  })

  it('returned events are enqueued and processed', async () => {
    const processed: string[] = []

    const flow = new EventFlow({
      steps: [
        {
          name: 'producer',
          handles: ['start'],
          handler: async (): Promise<FlowEvent> => ({ type: 'downstream', payload: 42, timestamp: Date.now() }),
        },
        {
          name: 'consumer',
          handles: ['downstream'],
          handler: async (event: FlowEvent) => { processed.push(String(event.payload)); return null },
        },
      ],
    })

    await flow.run([{ type: 'start', payload: null, timestamp: Date.now() }])
    expect(processed).toContain('42')
  })

  it('respects maxEvents limit', async () => {
    let count = 0
    const flow = new EventFlow({
      steps: [
        {
          name: 'loop',
          handles: ['tick'],
          handler: async (): Promise<FlowEvent> => ({ type: 'tick', payload: ++count, timestamp: Date.now() }),
        },
      ],
      maxEvents: 5,
    })

    const result = await flow.run([{ type: 'tick', payload: 0, timestamp: Date.now() }])
    expect(result.processed).toBeLessThanOrEqual(5)
  })

  it('addStep adds a step at runtime', async () => {
    const fired: string[] = []
    const flow = new EventFlow({ steps: [] })
    flow.addStep({
      name: 'late',
      handles: ['late.event'],
      handler: async (e: FlowEvent) => { fired.push(e.type); return null },
    })

    await flow.run([{ type: 'late.event', payload: null, timestamp: Date.now() }])
    expect(fired).toContain('late.event')
  })

  it('on() notifies external subscriber', async () => {
    const received: string[] = []
    const flow = new EventFlow({ steps: [] })
    flow.on('notify.me', (e) => received.push(e.type))

    await flow.run([{ type: 'notify.me', payload: null, timestamp: Date.now() }])
    expect(received).toContain('notify.me')
  })

  it('collects handler errors without crashing', async () => {
    const flow = new EventFlow({
      steps: [
        {
          name: 'bad',
          handles: ['err'],
          handler: async () => { throw new Error('boom') },
        },
      ],
    })

    const result = await flow.run([{ type: 'err', payload: null, timestamp: Date.now() }])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.message).toBe('boom')
  })

  it('FlowContext.emit adds events to queue', async () => {
    const seen: string[] = []
    const flow = new EventFlow({
      steps: [
        {
          name: 'emitter',
          handles: ['go'],
          handler: async (_e: FlowEvent, ctx: FlowContext) => {
            ctx.emit('done', 'payload')
            return null
          },
        },
        {
          name: 'receiver',
          handles: ['done'],
          handler: async (e: FlowEvent) => { seen.push(String(e.payload)); return null },
        },
      ],
    })

    await flow.run([{ type: 'go', payload: null, timestamp: Date.now() }])
    expect(seen).toContain('payload')
  })
})
