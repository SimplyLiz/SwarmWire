/**
 * Graph State Machine — LangGraph / PydanticAI / Google ADK inspired.
 *
 * Models agent workflows as an explicit directed graph where nodes are
 * processing steps and edges carry conditional routing logic. Supports
 * cycles (retry loops), branching, and termination conditions.
 *
 * Unlike the DAG executor (which forbids cycles), this is designed for
 * iterative loops: research → evaluate → refine → evaluate → ...
 */

export interface StateNode<TState = Record<string, unknown>> {
  name: string
  /** Process current state, return updated state */
  execute(state: TState, ctx: StateMachineContext): Promise<TState>
}

export interface StateEdge<TState = Record<string, unknown>> {
  from: string
  /** Resolve to target node name, or '__end__' to terminate */
  to: string | ((state: TState) => string | Promise<string>)
  /** Optional label for visualization */
  label?: string
}

export interface StateMachineContext {
  /** Current graph iteration count */
  iteration: number
  /** History of visited nodes (in order) */
  history: string[]
  /** Emit a trace event */
  trace(event: string, data?: unknown): void
}

export interface StateMachineConfig<TState = Record<string, unknown>> {
  nodes: StateNode<TState>[]
  edges: StateEdge<TState>[]
  /** Entry node name */
  entryNode: string
  /** Max iterations before forcing termination. Default 100 */
  maxIterations?: number
  /** Optional trace function */
  onTrace?: (event: string, data?: unknown) => void
}

export interface StateMachineResult<TState = Record<string, unknown>> {
  finalState: TState
  exitNode: string
  iterations: number
  visitHistory: string[]
  terminated: 'completed' | 'max_iterations' | 'error'
  error?: string
}

export const END = '__end__'

export class StateMachine<TState = Record<string, unknown>> {
  private readonly nodeMap: Map<string, StateNode<TState>>
  private readonly edgeMap: Map<string, StateEdge<TState>[]>
  private readonly entryNode: string
  private readonly maxIterations: number
  private readonly onTrace?: (event: string, data?: unknown) => void

  constructor(config: StateMachineConfig<TState>) {
    this.entryNode = config.entryNode
    this.maxIterations = config.maxIterations ?? 100
    this.onTrace = config.onTrace

    this.nodeMap = new Map(config.nodes.map((n) => [n.name, n]))
    this.edgeMap = new Map()
    for (const edge of config.edges) {
      const existing = this.edgeMap.get(edge.from) ?? []
      existing.push(edge)
      this.edgeMap.set(edge.from, existing)
    }
  }

  /** Run the state machine from entry node until END or max iterations */
  async run(initialState: TState): Promise<StateMachineResult<TState>> {
    let state = { ...initialState }
    let currentNode = this.entryNode
    const history: string[] = []
    let iteration = 0

    while (currentNode !== END && iteration < this.maxIterations) {
      const node = this.nodeMap.get(currentNode)
      if (!node) {
        return {
          finalState: state,
          exitNode: currentNode,
          iterations: iteration,
          visitHistory: history,
          terminated: 'error',
          error: `Node not found: ${currentNode}`,
        }
      }

      history.push(currentNode)
      iteration++

      const ctx: StateMachineContext = {
        iteration,
        history: [...history],
        trace: (event, data) => this.onTrace?.(event, data),
      }

      try {
        this.onTrace?.('node.enter', { node: currentNode, iteration })
        state = await node.execute(state, ctx)
        this.onTrace?.('node.exit', { node: currentNode, iteration })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          finalState: state,
          exitNode: currentNode,
          iterations: iteration,
          visitHistory: history,
          terminated: 'error',
          error: msg,
        }
      }

      // Resolve next node
      const edges = this.edgeMap.get(currentNode) ?? []
      if (edges.length === 0) {
        currentNode = END
        break
      }

      // If multiple edges, use first one with a conditional `to`
      // Resolve each edge's target
      let nextNode = END
      for (const edge of edges) {
        const target = typeof edge.to === 'function' ? await edge.to(state) : edge.to
        if (target !== END) {
          nextNode = target
          break
        }
      }

      // If all edges resolved to END, we're done
      if (nextNode === END && edges.some((e) => e.to !== END && typeof e.to !== 'function')) {
        // At least one static edge to a real node — take the first one
        const staticEdge = edges.find((e) => typeof e.to === 'string' && e.to !== END)
        if (staticEdge) nextNode = staticEdge.to as string
      }

      currentNode = nextNode
    }

    return {
      finalState: state,
      exitNode: currentNode,
      iterations: iteration,
      visitHistory: history,
      terminated: iteration >= this.maxIterations ? 'max_iterations' : 'completed',
    }
  }

  /** Add a node at runtime */
  addNode(node: StateNode<TState>): void {
    this.nodeMap.set(node.name, node)
  }

  /** Add an edge at runtime */
  addEdge(edge: StateEdge<TState>): void {
    const existing = this.edgeMap.get(edge.from) ?? []
    existing.push(edge)
    this.edgeMap.set(edge.from, existing)
  }

  /** Visualize as DOT format for debugging */
  toDot(): string {
    const lines = ['digraph StateMachine {']
    for (const [from, edges] of this.edgeMap) {
      for (const edge of edges) {
        const to = typeof edge.to === 'function' ? '(conditional)' : edge.to
        const label = edge.label ? ` [label="${edge.label}"]` : ''
        lines.push(`  "${from}" -> "${to}"${label};`)
      }
    }
    lines.push('}')
    return lines.join('\n')
  }
}

/**
 * Build a simple linear state machine from an ordered list of nodes.
 * Useful when you want sequential processing without explicit edge definitions.
 */
export function buildLinearStateMachine<TState>(
  nodes: StateNode<TState>[],
  config?: Pick<StateMachineConfig<TState>, 'maxIterations' | 'onTrace'>,
): StateMachine<TState> {
  if (nodes.length === 0) throw new Error('At least one node required')

  const edges: StateEdge<TState>[] = []
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: nodes[i]!.name, to: nodes[i + 1]!.name })
  }
  edges.push({ from: nodes[nodes.length - 1]!.name, to: END })

  return new StateMachine({
    nodes,
    edges,
    entryNode: nodes[0]!.name,
    ...config,
  })
}
