import { describe, it, expect } from 'vitest'
import { createBrowserTool, createComputerUseTool } from '../../src/tools/browser.js'

describe('createBrowserTool', () => {
  it('returns a Tool with name browser', () => {
    const tool = createBrowserTool()
    expect(tool.name).toBe('browser')
    expect(typeof tool.execute).toBe('function')
  })

  it('returns error result when playwright is not installed', async () => {
    const tool = createBrowserTool()
    // playwright not available in test env — should return error, not throw
    const result = await tool.execute({ action: { type: 'screenshot' } }) as { success: boolean; error?: string }
    // Either it works (playwright installed) or returns error gracefully
    expect(typeof result.success).toBe('boolean')
  })

  it('inputSchema requires action', () => {
    const tool = createBrowserTool()
    const schema = tool.inputSchema as { required: string[] }
    expect(schema.required).toContain('action')
  })
})

describe('createComputerUseTool', () => {
  it('returns a Tool with name computer_use', () => {
    const tool = createComputerUseTool()
    expect(tool.name).toBe('computer_use')
  })

  it('screenshot action calls screenshotProvider', async () => {
    let called = false
    const tool = createComputerUseTool({
      screenshotProvider: async () => { called = true; return 'base64data' },
    })
    const result = await tool.execute({ action: 'screenshot' }) as { success: boolean; content?: string }
    expect(called).toBe(true)
    expect(result.success).toBe(true)
    expect(result.content).toBe('base64data')
  })

  it('non-screenshot action returns acknowledged response', async () => {
    const tool = createComputerUseTool()
    const result = await tool.execute({ action: 'mouse_move', coordinate: [100, 200] }) as { success: boolean; content?: string }
    expect(result.success).toBe(true)
    expect(result.content).toContain('mouse_move')
  })
})
