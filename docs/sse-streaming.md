# SSE Streaming

> Pipe SwarmWire agent execution to web clients via Server-Sent Events.

---

## Quick Start

```typescript
import http from 'node:http'
import { Swarm, createProvider } from 'swarmwire'
import { sseHeaders, pipeToSSE, sseEvent } from 'swarmwire/transport'

const swarm = new Swarm({
  providers: [createProvider('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY })],
})

swarm.agent({ name: 'researcher', role: 'Research topics', model: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260320' } })

http.createServer(async (req, res) => {
  if (req.url !== '/run') { res.writeHead(404).end(); return }

  sseHeaders(res)
  const result = await pipeToSSE(swarm.stream('Research TypeScript ORMs'), res)
  sseEvent(res, 'done', { output: result.output })
  res.end()
}).listen(3000)
```

Client:
```javascript
const source = new EventSource('http://localhost:3000/run')

source.addEventListener('step:start', (e) => {
  const { agentName } = JSON.parse(e.data)
  console.log(`Agent ${agentName} starting...`)
})

source.addEventListener('step:complete', (e) => {
  const { agentName, durationMs, costCents } = JSON.parse(e.data)
  console.log(`Agent ${agentName} done: ${durationMs}ms, ${costCents}c`)
})

source.addEventListener('budget:warning', (e) => {
  console.warn('Budget warning:', JSON.parse(e.data))
})

source.addEventListener('result', (e) => {
  const { output, cost } = JSON.parse(e.data)
  console.log('Final output:', output)
  console.log('Total cost:', cost.totalCostCents, 'cents')
  source.close()
})

source.addEventListener('done', () => source.close())
```

---

## API

### `sseHeaders(res)`

Write standard SSE headers. Call before sending events.

```typescript
import { sseHeaders } from 'swarmwire/transport'
sseHeaders(res) // Sets Content-Type, Cache-Control, Connection, X-Accel-Buffering
```

### `sseEvent(res, event, data)`

Send a single named SSE event.

```typescript
import { sseEvent } from 'swarmwire/transport'
sseEvent(res, 'progress', { step: 1, total: 5 })
// Produces: event: progress\ndata: {"step":1,"total":5}\n\n
```

### `pipeToSSE(stream, res, options?)`

Pipe a `swarm.stream()` AsyncGenerator to an SSE response. Returns the final `ExecutionResult` when the stream completes.

```typescript
import { pipeToSSE } from 'swarmwire/transport'

const result = await pipeToSSE(swarm.stream(task, options), res, {
  heartbeatMs: 15_000,   // Keep-alive interval (default 15s)
  includeTrace: false,    // Skip trace details to save bandwidth
})
```

---

## SSE Event Types

Every `SwarmEvent` maps to an SSE event name:

| SSE Event | Data Fields | When |
|-----------|-------------|------|
| `plan:created` | `{ planId, steps }` | Plan built, before execution |
| `step:start` | `{ stepId, agentName }` | Agent begins work |
| `step:complete` | `{ stepId, agentName, durationMs, costCents }` | Agent finished |
| `step:error` | `{ stepId, agentName, error }` | Agent failed |
| `budget:warning` | `{ usage }` | Budget at warning threshold |
| `budget:exhausted` | `{}` | Budget exceeded |
| `execution:complete` | `{ durationMs, costCents }` | All steps done |
| `result` | `{ output, confidence, partial, cost, agentCount }` | Final result (sent by pipeToSSE) |

---

## Framework Recipes

### Express

```typescript
import express from 'express'
import { Swarm, createProvider } from 'swarmwire'
import { sseHeaders, pipeToSSE, sseEvent } from 'swarmwire/transport'

const app = express()
const swarm = new Swarm({ providers: [createProvider('anthropic', { apiKey: '...' })] })
swarm.agent({ name: 'worker', role: 'Work', model: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260320' } })

app.get('/api/run', async (req, res) => {
  const query = req.query.q as string ?? 'Hello'

  sseHeaders(res)
  sseEvent(res, 'status', { message: 'Starting...' })

  const result = await pipeToSSE(
    swarm.stream(query, { budget: { maxCostCents: 50 } }),
    res,
  )

  sseEvent(res, 'done', { output: result.output, cost: result.cost.totalCostCents })
  res.end()
})

app.listen(3000)
```

### Fastify

