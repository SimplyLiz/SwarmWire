/**
 * Knowledge Graph and Ranked Retrieval System
 * Provides graph-based memory relationships and intelligent ranking
 * Inspired by Ruflo's MemoryGraph with PageRank approach
 */

import type { MemoryItem } from '../types/memory.js'

// Node in the knowledge graph
export interface KnowledgeNode {
  id: string
  label: string
  type: 'concept' | 'entity' | 'pattern' | 'task' | 'agent'
  metadata: Record<string, unknown>
  importance: number  // 0-1, calculated via PageRank
  createdAt: number
}

// Edge in the knowledge graph
export interface KnowledgeEdge {
  sourceId: string
  targetId: string
  relation: string  // e.g., 'related_to', 'depends_on', 'produced_by', 'used_by'
  weight: number    // 0-1
  createdAt: number
}

// Search result with graph-enhanced ranking
export interface GraphSearchResult<T = unknown> {
  item: T
  relevance: number
  graphScore: number  // Contribution from graph structure
  path: KnowledgeEdge[]  // Path through graph to result
  matchedConcepts: string[]
}

// Graph configuration
export interface KnowledgeGraphConfig {
  /** Damping factor for PageRank */
  dampingFactor?: number
  /** Maximum iterations for PageRank convergence */
  maxIterations?: number
  /** Minimum importance threshold */
  minImportance?: number
  /** Enable automatic edge creation */
  autoLink?: boolean
  /** Similarity threshold for auto-linking */
  similarityThreshold?: number
}

/**
 * Create a knowledge graph for memory relationships and ranked retrieval
 */
