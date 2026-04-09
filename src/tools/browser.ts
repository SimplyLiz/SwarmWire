/**
 * Browser / Computer Use Tools.
 * Playwright adapter (peer dep) + Anthropic Computer Use tool wrapper.
 */

import type { Tool } from '../types/tool.js'

export interface BrowserAction {
  type: 'navigate' | 'click' | 'type' | 'screenshot' | 'extract' | 'evaluate'
  url?: string
  selector?: string
  text?: string
  script?: string
}

export interface BrowserResult {
  success: boolean
  content?: string
  error?: string
  durationMs: number
}

export interface BrowserConfig {
  headless?: boolean
  timeoutMs?: number
}

// ─── Playwright browser tool ───────────────────────────────────

/**
 * Creates a browser tool backed by Playwright.
 * Requires `playwright` as an optional peer dependency.
 */
export function createBrowserTool(config: BrowserConfig = {}): Tool {
  const headless = config.headless !== false
  const timeoutMs = config.timeoutMs ?? 30000

  // Shared browser instance — created on first use
  let browserInstance: unknown = null

  async function getBrowser(): Promise<unknown> {
    if (browserInstance) return browserInstance
    const pw = await import('playwright' as string).catch(() => {
      throw new Error('playwright is not installed. Run: npm install playwright')
    })
    const p = pw as { chromium: { launch: (opts: unknown) => Promise<unknown> } }
    browserInstance = await p.chromium.launch({ headless })
    return browserInstance
  }

  return {
    name: 'browser',
    description: 'Control a web browser: navigate, click, type, take screenshots, extract text, or evaluate JS.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['navigate', 'click', 'type', 'screenshot', 'extract', 'evaluate'] },
            url: { type: 'string' },
            selector: { type: 'string' },
            text: { type: 'string' },
            script: { type: 'string' },
          },
          required: ['type'],
        },
      },
      required: ['action'],
    },
    async execute(input: unknown): Promise<BrowserResult> {
      const { action } = input as { action: BrowserAction }
      const start = Date.now()

      try {
        const browser = await getBrowser()
        const b = browser as {
          newPage: () => Promise<{
            goto: (url: string, opts: unknown) => Promise<void>
            click: (sel: string) => Promise<void>
            fill: (sel: string, text: string) => Promise<void>
            screenshot: (opts: unknown) => Promise<Buffer>
            textContent: (sel: string) => Promise<string | null>
            evaluate: (script: string) => Promise<unknown>
          }>
        }
        const page = await b.newPage()

        let content: string | undefined

        switch (action.type) {
          case 'navigate':
            await page.goto(action.url ?? '', { timeout: timeoutMs })
            break
          case 'click':
            await page.click(action.selector ?? '')
            break
          case 'type':
            await page.fill(action.selector ?? '', action.text ?? '')
            break
          case 'screenshot': {
            const buf = await page.screenshot({ type: 'png' })
            content = buf.toString('base64')
            break
          }
          case 'extract':
            content = (await page.textContent(action.selector ?? 'body')) ?? ''
            break
          case 'evaluate': {
            const result = await page.evaluate(action.script ?? '')
            content = JSON.stringify(result)
            break
          }
        }

        return { success: true, content, durationMs: Date.now() - start }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, error: msg, durationMs: Date.now() - start }
      }
    },

    async rollback(): Promise<void> {
      // Browser actions are not reversible
    },
  }
}

// ─── Anthropic Computer Use tool ───────────────────────────────

export interface ComputerUseConfig {
  /** Provide a screenshot. Should return base64-encoded PNG. */
  screenshotProvider?: () => Promise<string>
}

/**
 * Wraps Anthropic's computer_20241022 tool schema for use in SwarmWire.
 * The actual screen interaction must be provided via screenshotProvider + action execution.
 */
export function createComputerUseTool(config: ComputerUseConfig = {}): Tool {
  return {
    name: 'computer_use',
    description: 'Anthropic Computer Use tool — control the computer via screenshot + action.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['screenshot', 'mouse_move', 'left_click', 'right_click', 'double_click', 'type', 'key', 'scroll'],
        },
        coordinate: {
          type: 'array',
          items: { type: 'number' },
          description: '[x, y] pixel coordinates',
        },
        text: { type: 'string', description: 'Text to type or key to press' },
      },
      required: ['action'],
    },
    async execute(input: unknown): Promise<BrowserResult> {
      const start = Date.now()
      const { action } = input as { action: string }

      if (action === 'screenshot' && config.screenshotProvider) {
        try {
          const content = await config.screenshotProvider()
          return { success: true, content, durationMs: Date.now() - start }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { success: false, error: msg, durationMs: Date.now() - start }
        }
      }

      // For non-screenshot actions: callers wire in their own action executor
      return {
        success: true,
        content: `Action ${action} acknowledged — wire in your action executor`,
        durationMs: Date.now() - start,
      }
    },
  }
}
