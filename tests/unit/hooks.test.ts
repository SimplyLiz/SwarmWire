import { describe, it, expect, vi } from 'vitest'
import { HookRegistry, HookPriority, bridgeSwarmEvents } from '../../src/hooks/index.js'
import type { HookContext } from '../../src/hooks/index.js'
import type { SwarmEvent } from '../../src/types/pattern.js'

describe('HookRegistry', () => {
  it('executes handlers in priority-descending order', async () => {
    const registry = new HookRegistry()
    const order: number[] = []

    registry.register('StepStart', async () => { order.push(10) }, HookPriority.Low)
    registry.register('StepStart', async () => { order.push(1000) }, HookPriority.Critical)
    registry.register('StepStart', async () => { order.push(100) }, HookPriority.High)
    registry.register('StepStart', async () => { order.push(50) }, HookPriority.Normal)

    await registry.emit('StepStart', { stepId: 's1' })
    expect(order).toEqual([1000, 100, 50, 10])
  })

  it('unregister prevents future calls', async () => {
    const registry = new HookRegistry()
    const calls: number[] = []

    const id1 = registry.register('StepComplete', async () => { calls.push(1) })
    const id2 = registry.register('StepComplete', async () => { calls.push(2) })

    await registry.emit('StepComplete', {})
    expect(calls).toEqual([1, 2])

    const removed = registry.unregister(id1)
    expect(removed).toBe(true)

    calls.length = 0
    await registry.emit('StepComplete', {})
    expect(calls).toEqual([2])

    expect(registry.unregister('nonexistent')).toBe(false)
  })

  it('swallows errors from silent handlers', async () => {
    const registry = new HookRegistry()
    const calls: string[] = []

    registry.register('LlmCall', async () => { throw new Error('boom') }, HookPriority.High, true)
    registry.register('LlmCall', async () => { calls.push('second') }, HookPriority.Normal)

    // Should not throw, second handler should still run
    await expect(registry.emit('LlmCall', {})).resolves.toBeUndefined()
    expect(calls).toContain('second')
  })

  it('rethrows errors from non-silent handlers', async () => {
    const registry = new HookRegistry()
    registry.register('AgentSpawn', async () => { throw new Error('fatal') })
    await expect(registry.emit('AgentSpawn', {})).rejects.toThrow('fatal')
  })

  it('suppressErrors option swallows all errors', async () => {
    const registry = new HookRegistry({ suppressErrors: true })
    registry.register('SessionStart', async () => { throw new Error('suppressed') })
    await expect(registry.emit('SessionStart', {})).resolves.toBeUndefined()
  })

  it('tracks stats per event', async () => {
    const registry = new HookRegistry()
    registry.register('MemoryStore', async () => {})
    registry.register('MemoryStore', async () => {})

    await registry.emit('MemoryStore', {})
    await registry.emit('MemoryStore', {})

    const stats = registry.getStats()
    const memStat = stats.find((s) => s.event === 'MemoryStore')
    expect(memStat).toBeDefined()
    expect(memStat!.callCount).toBe(4) // 2 handlers × 2 emits
  })

  it('clear() removes handlers', async () => {
    const registry = new HookRegistry()
    const calls: number[] = []

    registry.register('PlanCreated', async () => { calls.push(1) })
    registry.clear('PlanCreated')
    await registry.emit('PlanCreated', {})
    expect(calls).toEqual([])
  })

  it('clear() with no arg removes all handlers', async () => {
    const registry = new HookRegistry()
    const calls: number[] = []

    registry.register('StepStart', async () => { calls.push(1) })
    registry.register('StepError', async () => { calls.push(2) })
    registry.clear()

    await registry.emit('StepStart', {})
    await registry.emit('StepError', {})
    expect(calls).toEqual([])
  })

  it('listHandlers returns registrations in priority order', () => {
    const registry = new HookRegistry()
    registry.register('ConflictDetected', async () => {}, HookPriority.Low)
    registry.register('ConflictDetected', async () => {}, HookPriority.Critical)

    const handlers = registry.listHandlers('ConflictDetected')
    expect(handlers[0]!.priority).toBe(HookPriority.Critical)
    expect(handlers[1]!.priority).toBe(HookPriority.Low)
  })

  it('passes context metadata to handler', async () => {
    const registry = new HookRegistry()
    let received: HookContext | null = null

    registry.register('StepStart', async (ctx) => { received = ctx })
    await registry.emit('StepStart', { foo: 'bar' }, { executionId: 'ex1', stepId: 'step1' })

    expect(received).toBeDefined()
    expect(received!.executionId).toBe('ex1')
    expect(received!.stepId).toBe('step1')
    expect(received!.event).toBe('StepStart')
  })
})

describe('bridgeSwarmEvents', () => {
  it('maps SwarmEvent types to HookEvents', async () => {
    const registry = new HookRegistry()
    const triggered: string[] = []

    registry.register('StepStart', async () => { triggered.push('StepStart') })
    registry.register('StepComplete', async () => { triggered.push('StepComplete') })
    registry.register('PlanCreated', async () => { triggered.push('PlanCreated') })
    registry.register('ExecutionComplete', async () => { triggered.push('ExecutionComplete') })
    registry.register('ConflictDetected', async () => { triggered.push('ConflictDetected') })

    const bridge = bridgeSwarmEvents(registry)

    bridge({ type: 'step:start', stepId: 's1', agentName: 'agent1' })
    bridge({ type: 'step:complete', stepId: 's1', agentName: 'agent1', durationMs: 100, costCents: 1 })
    bridge({ type: 'plan:created', planId: 'p1', steps: 3 })
    bridge({ type: 'execution:complete', durationMs: 500, costCents: 10 })
    bridge({ type: 'conflict:detected', conflict: 'x' })

    // Give microtask queue a tick
    await new Promise((r) => setTimeout(r, 10))

    expect(triggered).toContain('StepStart')
    expect(triggered).toContain('StepComplete')
    expect(triggered).toContain('PlanCreated')
    expect(triggered).toContain('ExecutionComplete')
    expect(triggered).toContain('ConflictDetected')
  })

  it('ignores unknown event types gracefully', () => {
    const registry = new HookRegistry()
    const bridge = bridgeSwarmEvents(registry)
    // budget:warning has no mapping — should not throw
    expect(() => bridge({ type: 'budget:warning', usage: 0.9 })).not.toThrow()
  })
})
