# Sessions & Branching

Persist conversation history across multiple `swarm.run()` calls and fork sessions at any point to explore alternative continuations.

**Source:** `src/session/index.ts`, `src/session/branch.ts`

---

## Table of Contents

1. [SessionManager](#sessionmanager)
2. [swarm.runInSession()](#swarmruninsession)
3. [BranchManager](#branchmanager)
4. [Patterns](#patterns)

---

## SessionManager

Named persistent sessions. Each session tracks the full conversation history and a key-value context bag. Prior turns are automatically prepended to new task inputs when you call `runInSession()`.

```typescript
import { SessionManager, Swarm, createProvider } from 'swarmwire'

const sessions = new SessionManager({
  maxMessages: 20,          // messages kept in active context window
  storage: myMemoryBackend, // optional: persist to any MemoryBackend
})

// Create a named session
const session = sessions.create('user-42', {
  userId: 'user-42',
  preferredLanguage: 'TypeScript',
})

console.log(session.id)         // 'sess_...'
console.log(session.context)    // { userId: 'user-42', ... }
```

### Recording turns

```typescript
sessions.record(
  session.id,
  'How do I use generics in TypeScript?',
  'Generics let you write reusable functions...',
  { executionId: 'exec_1', costCents: 5 },
)

sessions.record(
  session.id,
  'Can you show an example with arrays?',
  'Sure! Here is Array<T>...',
)
```

### Reading context

```typescript
// Format prior turns as a string to prepend to the next prompt
const ctx = sessions.getContext(session.id, 10) // last 10 messages
// Returns:
// [Previous conversation]
// User: How do I use generics...
// Assistant: Generics let you write...
// [End of previous conversation]
```

### Session management

```typescript
// List active sessions
const active = sessions.list()

// List all including archived
const all = sessions.list(true)

// Archive (hide from list, keep data)
sessions.archive(session.id)

// Delete permanently
sessions.delete(session.id)

// Look up by ID or name
const found = sessions.get('user-42')    // by name
const found2 = sessions.get(session.id) // by ID
```

### Persistence

```typescript
// Flush all sessions to storage backend
await sessions.flush()

// Reload sessions from storage
await sessions.hydrate()
```

### Configuration

```typescript
interface SessionConfig {
  storage?: MemoryBackend  // optional persistence backend
  maxMessages?: number     // default 20 — oldest trimmed beyond this
}

interface Session {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  messages: ConversationMessage[]
  context: Record<string, unknown>
  archived: boolean
}

interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  executionId?: string
  costCents?: number
}
```

---

## swarm.runInSession()

Run a task within a session. Prior turns are prepended to the task input, and the result is automatically recorded.

```typescript
import { Swarm, SessionManager, createProvider } from 'swarmwire'

const swarm = new Swarm({
  providers: [createProvider('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY! })],
  sessions,   // pass SessionManager to Swarm
})

swarm.agent({
  name: 'assistant',
  role: 'Helpful coding assistant',
  model: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260320' },
})

// First turn
const result1 = await swarm.runInSession(session.id, 'Explain async/await')
console.log(result1.output)

// Second turn — session history prepended automatically
const result2 = await swarm.runInSession(session.id, 'Now show me an example with fetch()')
// The agent receives the prior exchange as context
```

---

## BranchManager

Fork a session at any message index to explore alternative continuations. Useful for A/B testing different agent approaches, replaying from a decision point, or exploring counterfactuals.

```typescript
import { BranchManager } from 'swarmwire'

const branches = new BranchManager()
```

### Forking

```typescript
// session has 6 messages (indices 0-5)
// Fork after message 3 — the new branch starts from that point
const branch = branches.fork(
  session,
  3,               // afterMessageIndex
  'try-different-approach',  // optional label
)

console.log(branch.id)               // 'sess_...' (new ID)
console.log(branch.parentId)         // original session ID
console.log(branch.branchAfterIndex) // 3
console.log(branch.branchLabel)      // 'try-different-approach'
console.log(branch.messages.length)  // 4 (messages 0-3 copied)
```

### Diffing branches

```typescript
const diff = branches.diff(sessionA, sessionB)
// {
//   commonLength: 4,       // messages 0-3 are identical
//   onlyInA: [...],        // messages unique to A
//   onlyInB: [...],        // messages unique to B
// }
```

### Merging

```typescript
// Cherry-pick the best continuation from a branch back into another session
const merged = branches.merge(
  targetSession,
  sourceBranch,
  4,    // take messages from sourceBranch starting at index 4
)
```

### Visualizing the tree

```typescript
const tree = branches.buildTree([session, branch1, branch2, branch3])
// BranchTree with root + children[]
```

### Full branching workflow

```typescript
import { SessionManager, BranchManager, Swarm } from 'swarmwire'

const sessions = new SessionManager()
const branches = new BranchManager()
const swarm = new Swarm({ providers: [...], sessions })

// Run baseline conversation
const session = sessions.create('baseline')
await swarm.runInSession(session.id, 'Analyze this codebase...')
await swarm.runInSession(session.id, 'Focus on security issues')
await swarm.runInSession(session.id, 'What are the top 3 risks?')

// Fork at message 4 — try two different follow-up strategies
const branchA = branches.fork(session, 4, 'fix-now')
const branchB = branches.fork(session, 4, 'document-first')

// Run each branch independently
const swarmA = new Swarm({ providers: [...] })
// ... continue conversation on branchA
const swarmB = new Swarm({ providers: [...] })
// ... continue conversation on branchB

// Compare outcomes
const diff = branches.diff(branchA, branchB)
console.log('A had:', diff.onlyInA.length, 'unique turns')
console.log('B had:', diff.onlyInB.length, 'unique turns')
```

---

## Patterns

### Stateful chatbot

```typescript
const sessions = new SessionManager({ maxMessages: 30 })
const swarm = new Swarm({ providers, sessions })

swarm.agent({ name: 'bot', role: 'Support assistant', model: { ... } })

// Route each HTTP request to the same session
app.post('/chat/:userId', async (req, res) => {
  const session = sessions.get(req.params.userId)
    ?? sessions.create(req.params.userId)

  const result = await swarm.runInSession(session.id, req.body.message)
  res.json({ reply: result.output })
})
```

### Replay from failure point

When a long conversation hits an error mid-way, fork from the last good message and retry:

```typescript
const branch = branches.fork(session, lastGoodMessageIndex, 'retry')
// Re-run the conversation from the fork point with a fixed prompt or agent config
```

### Compare two agent configs

```typescript
const session = sessions.create('benchmark')
await swarm.runInSession(session.id, 'Solve this math problem: ...')

const branchDefault = branches.fork(session, 1, 'default-agent')
const branchExpert = branches.fork(session, 1, 'expert-agent')

// Run each branch with different agent configurations
// Then compare outputs
```