```typescript
import Fastify from 'fastify'
import { Swarm, createProvider } from 'swarmwire'
import { sseHeaders, pipeToSSE, sseEvent } from 'swarmwire/transport'

const fastify = Fastify()
const swarm = new Swarm({ providers: [createProvider('anthropic', { apiKey: '...' })] })
swarm.agent({ name: 'worker', role: 'Work', model: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260320' } })

fastify.get('/api/run', async (request, reply) => {
  const raw = reply.raw

  sseHeaders(raw)
  const result = await pipeToSSE(swarm.stream(request.query.q ?? 'Hello'), raw)
  sseEvent(raw, 'done', { output: result.output })
  raw.end()
})

fastify.listen({ port: 3000 })
```

### Next.js Route Handler

```typescript
// app/api/run/route.ts
import { Swarm, createProvider } from 'swarmwire'
import { sseEvent } from 'swarmwire/transport'

const swarm = new Swarm({ providers: [createProvider('anthropic', { apiKey: '...' })] })
swarm.agent({ name: 'worker', role: 'Work', model: { provider: 'anthropic', model: 'claude-sonnet-4-6-20260320' } })

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q') ?? 'Hello'

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      for await (const event of swarm.stream(query)) {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
```

### React Client (with EventSource)

```typescript
import { useState, useEffect } from 'react'

interface SwarmStatus {
  running: boolean
  events: Array<{ type: string; data: unknown; time: number }>
  result: unknown | null
  cost: number
}

function useSwarmSSE(url: string): SwarmStatus {
  const [status, setStatus] = useState<SwarmStatus>({
    running: false, events: [], result: null, cost: 0,
  })

  useEffect(() => {
    const source = new EventSource(url)
    setStatus((s) => ({ ...s, running: true }))

    const addEvent = (type: string, data: unknown) => {
      setStatus((s) => ({
        ...s,
        events: [...s.events, { type, data, time: Date.now() }],
      }))
    }

    source.addEventListener('step:start', (e) => addEvent('step:start', JSON.parse(e.data)))
    source.addEventListener('step:complete', (e) => addEvent('step:complete', JSON.parse(e.data)))
    source.addEventListener('step:error', (e) => addEvent('step:error', JSON.parse(e.data)))
    source.addEventListener('budget:warning', (e) => addEvent('budget:warning', JSON.parse(e.data)))

    source.addEventListener('result', (e) => {
      const data = JSON.parse(e.data)
      setStatus((s) => ({ ...s, result: data.output, cost: data.cost?.totalCostCents ?? 0 }))
    })

    source.addEventListener('done', () => {
      setStatus((s) => ({ ...s, running: false }))
      source.close()
    })

    source.onerror = () => {
      setStatus((s) => ({ ...s, running: false }))
      source.close()
    }

    return () => source.close()
  }, [url])

  return status
}

// Usage:
function AgentDashboard() {
  const { running, events, result, cost } = useSwarmSSE('/api/run?q=Analyze+codebase')

  return (
    <div>
      <p>{running ? 'Running...' : 'Done'} | Cost: {cost}c</p>
      <ul>
        {events.map((e, i) => (
          <li key={i}>[{e.type}] {JSON.stringify(e.data)}</li>
        ))}
      </ul>
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  )
}
```

---

## Nginx Configuration

If running behind nginx, disable buffering for SSE:

```nginx
location /api/run {
    proxy_pass http://localhost:3000;
    proxy_set_header Connection '';
    proxy_http_version 1.1;
    chunked_transfer_encoding off;
    proxy_buffering off;
    proxy_cache off;
}
```

The `X-Accel-Buffering: no` header (set by `sseHeaders()`) also tells nginx to disable buffering, but the explicit config is more reliable.

---

## Connection Management

### Heartbeats

`pipeToSSE` sends `: heartbeat\n\n` comments every 15 seconds (configurable) to prevent proxies and browsers from closing idle connections.

### Client Reconnection

EventSource auto-reconnects on disconnect. To prevent duplicate work, track the last event ID:

```typescript
// Server: include sequence numbers
let seq = 0
sseEvent(res, 'step:complete', { ...data, seq: ++seq })

// Client: reconnect from last seen
const source = new EventSource(`/api/run?after=${lastSeq}`)
```

### Cancellation

Close the response to cancel execution:

```typescript
req.on('close', () => {
  // Client disconnected — execution continues but SSE stops
  // To actually cancel: implement AbortController integration
  res.end()
})
```
