import { describe, it, expect } from 'vitest'
import * as templates from '../../src/templates/index.js'
import { createAgent } from '../../src/core/agent-factory.js'

describe('Agent Templates', () => {
  it('creates researcher with defaults', () => {
    const def = templates.researcher()
    expect(def.name).toBe('researcher')
    expect(def.capabilities).toContain('research')
    expect(def.modelTier).toBe('standard')
    expect(def.maxCostCents).toBe(25)
    expect(def.systemPrompt).toBeTruthy()
  })

  it('creates code-reviewer with defaults', () => {
    const def = templates.codeReviewer()
    expect(def.name).toBe('code-reviewer')
    expect(def.capabilities).toContain('security-audit')
  })

  it('creates synthesizer with premium tier', () => {
    const def = templates.synthesizer()
    expect(def.modelTier).toBe('premium')
  })

  it('applies overrides', () => {
    const def = templates.researcher({
      modelTier: 'cheap',
      maxCostCents: 5,
      systemPrompt: 'Custom prompt',
    })
    expect(def.modelTier).toBe('cheap')
    expect(def.maxCostCents).toBe(5)
    expect(def.systemPrompt).toBe('Custom prompt')
    expect(def.name).toBe('researcher') // Name unchanged
  })

  it('all templates produce valid agent definitions', () => {
    const allTemplates = [
      templates.researcher(),
      templates.codeReviewer(),
      templates.synthesizer(),
      templates.dataAnalyst(),
      templates.qaTester(),
      templates.writer(),
      templates.planner(),
    ]

    for (const def of allTemplates) {
      const agent = createAgent(def)
      expect(agent.name).toBeTruthy()
      expect(agent.role).toBeTruthy()
      expect(agent.capabilities.length).toBeGreaterThan(0)
      expect(agent.systemPrompt).toBeTruthy()
    }
  })

  it('provides 7 templates', () => {
    const fns = [
      templates.researcher,
      templates.codeReviewer,
      templates.synthesizer,
      templates.dataAnalyst,
      templates.qaTester,
      templates.writer,
      templates.planner,
    ]
    expect(fns.length).toBe(7)
  })
})
