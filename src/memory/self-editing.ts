/**
 * Self-Editing Memory Blocks (Letta/MemGPT-inspired).
 *
 * Agents can read and mutate named memory blocks at runtime. Each block is
 * a bounded, labeled text section the agent explicitly updates mid-execution.
 * Changes are versioned so the agent can review its own edits.
 *
 * Reference: Letta (MemGPT) "in-context stateful memory" blocks.
 */

import type { MemoryBackend, StoreMeta, QueryOpts, MemoryItem } from '../types/memory.js'

export interface MemoryBlock {
  name: string
  content: string
  /** Max chars allowed in this block. Default 2000. */
  maxChars: number
  createdAt: number
  updatedAt: number
  version: number
}

export interface BlockEdit {
  blockName: string
  prevContent: string
  nextContent: string
  timestamp: number
  version: number
  editedBy?: string
}

export interface SelfEditingMemoryConfig {
  /** Blocks to initialize. The agent can create more at runtime. */
  blocks?: Array<{ name: string; content?: string; maxChars?: number }>
  /** Max history entries per block. Default 20. */
  maxHistoryPerBlock?: number
  /** If true, throw when an edit would exceed maxChars. Default false (truncate). */
  strictSizing?: boolean
}

export class SelfEditingMemory implements MemoryBackend {
  private readonly blocks: Map<string, MemoryBlock> = new Map()
  private readonly history: Map<string, BlockEdit[]> = new Map()
  private readonly maxHistoryPerBlock: number
  private readonly strictSizing: boolean

  constructor(config: SelfEditingMemoryConfig = {}) {
    this.maxHistoryPerBlock = config.maxHistoryPerBlock ?? 20
    this.strictSizing = config.strictSizing ?? false

    for (const def of config.blocks ?? []) {
      this.createBlock(def.name, def.content ?? '', def.maxChars)
    }
  }

  /** Create a new named block (or reset existing) */
  createBlock(name: string, initialContent = '', maxChars = 2000): MemoryBlock {
    const block: MemoryBlock = {
      name,
      content: initialContent.slice(0, maxChars),
      maxChars,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 0,
    }
    this.blocks.set(name, block)
    this.history.set(name, [])
    return block
  }

  /** Get a block by name */
  getBlock(name: string): MemoryBlock | undefined {
    return this.blocks.get(name)
  }

  /** Replace the entire content of a block */
  write(name: string, content: string, editedBy?: string): MemoryBlock {
    let block = this.blocks.get(name)
    if (!block) block = this.createBlock(name)

    if (this.strictSizing && content.length > block.maxChars) {
      throw new Error(`Block "${name}" max size is ${block.maxChars} chars, got ${content.length}`)
    }

    const prevContent = block.content
    block.content = content.slice(0, block.maxChars)
    block.updatedAt = Date.now()
    block.version++

    const edit: BlockEdit = {
      blockName: name,
      prevContent,
      nextContent: block.content,
      timestamp: block.updatedAt,
      version: block.version,
      editedBy,
    }

    const hist = this.history.get(name) ?? []
    hist.push(edit)
    if (hist.length > this.maxHistoryPerBlock) hist.shift()
    this.history.set(name, hist)

    return block
  }

  /** Append text to a block (respects maxChars) */
  append(name: string, text: string, editedBy?: string): MemoryBlock {
    const block = this.blocks.get(name)
    const current = block?.content ?? ''
    return this.write(name, current + text, editedBy)
  }

  /** Replace a substring within a block */
  patch(name: string, search: string, replace: string, editedBy?: string): MemoryBlock {
    const block = this.blocks.get(name)
    if (!block) throw new Error(`Block "${name}" not found`)
    return this.write(name, block.content.replace(search, replace), editedBy)
  }

  /** Get edit history for a block */
  getHistory(name: string): BlockEdit[] {
    return this.history.get(name) ?? []
  }

  /** Revert a block to the content it had at the given version */
  revert(name: string, version: number): MemoryBlock | undefined {
    const hist = this.history.get(name) ?? []
    const edit = hist.find((e) => e.version === version)
    if (!edit) return undefined
    // nextContent is the content that was written at this version
    return this.write(name, edit.nextContent, 'revert')
  }

  /** Format all blocks as a context string (for injecting into agent prompts) */
  toContextString(): string {
    const lines: string[] = []
    for (const block of this.blocks.values()) {
      lines.push(`<memory name="${block.name}" version="${block.version}">`)
      lines.push(block.content)
      lines.push(`</memory>`)
    }
    return lines.join('\n')
  }

  /** List all block names */
  listBlocks(): string[] {
    return [...this.blocks.keys()]
  }

  // ─── MemoryBackend interface ───

  async store(key: string, value: unknown, _meta: StoreMeta): Promise<void> {
    const content = typeof value === 'string' ? value : JSON.stringify(value)
    this.write(key, content)
  }

  async query(query: string, opts?: QueryOpts): Promise<MemoryItem[]> {
    const lower = query.toLowerCase()
    const results: Array<{ block: MemoryBlock; score: number }> = []

    for (const block of this.blocks.values()) {
      const content = block.content.toLowerCase()
      // Simple keyword overlap scoring
      const words = lower.split(/\W+/).filter((w) => w.length > 2)
      const matches = words.filter((w) => content.includes(w)).length
      const score = words.length > 0 ? matches / words.length : 0
      if (score > 0) results.push({ block, score })
    }

    results.sort((a, b) => b.score - a.score)

    let filtered = results
    if (opts?.minRelevance !== undefined) filtered = filtered.filter((r) => r.score >= opts.minRelevance!)
    if (opts?.maxItems !== undefined) filtered = filtered.slice(0, opts.maxItems)

    return filtered.map(({ block, score }) => ({
      key: block.name,
      value: block.content,
      relevance: score,
      meta: { tags: [block.name] },
      storedAt: block.createdAt,
    }))
  }

  async forget(key: string): Promise<void> {
    this.blocks.delete(key)
    this.history.delete(key)
  }

  stats(): { blockCount: number; totalChars: number; totalEdits: number } {
    let totalChars = 0
    let totalEdits = 0
    for (const block of this.blocks.values()) totalChars += block.content.length
    for (const hist of this.history.values()) totalEdits += hist.length
    return { blockCount: this.blocks.size, totalChars, totalEdits }
  }
}
