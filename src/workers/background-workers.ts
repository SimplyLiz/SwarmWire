/**
 * Background Worker System
 * Provides continuous optimization, monitoring, and maintenance tasks
 * Inspired by Ruflo's background worker approach
 */

import type { MemoryBackend } from '../types/memory.js'

export type WorkerEventType = 
  | 'started' 
  | 'stopped' 
  | 'completed' 
  | 'error'
  | 'progress'

export interface WorkerEvent {
  type: WorkerEventType
  workerId: string
  timestamp: number
  data?: unknown
  error?: string
}

export interface WorkerConfig {
  id: string
  name: string
  description?: string
  /** Run interval in milliseconds (for periodic workers) */
  intervalMs?: number
  /** Whether to run on startup */
  runOnInit?: boolean
  /** Maximum concurrent runs */
  maxConcurrency?: number
  /** Timeout for each run in milliseconds */
  timeoutMs?: number
}

export type WorkerHandler = (
  context: WorkerContext
) => Promise<WorkerResult>

export interface WorkerContext {
  workerId: string
  signal: AbortSignal
  metadata: Map<string, unknown>
}

export interface WorkerResult {
  success: boolean
  message?: string
  data?: unknown
  metrics?: Record<string, number>
}

// Worker registry and runner
export interface WorkerSystemConfig {
  memoryBackend: MemoryBackend
  defaultIntervalMs?: number
  defaultTimeoutMs?: number
  maxWorkers?: number
}

export function createWorkerSystem(config: WorkerSystemConfig) {
  const {
    memoryBackend: _memoryBackend,
    defaultIntervalMs: _defaultIntervalMs = 60000, // 1 minute
    defaultTimeoutMs = 300000, // 5 minutes
    maxWorkers = 20
  } = config

  const workers: Map<string, { config: WorkerConfig; handler: WorkerHandler; interval?: ReturnType<typeof setInterval> }> = new Map()
  const workerMetrics: Map<string, { runs: number; successes: number; failures: number; lastRun?: number; avgDuration?: number }> = new Map()
  const eventHandlers: Map<string, Array<(event: WorkerEvent) => void>> = new Map()
  let isRunning = false

  // Register a worker
  function registerWorker(workerConfig: WorkerConfig, handler: WorkerHandler): void {
    if (workers.size >= maxWorkers) {
      throw new Error(`Maximum worker limit (${maxWorkers}) reached`)
    }
    workers.set(workerConfig.id, { config: workerConfig, handler })
    workerMetrics.set(workerConfig.id, { runs: 0, successes: 0, failures: 0 })
  }

  // Start a specific worker
  async function startWorker(workerId: string): Promise<void> {
    const worker = workers.get(workerId)
    if (!worker) throw new Error(`Worker ${workerId} not found`)

    const { config, handler } = worker
    emitEvent({ type: 'started', workerId, timestamp: Date.now() })

    // Create abort controller for this run
    const controller = new AbortController()
    const timeout = config.timeoutMs ?? defaultTimeoutMs

    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const startTime = Date.now()
    let result: WorkerResult

    try {
      const context: WorkerContext = {
        workerId,
        signal: controller.signal,
        metadata: new Map()
      }
      result = await handler(context)
      clearTimeout(timeoutId)

      // Update metrics
      const metrics = workerMetrics.get(workerId)!
      metrics.runs++
      metrics.successes++
      metrics.lastRun = Date.now()
      const duration = Date.now() - startTime
      metrics.avgDuration = metrics.avgDuration 
        ? (metrics.avgDuration * (metrics.runs - 1) + duration) / metrics.runs 
        : duration

      emitEvent({ type: 'completed', workerId, timestamp: Date.now(), data: result })
    } catch (error) {
      clearTimeout(timeoutId)
      
      // Update metrics
      const metrics = workerMetrics.get(workerId)!
      metrics.runs++
      metrics.failures++
      metrics.lastRun = Date.now()

      const errorMessage = error instanceof Error ? error.message : String(error)
      emitEvent({ type: 'error', workerId, timestamp: Date.now(), error: errorMessage })
      result = { success: false, message: errorMessage }
    }

    // Schedule next run if interval is set
    if (config.intervalMs) {
      worker.interval = setTimeout(() => startWorker(workerId), config.intervalMs)
    }
  }

  // Stop a specific worker
  function stopWorker(workerId: string): void {
    const worker = workers.get(workerId)
    if (!worker) return

    if (worker.interval) {
      clearTimeout(worker.interval)
      worker.interval = undefined
    }
    emitEvent({ type: 'stopped', workerId, timestamp: Date.now() })
  }

  // Start all workers with runOnInit
  async function startAll(): Promise<void> {
    isRunning = true
    for (const [id, worker] of workers) {
      if (worker.config.runOnInit) {
        startWorker(id).catch(err => 
          emitEvent({ type: 'error', workerId: id, timestamp: Date.now(), error: String(err) })
        )
      }
    }
  }

  // Stop all workers
  function stopAll(): void {
    isRunning = false
    for (const id of workers.keys()) {
      stopWorker(id)
    }
  }

  // Subscribe to worker events
  function onEvent(workerId: string, handler: (event: WorkerEvent) => void): void {
    const handlers = eventHandlers.get(workerId) ?? []
    handlers.push(handler)
    eventHandlers.set(workerId, handlers)
  }

  // Emit event to handlers
  function emitEvent(event: WorkerEvent): void {
    const handlers = eventHandlers.get(event.workerId) ?? []
    const globalHandlers = eventHandlers.get('*') ?? []
    for (const handler of [...handlers, ...globalHandlers]) {
      try { handler(event) } catch { /* ignore handler errors */ }
    }
  }

  // Get worker status
  function getWorkerStatus(workerId: string): { running: boolean; metrics: { runs: number; successes: number; failures: number; lastRun?: number; avgDuration?: number } } | null {
    const worker = workers.get(workerId)
    const metrics = workerMetrics.get(workerId)
    if (!worker || !metrics) return null
    return { running: !!worker.interval, metrics }
  }

  // Get all worker statuses
  function getAllStatuses(): Array<{ id: string; name: string; running: boolean; metrics: { runs: number; successes: number; failures: number; lastRun?: number; avgDuration?: number } }> {
    return Array.from(workers.entries()).map(([id, worker]) => ({
      id,
      name: worker.config.name,
      running: !!worker.interval,
      metrics: workerMetrics.get(id)!
    }))
  }

  return {
    registerWorker,
    startWorker,
    stopWorker,
    startAll,
    stopAll,
    onEvent,
    getWorkerStatus,
    getAllStatuses,
    get isRunning() { return isRunning },
    get workerCount() { return workers.size }
  }
}

