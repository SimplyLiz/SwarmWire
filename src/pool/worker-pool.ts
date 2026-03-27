/**
 * Worker Pool — manages agent execution workers with lifecycle, concurrency, and warm pooling.
 */

export interface WorkerPoolConfig {
  /** Minimum warm workers. Default 0 */
  minWorkers?: number
  /** Maximum concurrent workers. Default 10 */
  maxWorkers?: number
  /** Idle timeout before draining (ms). Default 60_000 */
  idleTimeoutMs?: number
  /** Connection keepalive interval (ms). Default 30_000 */
  keepaliveMs?: number
}

export type WorkerStatus = 'idle' | 'busy' | 'draining'

export interface Worker {
  id: string
  status: WorkerStatus
  taskId: string | null
  startedAt: number | null
  tasksCompleted: number
  lastActiveAt: number
}

export class WorkerPool {
  private workers: Map<string, Worker> = new Map()
  private workerCounter = 0
  private queue: Array<{ resolve: (worker: Worker) => void; reject: (err: Error) => void }> = []
  private drainTimer: Map<string, ReturnType<typeof setTimeout>> = new Map()

  readonly config: Required<WorkerPoolConfig>

  constructor(config: WorkerPoolConfig = {}) {
    this.config = {
      minWorkers: config.minWorkers ?? 0,
      maxWorkers: config.maxWorkers ?? 10,
      idleTimeoutMs: config.idleTimeoutMs ?? 60_000,
      keepaliveMs: config.keepaliveMs ?? 30_000,
    }

    // Pre-warm
    for (let i = 0; i < this.config.minWorkers; i++) {
      this.createWorker()
    }
  }

  /** Acquire a worker. Queues if at capacity. */
  async acquire(timeoutMs = 30_000): Promise<Worker> {
    // Find idle worker
    for (const worker of this.workers.values()) {
      if (worker.status === 'idle') {
        this.cancelDrainTimer(worker.id)
        worker.status = 'busy'
        worker.startedAt = Date.now()
        return worker
      }
    }

    // Create new if under limit
    if (this.workers.size < this.config.maxWorkers) {
      const worker = this.createWorker()
      worker.status = 'busy'
      worker.startedAt = Date.now()
      return worker
    }

    // Queue
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex((q) => q.resolve === resolve)
        if (idx >= 0) this.queue.splice(idx, 1)
        reject(new Error(`Worker acquisition timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.queue.push({
        resolve: (w) => { clearTimeout(timer); resolve(w) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
    })
  }

  /** Release a worker back to the pool. */
  release(workerId: string, options?: { drain?: boolean }): void {
    const worker = this.workers.get(workerId)
    if (!worker) return

    worker.taskId = null
    worker.startedAt = null
    worker.tasksCompleted++
    worker.lastActiveAt = Date.now()

    if (options?.drain) {
      this.removeWorker(workerId)
      return
    }

    // Serve queued request
    if (this.queue.length > 0) {
      const next = this.queue.shift()!
      worker.status = 'busy'
      worker.startedAt = Date.now()
      next.resolve(worker)
      return
    }

    // Go idle
    worker.status = 'idle'

    // Set drain timer (but keep min workers alive)
    const idleCount = [...this.workers.values()].filter((w) => w.status === 'idle').length
    if (idleCount > this.config.minWorkers) {
      this.scheduleDrain(workerId)
    }
  }

  /** Get pool status. */
  status(): PoolStatus {
    const workers = [...this.workers.values()]
    return {
      total: workers.length,
      idle: workers.filter((w) => w.status === 'idle').length,
      busy: workers.filter((w) => w.status === 'busy').length,
      draining: workers.filter((w) => w.status === 'draining').length,
      queued: this.queue.length,
      totalTasksCompleted: workers.reduce((s, w) => s + w.tasksCompleted, 0),
    }
  }

  /** Drain all workers gracefully. */
  async drain(): Promise<void> {
    // Reject queued
    for (const q of this.queue) {
      q.reject(new Error('Pool is draining'))
    }
    this.queue = []

    // Mark busy workers as draining
    for (const worker of this.workers.values()) {
      if (worker.status === 'busy') {
        worker.status = 'draining'
      } else {
        this.removeWorker(worker.id)
      }
    }
  }

  /** Shutdown — remove all workers immediately. */
  shutdown(): void {
    for (const timer of this.drainTimer.values()) clearTimeout(timer)
    this.drainTimer.clear()
    for (const q of this.queue) q.reject(new Error('Pool shutdown'))
    this.queue = []
    this.workers.clear()
  }

  private createWorker(): Worker {
    const worker: Worker = {
      id: `worker_${++this.workerCounter}`,
      status: 'idle',
      taskId: null,
      startedAt: null,
      tasksCompleted: 0,
      lastActiveAt: Date.now(),
    }
    this.workers.set(worker.id, worker)
    return worker
  }

  private removeWorker(id: string): void {
    this.cancelDrainTimer(id)
    this.workers.delete(id)
  }

  private scheduleDrain(id: string): void {
    this.cancelDrainTimer(id)
    const timer = setTimeout(() => {
      const worker = this.workers.get(id)
      if (worker?.status === 'idle') {
        const idleCount = [...this.workers.values()].filter((w) => w.status === 'idle').length
        if (idleCount > this.config.minWorkers) {
          this.removeWorker(id)
        }
      }
    }, this.config.idleTimeoutMs)
    this.drainTimer.set(id, timer)
  }

  private cancelDrainTimer(id: string): void {
    const timer = this.drainTimer.get(id)
    if (timer) {
      clearTimeout(timer)
      this.drainTimer.delete(id)
    }
  }
}

export interface PoolStatus {
  total: number
  idle: number
  busy: number
  draining: number
  queued: number
  totalTasksCompleted: number
}
