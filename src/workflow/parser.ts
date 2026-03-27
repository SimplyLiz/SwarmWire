/**
 * YAML Workflow parser.
 * Parses a simple YAML subset (no anchors/aliases needed) into WorkflowDef.
 * Uses a minimal hand-rolled parser to avoid adding a yaml dependency.
 */

export interface WorkflowDef {
  name: string
  version: string
  description?: string
  inputs: Record<string, WorkflowInputDef>
  outputs?: Record<string, string>
  steps: WorkflowStepDef[]
}

export interface WorkflowInputDef {
  type: 'string' | 'number' | 'boolean' | 'object'
  required?: boolean
  default?: unknown
}

export interface WorkflowStepDef {
  id: string
  type: 'llm' | 'tool' | 'composite'
  agent?: string
  modelTier?: string
  prompt?: string
  tool?: string
  inputs?: Record<string, string>
  output?: string
  dependencies?: string[]
  optional?: boolean
  retries?: number
  timeoutMs?: number
}

/**
 * Parse a YAML workflow string into a WorkflowDef.
 * Supports the subset needed for workflow definitions.
 */
export function parseWorkflow(yaml: string): WorkflowDef {
  const lines = yaml.split('\n')
  const root = parseYamlLines(lines)

  if (!root.name || typeof root.name !== 'string') {
    throw new WorkflowParseError('Workflow must have a "name" field')
  }

  const steps = parseSteps(root.steps)
  validateSteps(steps)

  return {
    name: root.name as string,
    version: (root.version as string) ?? '1.0.0',
    description: root.description as string | undefined,
    inputs: parseInputs(root.inputs),
    outputs: root.outputs as Record<string, string> | undefined,
    steps,
  }
}

function parseInputs(raw: unknown): Record<string, WorkflowInputDef> {
  if (!raw || typeof raw !== 'object') return {}
  const result: Record<string, WorkflowInputDef> = {}
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val === 'string') {
      result[key] = { type: val as WorkflowInputDef['type'] }
    } else if (typeof val === 'object' && val !== null) {
      const obj = val as Record<string, unknown>
      result[key] = {
        type: (obj.type as string ?? 'string') as WorkflowInputDef['type'],
        required: obj.required as boolean | undefined,
        default: obj.default,
      }
    }
  }
  return result
}

function parseSteps(raw: unknown): WorkflowStepDef[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item, i) => {
    if (typeof item !== 'object' || item === null) {
      throw new WorkflowParseError(`Step ${i} is not an object`)
    }
    const obj = item as Record<string, unknown>
    return {
      id: (obj.id as string) ?? `step_${i + 1}`,
      type: (obj.type as string ?? 'llm') as WorkflowStepDef['type'],
      agent: obj.agent as string | undefined,
      modelTier: obj.model_tier as string | undefined,
      prompt: obj.prompt as string | undefined,
      tool: obj.tool as string | undefined,
      inputs: obj.inputs as Record<string, string> | undefined,
      output: obj.output as string | undefined,
      dependencies: obj.dependencies as string[] | undefined,
      optional: obj.optional as boolean | undefined,
      retries: obj.retries as number | undefined,
      timeoutMs: obj.timeout_ms as number | undefined,
    }
  })
}

function validateSteps(steps: WorkflowStepDef[]): void {
  const ids = new Set(steps.map((s) => s.id))

  for (const step of steps) {
    if (step.dependencies) {
      for (const dep of step.dependencies) {
        if (!ids.has(dep)) {
          throw new WorkflowParseError(`Step "${step.id}" depends on unknown step "${dep}"`)
        }
      }
    }
    if (step.type === 'llm' && !step.prompt && !step.agent) {
      throw new WorkflowParseError(`LLM step "${step.id}" must have a prompt or agent`)
    }
    if (step.type === 'tool' && !step.tool) {
      throw new WorkflowParseError(`Tool step "${step.id}" must have a tool field`)
    }
  }

  // Check for cycles
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function dfs(id: string): void {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new WorkflowParseError(`Cycle detected involving step "${id}"`)
    visiting.add(id)
    const step = steps.find((s) => s.id === id)
    for (const dep of step?.dependencies ?? []) dfs(dep)
    visiting.delete(id)
    visited.add(id)
  }

  for (const step of steps) dfs(step.id)
}

