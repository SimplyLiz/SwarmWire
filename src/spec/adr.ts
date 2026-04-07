/**
 * Architecture Decision Records (ADRs)
 * Framework for spec-driven development with living documentation
 * Inspired by Ruflo's ADR approach
 */

export type ADRStatus = 'proposed' | 'accepted' | 'deprecated' | 'superseded' | 'rejected'

export interface ADR {
  id: string
  title: string
  status: ADRStatus
  date: string
  authors: string[]
  
  // Context
  context: string
  decision: string
  consequences: string
  
  // Optional fields
  supersededBy?: string
  replaces?: string
  notes?: string
  tags?: string[]
}

export interface ADRParserOptions {
  /** Directory containing ADR files */
  adrDir?: string
  /** File extension for ADR files */
  fileExtension?: string
  /** Whether to auto-number ADRs */
  autoNumber?: boolean
}

// ADR file format (Markdown-based)
const ADR_TEMPLATE = `# {title}

## Status: {status}

Date: {date}
Authors: {authors}

## Context

{context}

## Decision

{decision}

## Consequences

{consequences}

{supersedes}
{replaces}
{notes}
`

export function createADRFramework(options: ADRParserOptions = {}) {
  const {
    adrDir = './docs/adrs',
    fileExtension = '.md',
    autoNumber = true
  } = options

  // In-memory ADR storage
  const adrs: Map<string, ADR> = new Map()
  let adrCounter = 1

  return {
    /**
     * Create a new ADR
     */
    create(data: Omit<ADR, 'id' | 'date'>): ADR {
      const id = autoNumber ? `ADR-${String(adrCounter++).padStart(3, '0')}` : `ADR-${Date.now()}`
      const adr: ADR = {
        ...data,
        id,
        date: new Date().toISOString().split('T')[0] as string
      }
      adrs.set(id, adr)
      return adr
    },

    /**
     * Get an ADR by ID
     */
    get(id: string): ADR | undefined {
      return adrs.get(id)
    },

    /**
     * Get all ADRs
     */
    getAll(): ADR[] {
      return Array.from(adrs.values()).sort((a, b) => a.id.localeCompare(b.id))
    },

    /**
     * Get ADRs by status
     */
    getByStatus(status: ADRStatus): ADR[] {
      return this.getAll().filter(adr => adr.status === status)
    },

    /**
     * Get ADRs by tag
     */
    getByTag(tag: string): ADR[] {
      return this.getAll().filter(adr => adr.tags?.includes(tag))
    },

    /**
     * Update an ADR's status
     */
    updateStatus(id: string, status: ADRStatus, supersededBy?: string): ADR | undefined {
      const adr = adrs.get(id)
      if (!adr) return undefined

      adr.status = status
      if (supersededBy) {
        adr.supersededBy = supersededBy
        
        // Update the superseding ADR
        const superseding = adrs.get(supersededBy)
        if (superseding) {
          superseding.replaces = id
        }
      }

      return adr
    },

    /**
     * Delete an ADR
     */
    delete(id: string): boolean {
      return adrs.delete(id)
    },

    /**
     * Generate Markdown for an ADR
     */
    toMarkdown(adr: ADR): string {
      let md = ADR_TEMPLATE
        .replace('{title}', adr.title)
        .replace('{status}', adr.status.toUpperCase())
        .replace('{date}', adr.date)
        .replace('{authors}', adr.authors.join(', '))
        .replace('{context}', adr.context)
        .replace('{decision}', adr.decision)
        .replace('{consequences}', adr.consequences)

      if (adr.supersededBy) {
        md += `\n## Superseded By\n\n${adr.supersededBy}\n`
      }
      if (adr.replaces) {
        md += `\n## Replaces\n\n${adr.replaces}\n`
      }
      if (adr.notes) {
        md += `\n## Notes\n\n${adr.notes}\n`
      }
      if (adr.tags && adr.tags.length > 0) {
        md += `\n## Tags\n\n${adr.tags.join(', ')}\n`
      }

      return md
    },

    /**
     * Parse an ADR from Markdown
     */
    fromMarkdown(markdown: string): ADR | null {
      try {
        const titleMatch = markdown.match(/^# (.+)$/m)
        const statusMatch = markdown.match(/^## Status: (.+)$/m)
        const dateMatch = markdown.match(/^Date: (.+)$/m)
        const authorsMatch = markdown.match(/^Authors: (.+)$/m)
        const contextMatch = markdown.match(/^## Context\n\n([\s\S]*?)^## Decision/m)
        const decisionMatch = markdown.match(/^## Decision\n\n([\s\S]*?)^## Consequences/m)
        const consequencesMatch = markdown.match(/^## Consequences\n\n([\s\S]*?)(?:^##|$)/m)

        if (!titleMatch || !statusMatch || !dateMatch || !contextMatch || !decisionMatch || !consequencesMatch) {
          return null
        }

        return {
          id: '', // Will be assigned when added
          title: titleMatch[1]!,
          status: statusMatch[1]!.toLowerCase() as ADRStatus,
          date: dateMatch[1]!,
          authors: authorsMatch ? authorsMatch[1]!.split(',').map(a => a.trim()) : [],
          context: contextMatch[1]!.trim(),
          decision: decisionMatch[1]!.trim(),
          consequences: consequencesMatch[1]!.trim()
        }
      } catch {
        return null
      }
    },

    /**
     * Check if code follows a specific ADR
     */
    checkCompliance(adrId: string, code: string): { compliant: boolean; issues: string[] } {
      const adr = adrs.get(adrId)
      if (!adr) return { compliant: false, issues: [`ADR ${adrId} not found`] }

      const issues: string[] = []
      
      // Simple keyword-based compliance check (would be more sophisticated in production)
      const requiredKeywords = adr.decision.split(' ')
        .filter(word => word.length > 3 && !['should', 'must', 'will', 'have'].includes(word.toLowerCase()))

      for (const keyword of requiredKeywords.slice(0, 5)) {
        if (!code.toLowerCase().includes(keyword.toLowerCase())) {
          issues.push(`Expected to find '${keyword}' based on ADR decision`)
        }
      }

      return {
        compliant: issues.length === 0,
        issues
      }
    },

    /**
     * Get compliance percentage for all active ADRs
     */
    getOverallCompliance(): number {
      const active = this.getByStatus('accepted')
      if (active.length === 0) return 100
      
      // Simplified - in production would actually check code
      return 100 // Placeholder
    },

    /**
     * Export all ADRs as JSON
     */
    exportJSON(): string {
      return JSON.stringify(this.getAll(), null, 2)
    },

    /**
     * Import ADRs from JSON
     */
    importJSON(json: string): number {
      try {
        const imported = JSON.parse(json) as ADR[]
        for (const adr of imported) {
          adrs.set(adr.id, adr)
        }
        return imported.length
      } catch {
        return 0
      }
    }
  }
}

/**
 * Create a standard ADR for common architectural decisions
 */
export function createStandardADR(
  title: string,
  context: string,
  decision: string,
  consequences: string,
  authors: string[] = ['SwarmWire']
): Omit<ADR, 'id' | 'date'> {
  return {
    title,
    status: 'proposed',
    authors,
    context,
    decision,
    consequences,
    tags: ['standard']
  }
}

// Pre-built common ADRs
export const COMMON_ADRS = {
  memoryStrategy: (): Omit<ADR, 'id' | 'date'> => ({
    title: 'ADR-001: Unified Memory Service Strategy',
    status: 'proposed',
    authors: ['SwarmWire'],
    context: 'SwarmWire needs a memory strategy that balances simplicity with powerful retrieval capabilities.',
    decision: 'Use a layered approach: basic MemoryBackend interface for simplicity, with optional VectorMemory and SelfLearningMemory for advanced use cases. Default to in-memory for development, ANCS for production.',
    consequences: 'Users get progressive disclosure - simple key-value by default, can opt into vector search and self-learning as needed.',
    tags: ['memory', 'architecture']
  }),

  modelRouting: (): Omit<ADR, 'id' | 'date'> => ({
    title: 'ADR-002: Intelligent Model Routing',
    status: 'proposed',
    authors: ['SwarmWire'],
    context: 'Different tasks require different model capabilities. Using premium models for simple tasks wastes resources.',
    decision: 'Implement 3-tier routing: cheap for simple transforms, standard for typical tasks, premium/reasoning for complex analysis. Route based on task complexity analysis.',
    consequences: 'Estimated 50-75% cost reduction for typical workloads while maintaining quality.',
    tags: ['optimization', 'routing']
  }),

  securityApproach: (): Omit<ADR, 'id' | 'date'> => ({
    title: 'ADR-003: Security-first Input Handling',
    status: 'proposed',
    authors: ['SwarmWire'],
    context: 'Agent systems are vulnerable to injection attacks, prompt manipulation, and data leakage.',
    decision: 'Integrate threat detection at input boundaries. Provide configurable guardrails with sensible defaults. Support custom security policies.',
    consequences: 'Users can enable/disable specific security checks. Auto-sanitization available for trusted environments.',
    tags: ['security', 'guardrails']
  })
}