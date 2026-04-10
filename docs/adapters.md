# Adapters

Adapters connect SwarmWire to external systems: LLM SDKs and message persistence backends.

**Source:** `src/adapters/claude-agent-sdk.ts`, `src/adapters/file-board.ts`, `src/adapters/cognitive-vault.ts`

---

## Table of Contents

1. [Claude Agent SDK Adapter](#claude-agent-sdk-adapter)
2. [FileBoard (Local Persistence)](#fileboard-local-persistence)
3. [CognitiveVaultBoard (Cloud Persistence)](#cognitivevaultboard-cloud-persistence)
4. [Voice Pipeline](#voice-pipeline)
5. [When to Use Which](#when-to-use-which)

---

## Claude Agent SDK Adapter

Wraps a Claude Agent SDK session as a SwarmWire `Agent`. The SDK handles tool use, file operations, and shell commands internally -- SwarmWire treats it as a black-box executor.

**Peer dependency:** `@anthropic-ai/claude-agent-sdk` (lazy-loaded, not required at install time)

### Setup

```bash
npm install @anthropic-ai/claude-agent-sdk
```

```typescript
import { fromClaudeAgentSDK } from './adapters/claude-agent-sdk.js'

const agent = await fromClaudeAgentSDK({
  name: 'code-reviewer',
  role: 'Reviews code for bugs and security issues',
  systemPrompt: 'You are a senior code reviewer. Focus on security and correctness.',
  maxTokens: 4096,
  capabilities: ['code', 'security', 'file-operations'],
  sdkOptions: {
    // Passed directly to createSession()
    model: 'claude-sonnet-4-20250514',
    allowedTools: ['Read', 'Bash', 'Grep'],
  },
})
```

### Configuration

```typescript
interface ClaudeAgentConfig {
  /** Agent name in SwarmWire */
  name: string
  /** Role description */
  role?: string
  /** Claude Agent SDK options passed to createSession() */
  sdkOptions?: Record<string, unknown>
  /** System prompt for the agent */
  systemPrompt?: string
  /** Max tokens per turn */
  maxTokens?: number
  /** Capabilities for routing (used by matchAgent/adaptive router) */
  capabilities?: string[]
}
```

### What you get back

The returned `Agent` object:

```typescript
{
  id: 'claude_sdk_code-reviewer_m1abc2d',
  name: 'code-reviewer',
  role: 'Reviews code for bugs and security issues',
  capabilities: ['code', 'security', 'file-operations'],
  tools: [],                    // SDK manages tools internally
  modelTier: 'premium',
  systemPrompt: '...',
  maxTokens: 4096,
  timeoutMs: 120_000,
  execute(input, context) { ... }
}
```

### Execution flow

When `agent.execute(input, context)` is called:
1. Input is stringified if not already a string
2. A new SDK session is created via `createSession(sdkOptions)`
3. The prompt is sent via `session.run(prompt)`
4. The session is closed in a `finally` block
5. The text response is returned

### Using with SwarmWire orchestration

```typescript
import { fromClaudeAgentSDK } from './adapters/claude-agent-sdk.js'

const reviewer = await fromClaudeAgentSDK({
  name: 'reviewer',
  systemPrompt: 'Review the code for bugs.',
  capabilities: ['code'],
})

const fixer = await fromClaudeAgentSDK({
  name: 'fixer',
  systemPrompt: 'Fix the bugs found by the reviewer.',
  capabilities: ['code'],
})

// Use in a swarm pipeline
const swarm = new Swarm({
  providers: [anthropicProvider],
  agents: [reviewer, fixer],
})
```

---

## FileBoard (Local Persistence)

File-backed `MessageBoard` for inter-agent communication. Appends messages to a JSONL file (one JSON object per line). No external dependencies.

### Setup

```typescript
import { FileBoard } from './adapters/file-board.js'

// Default path: .swarmwire/board.jsonl
const board = new FileBoard()

// Custom path
const board = new FileBoard({ path: '/tmp/my-board.jsonl' })

// Custom session ID (for grouping messages)
const board = new FileBoard({ sessionId: 'run-42' })

// In-memory only (no file writes)
const board = new FileBoard({ persist: false })
```

### Configuration

```typescript
interface FileBoardConfig {
  /** Path to the JSONL file. Default: '.swarmwire/board.jsonl' */
  path?: string
  /** Session ID for grouping. Default: auto-generated (YYYY-MM-DD-xxxx) */
  sessionId?: string
  /** Whether to persist to file. Default: true */
  persist?: boolean
}
```

### Posting messages

```typescript
const msg = board.post('agent-a', '*', 'Found a bug in auth.ts', {
  type: 'finding',
  priority: 'urgent',
  channel: 'security',
  data: { file: 'auth.ts', line: 42 },
})
```

Messages are appended to the JSONL file in the background via a write queue. The `post()` call returns immediately.

### Hydrating from file

Load prior messages into the in-memory board:

```typescript
// Load all messages from file
const count = await board.hydrate()
console.log(`Loaded ${count} messages`)

// Load only messages from a specific session
const count = await board.hydrate('2026-03-25-a1b2')
```

Malformed JSONL lines are silently skipped.

### Flushing

Wait for all pending writes to complete:

```typescript
await board.flush()
```

### Properties

```typescript
board.session  // string -- the session ID
board.path     // string -- resolved file path
```

### JSONL format

Each line in the file is a self-contained JSON object:

```json
{"id":"msg_1","from":"agent-a","to":"*","content":"Found a bug","type":"finding","priority":"urgent","channel":"security","data":{"file":"auth.ts"},"timestamp":1711411200000,"sessionId":"2026-03-25-a1b2"}
```

---

## CognitiveVaultBoard (Cloud Persistence)

Extends `MessageBoard` with durable persistence via CognitiveVault's REST API. Messages become vault entries with structured tags, visible to all agents -- including those outside the current SwarmWire execution.

Falls back to `FileBoard` when CognitiveVault is unreachable.

### Setup

```typescript
import { CognitiveVaultBoard } from './adapters/cognitive-vault.js'

const board = new CognitiveVaultBoard({
  apiUrl: 'https://cognitive-vault.example.com',
  apiKey: 'cvk_your_api_key',
  vaultId: 'vault-abc123',
})
```

### Configuration

```typescript
interface CognitiveVaultBoardConfig {
  /** CV API base URL */
  apiUrl: string
  /** CV API key (Bearer token) */
  apiKey: string
  /** Target vault ID */
  vaultId: string
  /** Session ID. Default: auto-generated */
  sessionId?: string
  /** Persist to CV. Default: true */
  persist?: boolean
  /** Fall back to local file when CV unreachable. Default: true */
  fallbackToFile?: boolean
  /** Path for file fallback. Default: '.swarmwire/board.jsonl' */
  fallbackPath?: string
}
```

### Posting messages

Same API as `MessageBoard`. Messages are persisted to CognitiveVault in the background:

```typescript
board.post('security-agent', '*', 'Found SQL injection', {
  type: 'finding',
  priority: 'urgent',
})
```

Each message becomes a CV entry with tags:
- `session:<sessionId>`
- `agent:<from>`
- `agent:to:<to>`
- `msg:<type>`
- `msg:priority:<priority>`
- `channel:<channel>` (if set)
- `thread:<replyTo>` (if replying)

The entry is created with `entryType: 'SESSION_UPDATE'` and `source: 'MCP_SESSION'`.

### Hydrating from CognitiveVault

```typescript
// Load messages from the current session
const count = await board.hydrate()

// Load messages from a specific session
const count = await board.hydrate('2026-03-25-a1b2')
```

Queries the CV API with `tags=session:<sid>` and `pageSize=100`. Falls back to `FileBoard.hydrate()` if CV is unreachable.

### Fallback behavior

When CognitiveVault is unreachable (network error or non-2xx response):
1. `cvAvailable` is set to `false`
2. Messages are routed to the local `FileBoard` fallback
3. Hydration falls back to loading from the local JSONL file

```typescript
board.isCvAvailable   // boolean | null (null = not checked yet)
board.isUsingFallback // true if CV is down and fallback is active
```

### Flushing

```typescript
await board.flush() // waits for both CV persist queue and file fallback
```

---

## Voice Pipeline

**Source:** `src/voice/index.ts`

Streaming STT → LLM → TTS pipeline. Accepts an audio buffer, transcribes speech, runs an agent, synthesizes the response back to audio.

```typescript
import { VoicePipeline } from 'swarmwire'

const pipeline = new VoicePipeline({
  stt: VoicePipeline.createDeepgramSTT(process.env.DEEPGRAM_API_KEY!),
  tts: VoicePipeline.createElevenLabsTTS(process.env.ELEVENLABS_KEY!, 'voice-id'),
  agent: myAgent,
  provider: anthropicProvider,
  model: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
})

// Process one voice turn
const turn = await pipeline.processTurn(audioBuffer)
console.log(turn.input)        // transcribed speech
console.log(turn.output)       // agent response text
console.log(turn.audioOutput)  // Buffer — synthesized audio (play or stream)
console.log(turn.durationMs)   // end-to-end latency

// Serve over WebSocket
ws.on('message', async (audioBuffer) => {
  const turn = await pipeline.processTurn(audioBuffer)
  ws.send(turn.audioOutput)
})
```

### Provider factory methods

```typescript
// STT providers
VoicePipeline.createDeepgramSTT(apiKey: string): STTProvider
VoicePipeline.createOpenAISTT(apiKey: string): STTProvider

// TTS providers
VoicePipeline.createElevenLabsTTS(apiKey: string, voiceId?: string): TTSProvider
VoicePipeline.createOpenAITTS(apiKey: string, voice?: string): TTSProvider
```

All provider factories lazy-import their SDKs — only required if installed:
- Deepgram: `npm install @deepgram/sdk`
- ElevenLabs: `npm install elevenlabs`
- OpenAI STT/TTS: `npm install openai`

### Custom STT/TTS

Implement `STTProvider` and `TTSProvider` to use any provider:

```typescript
interface STTProvider {
  transcribe(audioBuffer: Buffer, mimeType?: string): Promise<string>
}

interface TTSProvider {
  synthesize(text: string): Promise<Buffer>
}

const mySTT: STTProvider = {
  async transcribe(buffer) {
    return myWhisperAPI.transcribe(buffer)
  },
}
```

### VoicePipelineConfig

```typescript
interface VoicePipelineConfig {
  stt: STTProvider
  tts: TTSProvider
  agent: Agent
  provider: Provider
  model: ModelConfig
  silenceThresholdMs?: number  // default 1500 — end of utterance detection
}
```

---

## When to Use Which

### Message Board adapters

| Adapter               | Use when                                            | Persistence | Network required |
|-----------------------|-----------------------------------------------------|-------------|-----------------|
| `MessageBoard` (base) | In-memory only, single process, tests               | None        | No              |
| `FileBoard`           | Local dev, CI, single-machine agents                 | JSONL file  | No              |
| `CognitiveVaultBoard` | Production, distributed agents, cross-session memory | CV API      | Yes (with fallback) |

Decision tree:

```
Need cross-session or cross-process visibility?
  YES -> CognitiveVaultBoard
  NO  -> Need any persistence at all?
    YES -> FileBoard
    NO  -> MessageBoard (base)
```

### Claude Agent SDK adapter

Use `fromClaudeAgentSDK()` when:
- You want an agent that can use Claude's native tool calling (Read, Bash, Grep, etc.)
- You need file operations or shell access as part of agent execution
- You are building a code-generation or code-review pipeline

Do not use it when:
- You need fine-grained control over which LLM provider/model to use (the SDK manages this internally)
- You want to use SwarmWire's cascade routing for the agent's LLM calls
- You need to minimize dependencies

### Combining adapters

```typescript
import { fromClaudeAgentSDK } from './adapters/claude-agent-sdk.js'
import { CognitiveVaultBoard } from './adapters/cognitive-vault.js'

// Agent uses Claude SDK for execution
const agent = await fromClaudeAgentSDK({
  name: 'analyst',
  systemPrompt: 'Analyze the codebase.',
})

// Board uses CV for cross-agent communication
const board = new CognitiveVaultBoard({
  apiUrl: process.env.CV_API_URL!,
  apiKey: process.env.CV_API_KEY!,
  vaultId: process.env.CV_VAULT_ID!,
})

// Hydrate board before starting
await board.hydrate()

// Post findings to board during execution
board.post(agent.name, '*', 'Found 3 issues in auth module', {
  type: 'finding',
  data: { issues: [...] },
})

await board.flush()
```
