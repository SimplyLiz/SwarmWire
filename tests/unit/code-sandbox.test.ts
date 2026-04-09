import { describe, it, expect } from 'vitest'
import { createNodeSandbox, createCodeExecutionTool } from '../../src/tools/code-sandbox.js'

describe('createNodeSandbox', () => {
  it('executes simple code and captures stdout', async () => {
    const sandbox = createNodeSandbox()
    const result = await sandbox.execute('console.log("hello")', 'javascript')
    expect(result.stdout).toContain('hello')
    expect(result.exitCode).toBe(0)
  })

  it('captures stderr for console.error', async () => {
    const sandbox = createNodeSandbox()
    const result = await sandbox.execute('console.error("err msg")', 'javascript')
    expect(result.stderr).toContain('err msg')
  })

  it('returns exitCode 1 for thrown error', async () => {
    const sandbox = createNodeSandbox()
    const result = await sandbox.execute('throw new Error("oops")', 'javascript')
    expect(result.exitCode).toBe(1)
    expect(result.error).toContain('oops')
  })

  it('respects timeout', async () => {
    const sandbox = createNodeSandbox({ timeoutMs: 100 })
    // Create a busy loop — vm timeout should fire
    const result = await sandbox.execute(
      'let i = 0; while(true) { i++ }',
      'javascript',
    )
    expect(result.exitCode).toBe(1)
  })

  it('records durationMs', async () => {
    const sandbox = createNodeSandbox()
    const result = await sandbox.execute('1 + 1', 'javascript')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('createCodeExecutionTool', () => {
  it('returns a Tool with name execute_code', () => {
    const sandbox = createNodeSandbox()
    const tool = createCodeExecutionTool(sandbox)
    expect(tool.name).toBe('execute_code')
    expect(typeof tool.execute).toBe('function')
  })

  it('tool.execute runs code via the sandbox', async () => {
    const sandbox = createNodeSandbox()
    const tool = createCodeExecutionTool(sandbox)
    const result = await tool.execute({ code: 'console.log("tool")', language: 'javascript' }) as { stdout: string }
    expect(result.stdout).toContain('tool')
  })
})