/**
 * Minimal YAML parser — handles the subset needed for workflow defs.
 * Maps, arrays (- prefix), scalars, multiline strings (|).
 */
function parseYamlLines(lines: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('#')) { i++; continue }

    const indent = line.length - line.trimStart().length
    const colonIdx = trimmed.indexOf(':')

    if (colonIdx === -1) { i++; continue }

    const key = trimmed.slice(0, colonIdx).trim()
    const valueStr = trimmed.slice(colonIdx + 1).trim()

    if (valueStr === '' || valueStr === '|') {
      // Could be a nested object, array, or multiline string
      const childLines: string[] = []
      const childIndent = indent + 2
      i++
      while (i < lines.length) {
        const cl = lines[i]!
        const ci = cl.length - cl.trimStart().length
        if (cl.trim() === '' || ci >= childIndent) {
          childLines.push(cl)
          i++
        } else break
      }

      if (valueStr === '|') {
        result[key] = childLines.map((l) => l.trim()).join('\n').trim()
      } else if (childLines.length > 0 && childLines.some((l) => l.trim().startsWith('- '))) {
        result[key] = parseYamlArray(childLines)
      } else if (childLines.length > 0) {
        result[key] = parseYamlLines(childLines)
      } else {
        result[key] = null
      }
    } else {
      result[key] = parseScalar(valueStr)
      i++
    }
  }

  return result
}

function parseYamlArray(lines: string[]): unknown[] {
  const items: unknown[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!
    const trimmed = line.trim()

    if (trimmed === '' || trimmed.startsWith('#')) { i++; continue }

    if (trimmed.startsWith('- ')) {
      const itemContent = trimmed.slice(2)
      const colonIdx = itemContent.indexOf(':')

      if (colonIdx > -1) {
        // Object item — collect all properties
        const obj: Record<string, unknown> = {}
        const firstKey = itemContent.slice(0, colonIdx).trim()
        const firstVal = itemContent.slice(colonIdx + 1).trim()
        obj[firstKey] = parseScalar(firstVal)

        const baseIndent = line.length - line.trimStart().length + 2
        i++
        while (i < lines.length) {
          const propLine = lines[i]!
          const propIndent = propLine.length - propLine.trimStart().length
          const propTrimmed = propLine.trim()
          if (propTrimmed === '' || propTrimmed.startsWith('#')) { i++; continue }
          if (propIndent >= baseIndent && !propTrimmed.startsWith('- ')) {
            const pColon = propTrimmed.indexOf(':')
            if (pColon > -1) {
              const pKey = propTrimmed.slice(0, pColon).trim()
              const pValStr = propTrimmed.slice(pColon + 1).trim()

              if (pValStr === '' || pValStr.startsWith('[') || pValStr === '|') {
                // Inline array or multiline — collect child lines
                const childLines: string[] = []
                i++
                while (i < lines.length) {
                  const cl = lines[i]!
                  const ci = cl.length - cl.trimStart().length
                  if (cl.trim() === '' || ci > propIndent + 2) {
                    childLines.push(cl)
                    i++
                  } else break
                }
                if (pValStr.startsWith('[')) {
                  obj[pKey] = parseInlineArray(pValStr)
                } else if (pValStr === '|') {
                  obj[pKey] = childLines.map((l) => l.trim()).join('\n').trim()
                } else {
                  obj[pKey] = childLines.length > 0 ? parseYamlArray(childLines) : null
                }
              } else {
                obj[pKey] = parseScalar(pValStr)
                i++
              }
            } else { i++ }
          } else break
        }
        items.push(obj)
      } else {
        items.push(parseScalar(itemContent))
        i++
      }
    } else {
      i++
    }
  }

  return items
}

function parseInlineArray(str: string): unknown[] {
  const inner = str.replace(/^\[/, '').replace(/]$/, '').trim()
  if (!inner) return []
  return inner.split(',').map((s) => parseScalar(s.trim()))
}

function parseScalar(str: string): unknown {
  if (str === 'true') return true
  if (str === 'false') return false
  if (str === 'null' || str === '~') return null
  if (/^-?\d+$/.test(str)) return parseInt(str, 10)
  if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str)
  // Strip quotes
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1)
  }
  // Inline array
  if (str.startsWith('[') && str.endsWith(']')) {
    return parseInlineArray(str)
  }
  return str
}

export class WorkflowParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowParseError'
  }
}
