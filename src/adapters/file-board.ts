/**
 * FileBoard — Local file-backed MessageBoard for inter-agent communication.
 *
 * Persists messages to a JSONL file (one JSON object per line, append-only).
 * No external dependencies — works without CognitiveVault, databases, or network.
 *
 * Usage:
 *   const board = new FileBoard()                       // .swarmwire/board.jsonl
 *   const board = new FileBoard({ path: '/tmp/board' }) // custom path
 *   await board.hydrate()                               // load prior messages
 *   board.post('agent-a', '*', 'Found a bug', { type: 'finding' })
 *   await board.flush()
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, statSync, unlinkSync, renameSync, truncateSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { MessageBoard } from '../core/messageboard.js'
import type { Message, MessageType, PostOptions } from '../core/messageboard.js'

export interface FileBoardConfig {
   /** Path to the JSONL file (default: .swarmwire/board.jsonl) */
   path?: string
   /** Session ID for grouping (default: auto-generated) */
   sessionId?: string
   /** Whether to persist (default: true) */
   persist?: boolean
   /** Maximum number of log files to keep (0 = unlimited, default: 5) */
   maxFiles?: number
   /** Maximum size of each log file in bytes before rotating (default: 1MB) */
   maxSizeBytes?: number
   /** Whether to enable compaction on hydrate (default: false) */
   compactOnHydrate?: boolean
   /** Maximum age of messages in milliseconds for compaction (default: 7 days) */
   maxMessageAgeMs?: number
}

interface SerializedMessage {
  id: string
  from: string
  to: string
  content: string
  type: string
  priority: string
  channel?: string
  data?: unknown
  timestamp: number
  sessionId: string
}

export class FileBoard extends MessageBoard {
   private filePath: string
   private sessionId: string
   private shouldPersist: boolean
   private maxFiles: number
   private maxSizeBytes: number
   private compactOnHydrate: boolean
   private maxMessageAgeMs: number
   private writeQueue: Promise<void> = Promise.resolve()

   constructor(config: FileBoardConfig = {}) {
      super()
      this.filePath = resolve(config.path ?? '.swarmwire/board.jsonl')
      this.sessionId = config.sessionId ?? generateSessionId()
      this.shouldPersist = config.persist ?? true
      this.maxFiles = config.maxFiles ?? 5
      this.maxSizeBytes = config.maxSizeBytes ?? 1024 * 1024 // 1MB
      this.compactOnHydrate = config.compactOnHydrate ?? false
      this.maxMessageAgeMs = config.maxMessageAgeMs ?? 7 * 24 * 60 * 60 * 1000 // 7 days

      // Ensure directory exists
      if (this.shouldPersist) {
         const dir = dirname(this.filePath)
         if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true })
         }
      }
   }

   /**
    * Post a message. Appends to JSONL file in the background.
    */
   override post(from: string, to: string | '*', content: string, options: PostOptions = {}): Message {
      const msg = super.post(from, to, content, options)

      if (this.shouldPersist) {
         // Check if we need to rotate logs before writing
         this.maybeRotateLog()
         
         this.writeQueue = this.writeQueue
            .then(() => this.appendMessage(msg))
            .catch((err) => console.warn('[file-board] write failed:', err))
      }

      return msg
   }

   /**
    * Check if log rotation is needed and perform it if necessary.
    * Returns true if rotation occurred.
    */
   private maybeRotateLog(): boolean {
      if (!this.shouldPersist || !existsSync(this.filePath)) {
         return false
      }

      try {
         const stats = statSync(this.filePath)
         if (stats.size < this.maxSizeBytes) {
            return false
         }

         // Rotate logs: shift existing files up, remove oldest if over limit
         for (let i = this.maxFiles - 1; i >= 1; i--) {
            const oldFile = `${this.filePath}.${i}`
            const newFile = `${this.filePath}.${i + 1}`
            if (existsSync(oldFile)) {
               if (existsSync(newFile)) {
                  unlinkSync(newFile)
               }
               renameSync(oldFile, newFile)
            }
         }

         // Move current file to .1
         const rotatedFile = `${this.filePath}.1`
         if (existsSync(rotatedFile)) {
            unlinkSync(rotatedFile)
         }
         renameSync(this.filePath, rotatedFile)

         // Truncate the rotated file to prevent infinite growth in edge cases
         truncateSync(this.filePath)
         
         return true
      } catch (err) {
         console.warn('[file-board] log rotation failed:', err)
         return false
      }
   }

   /**
    * Load messages from the JSONL file into the in-memory board.
    * Optionally filter by session ID.
    */
   async hydrate(sessionId?: string): Promise<number> {
      if (!existsSync(this.filePath)) return 0

      const filterSession = sessionId ?? undefined // undefined = load all
      let count = 0

      try {
         const content = readFileSync(this.filePath, 'utf-8')
         const lines = content.split('\n').filter((l) => l.trim())

         for (const line of lines) {
            try {
               const msg = JSON.parse(line) as SerializedMessage
               if (filterSession && msg.sessionId !== filterSession) continue

               super.post(msg.from, msg.to, msg.content, {
                  type: msg.type as MessageType,
                  priority: msg.priority as Message['priority'],
                  channel: msg.channel,
                  data: { ...(msg.data as object ?? {}), _hydrated: true, _fileId: msg.id },
               })
               count++
            } catch {
               // Skip malformed lines
            }
         }
      } catch (err) {
         console.warn('[file-board] hydrate failed:', err)
      }

      return count
   }

   /** Wait for all pending writes to complete. */
   async flush(): Promise<void> {
      await this.writeQueue
   }

   /** Get the session ID. */
   get session(): string {
      return this.sessionId
   }

   /** Get the file path. */
   get path(): string {
      return this.filePath
   }

   // --- Private ---

    private appendMessage(msg: Message): void {
       const serialized: SerializedMessage = {
          id: msg.id,
          from: msg.from,
          to: msg.to,
          content: msg.content,
          type: msg.type,
          priority: msg.priority,
          channel: msg.channel,
          data: msg.data,
          timestamp: msg.timestamp,
          sessionId: this.sessionId
       }
       appendFileSync(this.filePath, JSON.stringify(serialized) + '\n')
    }
}

function generateSessionId(): string {
   const date = new Date().toISOString().slice(0, 10)
   const hex = Math.random().toString(16).slice(2, 6)
   return `${date}-${hex}`
}