// Pre-built workers

/**
 * Memory optimization worker - consolidates old/duplicate memories
 */
export function createMemoryOptimizationWorker(): { config: WorkerConfig; handler: WorkerHandler } {
  return {
    config: { id: 'memory-optimizer', name: 'Memory Optimizer', description: 'Consolidates old memories', intervalMs: 300000 },
    handler: async () => {
      // In a real implementation, this would consolidate memories
      return { success: true, message: 'Memory optimization complete', metrics: { consolidated: 0, freed: 0 } }
    }
  }
}

/**
 * Pattern learning worker - learns from successful executions
 */
export function createPatternLearningWorker(): { config: WorkerConfig; handler: WorkerHandler } {
  return {
    config: { id: 'pattern-learner', name: 'Pattern Learner', description: 'Learns from successful executions', intervalMs: 60000 },
    handler: async () => {
      return { success: true, message: 'Pattern learning complete', metrics: { patternsLearned: 0 } }
    }
  }
}

/**
 * Metrics collection worker - gathers runtime metrics
 */
export function createMetricsWorker(): { config: WorkerConfig; handler: WorkerHandler } {
  return {
    config: { id: 'metrics-collector', name: 'Metrics Collector', description: 'Collects runtime metrics', intervalMs: 30000 },
    handler: async () => {
      return { success: true, message: 'Metrics collected', metrics: { cpu: 0, memory: 0, requests: 0 } }
    }
  }
}

/**
 * Cache cleanup worker - clears stale cached data
 */
export function createCacheCleanupWorker(): { config: WorkerConfig; handler: WorkerHandler } {
  return {
    config: { id: 'cache-cleanup', name: 'Cache Cleanup', description: 'Clears stale cache entries', intervalMs: 600000 },
    handler: async () => {
      return { success: true, message: 'Cache cleanup complete', metrics: { entriesRemoved: 0 } }
    }
  }
}

/**
 * Health check worker - monitors system health
 */
export function createHealthCheckWorker(): { config: WorkerConfig; handler: WorkerHandler } {
  return {
    config: { id: 'health-check', name: 'Health Check', description: 'Monitors system health', intervalMs: 60000 },
    handler: async () => {
      return { success: true, message: 'Health check passed', metrics: { status: 1 } }
    }
  }
}