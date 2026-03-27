import { describe, it, expect } from 'vitest'
import { parseWorkflow, WorkflowParseError } from '../../src/workflow/parser.js'
import { compileWorkflow } from '../../src/workflow/compiler.js'
import { createAgent } from '../../src/core/agent-factory.js'

const BASIC_WORKFLOW = `
name: research-and-summarize
version: 1.0.0
description: Research a topic and produce a summary

inputs:
  topic: string
  depth: string

steps:
  - id: research
    type: llm
    agent: researcher
    prompt: Research this topic: {{ inputs.topic }}
    output: research_results

  - id: summarize
    type: llm
    agent: writer
    prompt: Summarize these findings about {{ inputs.topic }}
    dependencies: [research]
    output: summary
`

describe('Workflow Parser', () => {
  it('parses a basic workflow', () => {
    const wf = parseWorkflow(BASIC_WORKFLOW)
    expect(wf.name).toBe('research-and-summarize')
    expect(wf.version).toBe('1.0.0')
    expect(wf.description).toBe('Research a topic and produce a summary')
    expect(Object.keys(wf.inputs)).toContain('topic')
    expect(wf.steps.length).toBe(2)
  })

  it('parses step properties', () => {
    const wf = parseWorkflow(BASIC_WORKFLOW)
    const research = wf.steps.find((s) => s.id === 'research')!
    expect(research.type).toBe('llm')
    expect(research.agent).toBe('researcher')
    expect(research.prompt).toContain('{{ inputs.topic }}')
  })

  it('parses dependencies', () => {
    const wf = parseWorkflow(BASIC_WORKFLOW)
    const summarize = wf.steps.find((s) => s.id === 'summarize')!
    expect(summarize.dependencies).toContain('research')
  })

  it('rejects workflow without name', () => {
    expect(() => parseWorkflow('version: 1.0.0\nsteps:')).toThrow(WorkflowParseError)
  })

  it('detects invalid dependencies', () => {
    const yaml = `
name: bad
steps:
  - id: s1
    type: llm
    agent: a
    prompt: test
    dependencies: [nonexistent]
`
    expect(() => parseWorkflow(yaml)).toThrow('unknown step')
  })
})

describe('Workflow Compiler', () => {
  it('compiles workflow to executable plan', () => {
    const wf = parseWorkflow(BASIC_WORKFLOW)
    const researcher = createAgent({ name: 'researcher', role: 'research' })
    const writer = createAgent({ name: 'writer', role: 'write' })

    const plan = compileWorkflow(wf, {
      agents: new Map([['researcher', researcher], ['writer', writer]]),
      inputs: { topic: 'TypeScript ORMs', depth: 'thorough' },
    })

    expect(plan.steps.length).toBe(2)
    expect(plan.task.description).toBe('Research a topic and produce a summary')
    expect(plan.status).toBe('draft')
  })

  it('resolves template variables in prompts', () => {
    const wf = parseWorkflow(BASIC_WORKFLOW)
    const agent = createAgent({ name: 'researcher', role: 'r' })
    const writer = createAgent({ name: 'writer', role: 'w' })

    const plan = compileWorkflow(wf, {
      agents: new Map([['researcher', agent], ['writer', writer]]),
      inputs: { topic: 'GraphQL vs REST', depth: 'quick' },
    })

    const researchStep = plan.steps[0]!
    expect((researchStep.input as { value: string }).value).toContain('GraphQL vs REST')
  })

  it('throws on missing required input', () => {
    const yaml = `
name: test
inputs:
  topic:
    type: string
    required: true
steps:
  - id: s1
    type: llm
    agent: a
    prompt: test
`
    const wf = parseWorkflow(yaml)
    const agent = createAgent({ name: 'a', role: 'r' })

    expect(() => compileWorkflow(wf, {
      agents: new Map([['a', agent]]),
      inputs: {},
    })).toThrow('Missing required')
  })

  it('throws on missing agent', () => {
    const wf = parseWorkflow(BASIC_WORKFLOW)
    expect(() => compileWorkflow(wf, {
      agents: new Map(),
      inputs: { topic: 'test', depth: 'quick' },
    })).toThrow('not found')
  })
})
