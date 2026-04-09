/**
 * Code Execution Sandbox — multiple backends, all return a SwarmWire Tool.
 * Node VM (no dep), Docker CLI (no npm dep), E2B (lazy peer dep).
 */

import type { Tool } from '../types/tool.js'

export interface SandboxResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  error?: string
}

export interface CodeSandbox {
  execute(code: string, language: string, timeoutMs?: number): Promise<SandboxResult>
  close?(): Promise<void>
}

export interface NodeSandboxConfig {
  timeoutMs?: number
  allowedModules?: string[]
}

export interface DockerSandboxConfig {
  image?: string
  timeoutMs?: number
}

// ─── Node VM sandbox ───────────────────────────────────────────

export function createNodeSandbox(config: NodeSandboxConfig = {}): CodeSandbox {
  const timeoutMs = config.timeoutMs ?? 5000

  return {
    async execute(code: string, _language: string, overrideTimeout?: number): Promise<SandboxResult> {
      const start = Date.now()
      const timeout = overrideTimeout ?? timeoutMs

      try {
        // Dynamic import to avoid bundling issues
        const vm = await import('node:vm')
        const { Writable } = await import('node:stream')

        let stdout = ''
        let stderr = ''

        const writable = new Writable({
          write(chunk: Buffer, _enc: string, cb: () => void) {
            stdout += chunk.toString()
            cb()
          },
        })

        const sandbox = {
          console: {
            log: (...args: unknown[]) => { stdout += args.join(' ') + '\n' },
            error: (...args: unknown[]) => { stderr += args.join(' ') + '\n' },
            warn: (...args: unknown[]) => { stderr += args.join(' ') + '\n' },
          },
          setTimeout,
          clearTimeout,
          process: { env: {} },
          __writable: writable,
        }

        vm.createContext(sandbox)

        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
          try {
            vm.runInContext(code, sandbox, { timeout })
            clearTimeout(timer)
            resolve()
          } catch (err) {
            clearTimeout(timer)
            reject(err)
          }
        })

        return { stdout, stderr, exitCode: 0, durationMs: Date.now() - start }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { stdout: '', stderr: msg, exitCode: 1, durationMs: Date.now() - start, error: msg }
      }
    },
  }
}

// ─── Docker sandbox ────────────────────────────────────────────

export function createDockerSandbox(config: DockerSandboxConfig = {}): CodeSandbox {
  const image = config.image ?? 'node:20-alpine'
  const timeoutMs = config.timeoutMs ?? 10000

  return {
    async execute(code: string, language: string, overrideTimeout?: number): Promise<SandboxResult> {
      const start = Date.now()
      const timeout = overrideTimeout ?? timeoutMs

      try {
        const { spawn } = await import('node:child_process')

        const runner = language === 'python' ? 'python3 -c' : 'node -e'
        const args = ['run', '--rm', '--network=none', '-i', image, 'sh', '-c', `${runner} "${code.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`]

        return await new Promise<SandboxResult>((resolve) => {
          const proc = spawn('docker', args, { timeout })
          let stdout = ''
          let stderr = ''

          proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
          proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

          const timer = setTimeout(() => {
            proc.kill()
            resolve({ stdout, stderr, exitCode: 124, durationMs: Date.now() - start, error: 'Timeout' })
          }, timeout)

          proc.on('close', (code) => {
            clearTimeout(timer)
            resolve({ stdout, stderr, exitCode: code ?? 0, durationMs: Date.now() - start })
          })

          proc.on('error', (err) => {
            clearTimeout(timer)
            resolve({ stdout: '', stderr: err.message, exitCode: 1, durationMs: Date.now() - start, error: err.message })
          })
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { stdout: '', stderr: msg, exitCode: 1, durationMs: Date.now() - start, error: msg }
      }
    },
  }
}

// ─── E2B sandbox ───────────────────────────────────────────────

export function createE2BSandbox(apiKey: string, config: { timeoutMs?: number } = {}): CodeSandbox {
  const timeoutMs = config.timeoutMs ?? 30000

  return {
    async execute(code: string, language: string, overrideTimeout?: number): Promise<SandboxResult> {
      const start = Date.now()
      const timeout = overrideTimeout ?? timeoutMs

      try {
        // Lazy import — @e2b/sdk must be installed as optional peer dep
        const e2b = await import('@e2b/sdk' as string).catch(() => {
          throw new Error('@e2b/sdk is not installed. Run: npm install @e2b/sdk')
        })

        const sandbox = await (e2b as { Sandbox: { create: (o: unknown) => Promise<unknown> } }).Sandbox.create({ apiKey, timeout })
        const s = sandbox as {
          runCode: (lang: string, code: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
          kill: () => Promise<void>
        }
        const result = await s.runCode(language, code)
        await s.kill()

        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: Date.now() - start,
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { stdout: '', stderr: msg, exitCode: 1, durationMs: Date.now() - start, error: msg }
      }
    },
  }
}

// ─── Tool factory ──────────────────────────────────────────────

export function createCodeExecutionTool(sandbox: CodeSandbox): Tool {
  return {
    name: 'execute_code',
    description: 'Execute code in a sandboxed environment. Supports JavaScript/TypeScript by default.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to execute' },
        language: { type: 'string', description: 'Language: javascript, python, etc. Default: javascript' },
        timeoutMs: { type: 'number', description: 'Execution timeout in milliseconds' },
      },
      required: ['code'],
    },
    async execute(input: unknown): Promise<SandboxResult> {
      const { code, language = 'javascript', timeoutMs } = input as {
        code: string
        language?: string
        timeoutMs?: number
      }
      return sandbox.execute(code, language, timeoutMs)
    },
  }
}