export function createKnowledgeGraph(config: KnowledgeGraphConfig = {}) {
  const {
    dampingFactor = 0.85,
    maxIterations = 100,
    minImportance = 0.001,
    autoLink = true,
    similarityThreshold = 0.7
  } = config

  const nodes: Map<string, KnowledgeNode> = new Map()
  const edges: Map<string, KnowledgeEdge[]> = new Map()  // sourceId -> edges
  const reverseEdges: Map<string, KnowledgeEdge[]> = new Map()  // targetId -> incoming edges
  const adjacencyCache: Map<string, string[]> = new Map()  // For quick neighbor lookup

  return {
    /**
     * Add a node to the graph
     */
    addNode(id: string, label: string, type: KnowledgeNode['type'], metadata: Record<string, unknown> = {}): KnowledgeNode {
      const node: KnowledgeNode = {
        id,
        label,
        type,
        metadata,
        importance: 1 / nodes.size || 1,  // Initial importance
        createdAt: Date.now()
      }
      nodes.set(id, node)
      edges.set(id, [])
      reverseEdges.set(id, [])
      adjacencyCache.clear()  // Invalidate cache
      return node
    },

    /**
     * Add an edge between nodes
     */
    addEdge(sourceId: string, targetId: string, relation: string, weight = 1.0): KnowledgeEdge | null {
      const source = nodes.get(sourceId)
      const target = nodes.get(targetId)
      if (!source || !target) return null

      const edge: KnowledgeEdge = {
        sourceId,
        targetId,
        relation,
        weight,
        createdAt: Date.now()
      }

      edges.get(sourceId)!.push(edge)
      reverseEdges.get(targetId)!.push(edge)
      adjacencyCache.clear()
      
      return edge
    },

    /**
     * Get node by ID
     */
    getNode(id: string): KnowledgeNode | undefined {
      return nodes.get(id)
    },

    /**
     * Get all nodes
     */
    getAllNodes(): KnowledgeNode[] {
      return Array.from(nodes.values())
    },

    /**
     * Get outgoing edges from a node
     */
    getOutgoingEdges(nodeId: string): KnowledgeEdge[] {
      return edges.get(nodeId) ?? []
    },

    /**
     * Get incoming edges to a node
     */
    getIncomingEdges(nodeId: string): KnowledgeEdge[] {
      return reverseEdges.get(nodeId) ?? []
    },

    /**
     * Get neighbors of a node
     */
    getNeighbors(nodeId: string): KnowledgeNode[] {
      const neighborIds = new Set<string>()
      
      for (const edge of this.getOutgoingEdges(nodeId)) {
        neighborIds.add(edge.targetId)
      }
      for (const edge of this.getIncomingEdges(nodeId)) {
        neighborIds.add(edge.sourceId)
      }

      return Array.from(neighborIds).map(id => nodes.get(id)).filter(Boolean) as KnowledgeNode[]
    },

    /**
     * Calculate PageRank importance scores
     */
    calculatePageRank(): Map<string, number> {
      const N = nodes.size
      if (N === 0) return new Map()

      // Initialize importance scores
      const importance = new Map<string, number>()
      for (const node of nodes.keys()) {
        importance.set(node, 1 / N)
      }

      // Iterative PageRank calculation
      for (let iter = 0; iter < maxIterations; iter++) {
        const newImportance = new Map<string, number>()

        for (const [nodeId] of nodes) {
          let sum = 0

          // Sum importance from incoming edges
          for (const edge of reverseEdges.get(nodeId) ?? []) {
            const sourceImportance = importance.get(edge.sourceId) ?? 0
            const outDegree = (edges.get(edge.sourceId) ?? []).length
            if (outDegree > 0) {
              sum += (sourceImportance * edge.weight * dampingFactor) / outDegree
            }
          }

          // Damping factor
          newImportance.set(nodeId, (1 - dampingFactor) / N + sum)
        }

        // Check convergence
        let converged = true
        for (const [nodeId, newScore] of newImportance) {
          const oldScore = importance.get(nodeId) ?? 0
          if (Math.abs(newScore - oldScore) > 0.0001) {
            converged = false
            break
          }
        }

        // Update importance
        for (const [nodeId, score] of newImportance) {
          importance.set(nodeId, score)
        }

        if (converged) break
      }

      // Update node importance values
      for (const [nodeId, score] of importance) {
        const node = nodes.get(nodeId)
        if (node) node.importance = score
      }

      return importance
    },

    /**
     * Search with graph-enhanced ranking
     */
    search<T>(
      items: T[],
      query: string,
      itemToLabel: (item: T) => string,
      getItemId: (item: T) => string
    ): GraphSearchResult<T>[] {
      // Calculate PageRank if not done recently
      const importance = this.calculatePageRank()

      // Score each item
      const results: GraphSearchResult<T>[] = []

      for (const item of items) {
        const label = itemToLabel(item)
        const itemId = getItemId(item)
        const node = nodes.get(itemId)

        // Base text relevance (simplified)
        const queryLower = query.toLowerCase()
        const labelLower = label.toLowerCase()
        const textScore = labelLower.includes(queryLower) 
          ? queryLower.length / labelLower.length 
          : 0

        // Graph score from node importance
        const graphScore = node ? importance.get(node.id) ?? 0 : 0

        // Combined score
        const relevance = (textScore * 0.6) + (graphScore * 0.4)

        if (relevance > 0 || node) {
          // Find path through graph if connected
          const path = this.findPath(itemId, query)

          // Find matched concepts
          const matchedConcepts = this.findConnectedConcepts(itemId, query)

          results.push({
            item,
            relevance,
            graphScore,
            path,
            matchedConcepts
          })
        }
      }

      // Sort by relevance descending
      return results.sort((a, b) => b.relevance - a.relevance)
    },

    /**
     * Find path between nodes (simplified BFS)
     */
    findPath(fromId: string, toQuery: string): KnowledgeEdge[] {
      // Find target node matching query
      let targetId = ''
      for (const [id, node] of nodes) {
        if (node.label.toLowerCase().includes(toQuery.toLowerCase())) {
          targetId = id
          break
        }
      }
      if (!targetId) return []

      // BFS for shortest path
      const visited = new Set<string>([fromId])
      const queue: Array<{ id: string; path: KnowledgeEdge[] }> = [{ id: fromId, path: [] }]

      while (queue.length > 0) {
        const { id, path } = queue.shift()!
        
        if (id === targetId) return path

        for (const edge of edges.get(id) ?? []) {
          if (!visited.has(edge.targetId)) {
            visited.add(edge.targetId)
            queue.push({ id: edge.targetId, path: [...path, edge] })
          }
        }
      }

      return []
    },

    /**
     * Find concepts connected to a node that match a query
     */
    findConnectedConcepts(nodeId: string, query: string): string[] {
      const concepts: string[] = []
      const queryLower = query.toLowerCase()

      const neighbors = this.getNeighbors(nodeId)
      for (const neighbor of neighbors) {
        if (neighbor.label.toLowerCase().includes(queryLower) || 
            neighbor.type === 'concept') {
          concepts.push(neighbor.label)
        }
      }

      return concepts.slice(0, 5)  // Limit to top 5
    },

    /**
     * Auto-link similar nodes
     */
    autoLinkNodes(similarityFn?: (a: KnowledgeNode, b: KnowledgeNode) => number): number {
      let linksCreated = 0

      const nodeArray = Array.from(nodes.values())
      
      for (let i = 0; i < nodeArray.length; i++) {
        for (let j = i + 1; j < nodeArray.length; j++) {
          const nodeA = nodeArray[i]!
          const nodeB = nodeArray[j]!

          // Calculate similarity
          let similarity = 0
          if (similarityFn) {
            similarity = similarityFn(nodeA, nodeB)
          } else {
            // Simple label-based similarity
            const labelA = nodeA.label.toLowerCase()
            const labelB = nodeB.label.toLowerCase()
            const setA = new Set(labelA.split(/\s+/))
            const setB = new Set(labelB.split(/\s+/))
            const intersection = new Set([...setA].filter(x => setB.has(x)))
            const union = new Set([...setA, ...setB])
            similarity = union.size > 0 ? intersection.size / union.size : 0
          }

          if (similarity >= similarityThreshold) {
            this.addEdge(nodeA.id, nodeB.id, 'related_to', similarity)
            linksCreated++
          }
        }
      }

      return linksCreated
    },

    /**
     * Get graph statistics
     */
    getStats() {
      const edgeCount = Array.from(edges.values()).reduce((sum, arr) => sum + arr.length, 0)
      const types = new Map<KnowledgeNode['type'], number>()
      
      for (const node of nodes.values()) {
        types.set(node.type, (types.get(node.type) ?? 0) + 1)
      }

      return {
        nodeCount: nodes.size,
        edgeCount,
        density: nodes.size > 1 ? edgeCount / (nodes.size * (nodes.size - 1)) : 0,
        types: Object.fromEntries(types)
      }
    },

    /**
     * Remove a node and its edges
     */
    removeNode(id: string): boolean {
      if (!nodes.has(id)) return false

      // Remove outgoing edges
      for (const edge of edges.get(id) ?? []) {
        const targetEdges = reverseEdges.get(edge.targetId) ?? []
        const idx = targetEdges.findIndex(e => e.sourceId === id && e.targetId === edge.targetId)
        if (idx >= 0) targetEdges.splice(idx, 1)
      }

      // Remove incoming edges
      for (const edge of reverseEdges.get(id) ?? []) {
        const sourceEdges = edges.get(edge.sourceId) ?? []
        const idx = sourceEdges.findIndex(e => e.sourceId === edge.sourceId && e.targetId === id)
        if (idx >= 0) sourceEdges.splice(idx, 1)
      }

      nodes.delete(id)
      edges.delete(id)
      reverseEdges.delete(id)
      adjacencyCache.clear()
      
      return true
    },

    /**
     * Export graph as JSON
     */
    exportJSON(): string {
      return JSON.stringify({
        nodes: Array.from(nodes.values()),
        edges: Array.from(edges.values()).flat()
      }, null, 2)
    },

    /**
     * Import graph from JSON
     */
    importJSON(json: string): boolean {
      try {
        const data = JSON.parse(json)
        
        // Clear existing
        nodes.clear()
        edges.clear()
        reverseEdges.clear()

        // Import nodes
        for (const node of data.nodes ?? []) {
          this.addNode(node.id, node.label, node.type, node.metadata)
          const existing = nodes.get(node.id)
          if (existing) existing.importance = node.importance ?? 1 / nodes.size
        }

        // Import edges
        for (const edge of data.edges ?? []) {
          this.addEdge(edge.sourceId, edge.targetId, edge.relation, edge.weight)
        }

        return true
      } catch {
        return false
      }
    }
  }
}

/**
 * Create a graph from memory items
 */
export function createGraphFromMemory(items: MemoryItem[]): ReturnType<typeof createKnowledgeGraph> {
  const graph = createKnowledgeGraph()

  // Add nodes for each memory item
  for (const item of items) {
    const meta = item.meta as Record<string, unknown>
    graph.addNode(item.key, typeof item.value === 'string' ? item.value : item.key, 'pattern', meta)
  }

  // Auto-link based on similarity
  graph.autoLinkNodes()

  // Calculate initial PageRank
  graph.calculatePageRank()

  return graph
}