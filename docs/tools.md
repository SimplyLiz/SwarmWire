# Tools

Extend agents with executable capabilities: code sandboxes, browser automation, progressive skill disclosure, and more.

**Source:** `src/tools/`, `src/core/`

---

## Table of Contents

1. [Tool Interface](#tool-interface)
2. [MCP Tools](#mcp-tools)
3. [Code Execution Sandbox](#code-execution-sandbox)
4. [Browser & Computer Use](#browser--computer-use)
5. [Skill Reducer — Progressive Disclosure](#skill-reducer--progressive-disclosure)
6. [ReputationBoard — Weighted Messaging](#reputationboard--weighted-messaging)

---

## Tool Interface

```typescript
interface Tool {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  execute(input: Record<string, unknown>): Promise<unknown>
  /** Optional rollback handler for RollbackManager integration */
  rollback?(output: unknown, input: unknown): Promise<void>
}
```

Attach tools to an agent via the `tools` array:

```typescript
swarm.agent({
  name: 'analyst',
  role: 'Analyzes data',
  tools: [myTool, anotherTool],
})
```

The agent calls `context.tool(toolName, input)` at runtime.

---

## MCP Tools

**Source:** `src/core/mcp-loader.ts`

Load tools from any Model Context Protocol (MCP) server:

```typescript
import { loadMCPTools } from 'swarmwire'

const tools = await loadMCPTools({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
})

// tools is Tool[] — attach to any agent
swarm.agent({
  name: 'file-agent',
  role: 'Reads and writes files',
  tools,
})
```

---

## Code Execution Sandbox

**Source:** `src/tools/code-sandbox.ts`

Run arbitrary code safely. Three backends, all returning a `Tool` for `agent.tools[]`.

### Node.js VM sandbox (no extra deps)

Uses Node's built-in `vm` module. Fastest, no Docker required.

```typescript
import { createNodeSandbox, createCodeExecutionTool } from 'swarmwire'

const sandbox = createNodeSandbox({
  timeoutMs: 5000,
  allowedModules: ['path', 'crypto'],  // restrict require() in sandbox
})

// Direct execution
const result = await sandbox.execute('console.log("hello")', 'javascript')
// { stdout: 'hello\n', stderr: '', exitCode: 0, durationMs: 12 }

// As an agent tool
const tool = createCodeExecutionTool(sandbox)
swarm.agent({ name: 'coder', role: 'Writes and runs code', tools: [tool] })
```

The agent calls the tool as:
```json
{ "code": "console.log(2 + 2)", "language": "javascript" }
```

### Docker sandbox

Runs code in an isolated container. Requires Docker in PATH.

```typescript
import { createDockerSandbox } from 'swarmwire'

const sandbox = createDockerSandbox({
  image: 'node:20-alpine',   // default
  timeoutMs: 10_000,
})

const tool = createCodeExecutionTool(sandbox)
```

Docker sandbox runs with `--network=none` — no internet access from inside the container.

### E2B cloud sandbox

Peer dep: `@e2b/sdk`

```bash
npm install @e2b/sdk
```

```typescript
import { createE2BSandbox } from 'swarmwire'

const sandbox = createE2BSandbox(process.env.E2B_API_KEY!, {
  timeoutMs: 30_000,
})
const tool = createCodeExecutionTool(sandbox)
```

### SandboxResult shape

```typescript
interface SandboxResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  error?: string
}
```

### Cleanup

```typescript
await sandbox.close?.()  // optional — release Docker/E2B resources
```

---

## Browser & Computer Use

**Source:** `src/tools/browser.ts`

### Browser tool (Playwright)

Peer dep: `playwright`

```bash
npm install playwright
npx playwright install chromium
```

```typescript
import { createBrowserTool } from 'swarmwire'

const browserTool = createBrowserTool({
  headless: true,      // default
  timeoutMs: 30_000,   // default
})

// Tool is named 'browser' — agent calls it with an action object
swarm.agent({
  name: 'web-agent',
  role: 'Navigates and extracts web content',
  tools: [browserTool],
})
```

The browser tool supports these actions:

```typescript
type BrowserAction =
  | { type: 'navigate'; url: string }
  | { type: 'click'; selector: string }
  | { type: 'type'; selector: string; text: string }
  | { type: 'screenshot' }                         // returns base64 PNG
  | { type: 'extract'; selector: string }          // returns text content
  | { type: 'evaluate'; script: string }           // runs JS in page
```

```typescript
// Agent invocation examples:
{ "action": { "type": "navigate", "url": "https://example.com" } }
{ "action": { "type": "extract", "selector": "h1" } }
{ "action": { "type": "screenshot" } }
```

### BrowserResult shape

```typescript
interface BrowserResult {
  success: boolean
  content?: string    // text or base64 screenshot
  error?: string
  durationMs: number
}
```

### Computer Use tool (Anthropic API)

Wraps the Anthropic `computer_20241022` tool:

```typescript
import { createComputerUseTool } from 'swarmwire'

const tool = createComputerUseTool({
  screenshotProvider: async () => {
    // Return base64 screenshot of current screen
    return captureScreen()
  },
})

swarm.agent({
  name: 'computer-agent',
  role: 'Controls the computer via GUI',
  tools: [tool],
})
```

---

## Skill Reducer — Progressive Disclosure

**Source:** `src/tools/skill-reducer.ts`
**Paper:** ToolBench progressive skill disclosure

Reduces prompt token usage by ~48% by sending compact one-liner tool descriptions first and expanding to full schemas only for selected tools.

### Usage

```typescript
import { createReducedSkillSet, selectRelevantTools } from 'swarmwire'

const fullTools: Tool[] = [...agentTools]

// Create compact summaries (one-liner per tool)
const { summaries, full } = createReducedSkillSet(fullTools, {
  maxSummaryLength: 80,       // chars per summary line. Default 80
  topK: 5,                    // max tools in compact view. Default 10
})

// Phase 1 — send summaries to LLM to let it pick relevant tools
// summaries looks like:
// [{ name: 'search_web', summary: 'Search the web for a query' }, ...]

// Phase 2 — expand only the tools the LLM selected
const selected = selectRelevantTools(full, ['search_web', 'read_file'])
// selected is Tool[] with full schemas for those two tools only
```

### Async variant (for large tool sets)

```typescript
import { createReducedSkillSetAsync } from 'swarmwire'

const result = await createReducedSkillSetAsync(tools, {
  summarizeFn: async (tool) => {
    // Use an LLM to generate better summaries
    return llm.complete(`One line: ${tool.description}`)
  },
})
```

### Agent integration

```typescript
// Attach full tool list to agent — the skill reducer runs automatically
// when the agent's prompt is constructed, based on task context
swarm.agent({
  name: 'multi-tool-agent',
  role: 'Uses many tools',
  tools: largeToolList,
  // Token savings are automatic when tools > 10
})
```

### SkillReducerConfig

```typescript
interface SkillReducerConfig {
  maxSummaryLength?: number   // default 80 chars per tool summary
  topK?: number               // default 10 — max tools in compact view
  summarizeFn?: (tool: Tool) => Promise<string>  // custom summary generator
}

interface ReducedSkillSet {
  summaries: SkillSummary[]   // compact view
  full: Tool[]                // full schemas
}

interface SkillSummary {
  name: string
  summary: string
}
```

---

## ReputationBoard — Weighted Messaging

**Source:** `src/core/reputation-board.ts`

Extends `MessageBoard` with per-agent reputation scoring. Messages from higher-reputation agents receive greater weight in aggregated findings.

```typescript
import { ReputationBoard } from 'swarmwire'

const board = new ReputationBoard({
  defaultReputation: 0.5,
  decayRate: 0.95,           // reputation decays on consolidate()
  minSamples: 3,             // samples before reputation diverges from default
})

// Agents post normally
board.post('security-agent', '*', 'Found SQL injection in auth.ts', {
  type: 'finding',
  data: { severity: 'critical', file: 'auth.ts' },
})

board.post('reviewer-agent', '*', 'Confirmed: auth.ts is vulnerable', {
  type: 'finding',
})
```

### Building reputation

```typescript
// Upvote a specific message
board.upvote(messageId, 'judge-agent')

// Record a citation (agent referenced another agent's finding)
board.cite(sourceMessageId)

// Mark an agent's answer as correct
board.markAnswerCorrect('security-agent')
```

Reputation score formula:

```
score = upvoteRate × 0.4 + citationRate × 0.3 + correctAnswerRate × 0.3
```

Blended with `defaultReputation` proportionally until `minSamples` reached.

### Weighted aggregation

```typescript
// Get findings weighted by sender reputation
const findings = board.weightedFindings('orchestrator-agent')
// Each finding includes a .weight (0-1) reflecting the sender's reputation

// Aggregate all finding texts with weights applied
const summary = board.aggregateFindings('orchestrator-agent')
// Returns: Map<agentName, { messages, reputation }>

// Leaderboard
const leaders = board.leaderboard()
// [{ agentName, reputation, upvotes, citations, correctAnswers, totalMessages }]

// Decay all reputations
board.decay()
```

### ReputationConfig

```typescript
interface ReputationConfig {
  defaultReputation?: number  // 0-1. Default 0.5
  decayRate?: number          // multiplied on decay(). Default 0.95
  minSamples?: number         // before reputation diverges. Default 3
}
```

### When to use ReputationBoard

- Multi-agent debate or blackboard patterns where some agents are more reliable
- Long-running systems where you want to track which agents produce trusted output
- Orchestrators that need to weight conflicting information from multiple agents
