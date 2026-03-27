import { describe, it, expect } from 'vitest'
import { WorkerPool } from '../../src/pool/worker-pool.js'

describe('WorkerPool', () => {
  it('acquires and releases workers', async () => {
    const pool = new WorkerPool({ maxWorkers: 3 })
    const w1 = await pool.acquire()
    expect(w1.status).toBe('busy')

    const status = pool.status()
    expect(status.total).toBe(1)
    expect(status.busy).toBe(1)

    pool.release(w1.id)
    const status2 = pool.status()
    expect(status2.idle).toBe(1)
    expect(status2.busy).toBe(0)

    pool.shutdown()
  })

  it('queues when at max capacity', async () => {
    const pool = new WorkerPool({ maxWorkers: 1 })
    const w1 = await pool.acquire()

    // Second acquire should queue
    let resolved = false
    const p2 = pool.acquire(5000).then((w) => { resolved = true; return w })

    expect(pool.status().queued).toBe(1)

    // Release w1 — should unblock p2
    pool.release(w1.id)
    const w2 = await p2
    expect(resolved).toBe(true)
    expect(w2.status).toBe('busy')

    pool.release(w2.id)
    pool.shutdown()
  })

  it('times out when queue is full', async () => {
    const pool = new WorkerPool({ maxWorkers: 1 })
    await pool.acquire()

    await expect(pool.acquire(50)).rejects.toThrow('timed out')
    pool.shutdown()
  })

  it('pre-warms minimum workers', () => {
    const pool = new WorkerPool({ minWorkers: 3, maxWorkers: 10 })
    const status = pool.status()
    expect(status.total).toBe(3)
    expect(status.idle).toBe(3)
    pool.shutdown()
  })

  it('tracks tasks completed', async () => {
    const pool = new WorkerPool({ maxWorkers: 5 })
    const w1 = await pool.acquire()
    pool.release(w1.id)
    const w2 = await pool.acquire()
    pool.release(w2.id)

    expect(pool.status().totalTasksCompleted).toBe(2)
    pool.shutdown()
  })

  it('drains gracefully', async () => {
    const pool = new WorkerPool({ minWorkers: 2, maxWorkers: 5 })
    const w1 = await pool.acquire()

    await pool.drain()
    expect(pool.status().queued).toBe(0)

    // Busy worker should be marked draining
    const status = pool.status()
    expect(status.draining).toBe(1)

    pool.shutdown()
  })
})
