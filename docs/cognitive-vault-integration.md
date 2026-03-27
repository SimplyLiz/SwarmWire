# CognitiveVault Integration

SwarmWire includes a `CognitiveVaultBoard` adapter that persists the in-process MessageBoard to [CognitiveVault](https://github.com/SimplyLiz/cognitive-vault), giving your multi-agent workflows durable, cross-session communication.

## Why

SwarmWire's `MessageBoard` is ephemeral — it lives for one `swarm.run()` call. When the execution ends, all agent messages are gone. The CV adapter solves this:

- **Durable**: Messages persist as vault entries — survive restarts, crashes, deploys
- **Cross-process**: Agents in different SwarmWire executions see each other's work
- **Cross-tool**: Agents using MCP (Claude Code, Cursor) can read SwarmWire agent findings
- **Searchable**: Messages are vault entries — full-text search, tag filtering, API access

## Setup

```typescript
import { Swarm } from 'swarmwire'
import { CognitiveVaultBoard } from 'swarmwire/adapters'

const board = new CognitiveVaultBoard({
  apiUrl: 'https://cognitive-vault.com',  // or http://localhost:3000
  apiKey: 'cvk_...',                       // CV API key
  vaultId: 'your-vault-id',
  sessionId: '2025-06-15-a3f1',           // optional, auto-generated if omitted
})

// Catch up on prior messages
const hydrated = await board.hydrate()
console.log(`Loaded ${hydrated} messages from prior sessions`)

// Use in swarm
const swarm = new Swarm({
  providers: [{ type: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! }],
  board,
})

const result = await swarm.run('Analyze this codebase for security issues', {
  pattern: 'orchestrator-worker',
  agents: [securityAgent, codeAgent, testAgent],
})

// Ensure all messages are persisted before exiting
await board.flush()
```

## How it works

### Posting

Every `board.post()` call does two things:
1. Adds the message to the in-memory board (instant, same as vanilla MessageBoard)
2. Fires off a background HTTP POST to CV's entries API (non-blocking)

The CV entry gets structured tags:
```
agent:security-reviewer          # sender
agent:to:*                       # recipient (* = broadcast)
msg:finding                      # message type
msg:priority:urgent              # priority
channel:security                 # topic channel
session:2025-06-15-a3f1          # session grouping
thread:clu1234                   # reply thread (if replying)
```

### Reading

The in-memory board is the fast path — agents read from it during execution with zero latency. CV is the durable store that survives across executions.

### Hydrating

`board.hydrate()` fetches recent messages from CV and injects them into the in-memory board. Call this before `swarm.run()` to give agents context from prior sessions.

```typescript
// Hydrate from a specific session
await board.hydrate('2025-06-14-b2c3')

// Or hydrate from the current session (default)
await board.hydrate()
```

### Flushing

`board.flush()` waits for all background persists to complete. Call before process exit.

## Message types

Same as SwarmWire's MessageBoard:

| Type | Use for |
|------|---------|
| `finding` | Discovered facts, results, observations |
| `warning` | Potential issues, risks, concerns |
| `question` | Asking another agent for information |
| `answer` | Responding to a question (use `replyTo` for threading) |
| `decision` | Commitments, choices made, actions taken |
| `status` | Progress updates, state changes |

## CognitiveVault MCP tools

Agents using CognitiveVault's MCP server (not SwarmWire) can also participate in the same message board via three tools:

- `post_agent_message` — post to the board
- `read_agent_board` — read messages for a specific agent
- `get_agent_briefing` — structured summary of all agent communications

These tools create the same tag structure, so SwarmWire agents and MCP agents can communicate seamlessly through the shared vault.

## Configuration

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `apiUrl` | Yes | — | CV API base URL |
| `apiKey` | Yes | — | CV API key (Bearer token) |
| `vaultId` | Yes | — | Target vault ID |
| `sessionId` | No | Auto-generated | Session ID for grouping messages |
| `persist` | No | `true` | Set `false` to disable CV persistence (in-memory only) |
