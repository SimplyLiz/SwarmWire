import { describe, it, expect } from 'vitest'
import { createReducedSkillSet, selectRelevantTools } from '../../src/tools/skill-reducer.js'
import type { Tool } from '../../src/types/tool.js'

function tool(name: string, description: string): Tool {
  return { name, description, inputSchema: {}, execute: async () => null }
}

const tools: Tool[] = [
  tool('search_web', 'Search the internet for current information about any topic.'),
  tool('execute_code', 'Run Python or JavaScript code in a sandbox environment.'),
  tool('read_file', 'Read the contents of a file at the given path.'),
]

describe('createReducedSkillSet', () => {
  it('creates compact summaries for all tools', () => {
    const skillSet = createReducedSkillSet(tools)
    expect(skillSet.compact).toHaveLength(3)
  })

  it('truncates summaries to maxSummaryLength', () => {
    const skillSet = createReducedSkillSet(tools, { maxSummaryLength: 20 })
    for (const s of skillSet.compact) {
      expect(s.summary.length).toBeLessThanOrEqual(21) // +1 for ellipsis
    }
  })

  it('resolves tool by name', () => {
    const skillSet = createReducedSkillSet(tools)
    expect(skillSet.resolve('search_web')).toBeDefined()
    expect(skillSet.resolve('nonexistent')).toBeUndefined()
  })

  it('toPromptString returns formatted list', () => {
    const skillSet = createReducedSkillSet(tools)
    const prompt = skillSet.toPromptString()
    expect(prompt).toContain('search_web')
    expect(prompt).toContain('execute_code')
    expect(prompt.split('\n')).toHaveLength(3)
  })

  it('expand returns full tool definitions', () => {
    const skillSet = createReducedSkillSet(tools)
    const expanded = skillSet.expand(['search_web', 'read_file'])
    expect(expanded).toHaveLength(2)
    expect(expanded.map((t) => t.name)).toContain('search_web')
  })
})

describe('selectRelevantTools', () => {
  it('returns tools matching task keywords', () => {
    const skillSet = createReducedSkillSet(tools)
    const selected = selectRelevantTools('search for information about Python', skillSet)
    expect(selected.some((t) => t.name === 'search_web')).toBe(true)
  })

  it('returns first 3 tools as fallback when no match', () => {
    const skillSet = createReducedSkillSet(tools)
    const selected = selectRelevantTools('xyzzy', skillSet)
    expect(selected.length).toBeGreaterThan(0)
    expect(selected.length).toBeLessThanOrEqual(3)
  })
})
