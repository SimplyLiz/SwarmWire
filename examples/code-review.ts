/**
 * Example: Code Review Pipeline
 *
 * Multi-agent code review that:
 * 1. Runs security, performance, and quality reviewers in parallel (fan-out)
 * 2. Uses guardrails to block PII in code snippets
 * 3. Validates findings with output contracts
 * 4. Synthesizes into a unified review with approval gate
 *
 * Run with: npx tsx examples/code-review.ts
 */

import {
  Swarm,
  createAgent,
  templates,
  runFanOut,
  piiGuardrail,
  runGuardrails,
  explainExecution,
} from '../src/index.js'
import type { Task, Provider, GuardrailConfig } from '../src/index.js'

function mockProvider(): Provider {
  const reviews: Record<string, string> = {
    security: 'FINDINGS:\n1. SQL injection risk in user_query() at line 42 — uses string concatenation instead of parameterized queries\n2. Missing CSRF token validation on POST /api/update\n3. Passwords stored as MD5 hash — should use bcrypt with salt\nSeverity: 2 critical, 1 high',
    performance: 'FINDINGS:\n1. N+1 query in getUserPosts() — fetches posts then loops to fetch comments individually\n2. Missing index on users.email column — full table scan on login\n3. No connection pooling configured — creates new DB connection per request\nImpact: 3x latency on user dashboard',
    quality: 'FINDINGS:\n1. Function processData() is 200 lines — should be decomposed into smaller functions\n2. No error handling in fetchExternalAPI() — unhandled promise rejection risk\n3. Magic numbers throughout pricing logic — should be named constants\n4. Missing TypeScript strict null checks — 12 potential null pointer issues',
    synthesis: 'CODE REVIEW SUMMARY\n\nCritical (fix before merge):\n- SQL injection in user_query() — parameterize all queries\n- MD5 password hashing — migrate to bcrypt\n\nHigh priority:\n- N+1 query causing 3x latency on dashboard\n- Missing CSRF validation on mutation endpoints\n\nMedium:\n- Add index on users.email\n- Configure connection pooling\n- Decompose processData() function\n\nLow:\n- Replace magic numbers with constants\n- Add strict null checks\n\nOverall: REJECT — 2 critical security issues must be fixed.',
  }

  return {
    name: 'mock',
    models: [{ model: 'reviewer', tier: 'standard', inputCostPer1kTokens: 3, outputCostPer1kTokens: 15, contextWindow: 200000 }],
    async chat(req) {
      let content = 'No specific findings.'
      for (const [key, val] of Object.entries(reviews)) {
        if (req.systemPrompt?.toLowerCase().includes(key)) { content = val; break }
      }
      return { content, model: 'reviewer', inputTokens: 300, outputTokens: 200, cachedInputTokens: 0, finishReason: 'stop', durationMs: 150 }
    },
    estimateCost: (_m, inp, out) => (inp + out) / 1000 * 9,
  }
}

async function main() {
  const provider = mockProvider()
  const swarm = new Swarm({ providers: [provider], budget: { maxCostCents: 100 } })

  // Define reviewer agents
  const securityReviewer = swarm.agent({
    ...templates.codeReviewer(),
    name: 'security-reviewer',
    model: { provider: 'mock', model: 'reviewer' },
    systemPrompt: 'You are a security code reviewer. Focus on OWASP top 10, injection, auth, encryption, and access control.',
  })

  const perfReviewer = swarm.agent({
    ...templates.codeReviewer(),
    name: 'performance-reviewer',
    model: { provider: 'mock', model: 'reviewer' },
    systemPrompt: 'You are a performance code reviewer. Focus on N+1 queries, missing indexes, memory leaks, and latency.',
  })

  const qualityReviewer = swarm.agent({
    ...templates.codeReviewer(),
    name: 'quality-reviewer',
    model: { provider: 'mock', model: 'reviewer' },
    systemPrompt: 'You are a quality code reviewer. Focus on readability, error handling, type safety, and maintainability.',
  })

  const synthesizer = swarm.agent({
    ...templates.synthesizer(),
    name: 'review-synthesizer',
    model: { provider: 'mock', model: 'reviewer' },
    systemPrompt: 'You are a synthesis agent for code review. Merge findings, deduplicate, rank by severity, and give a final verdict.',
  })

  const codeSnippet = `
// user-service.ts
import { db } from './db'
import { md5 } from './crypto'

export async function getUserByEmail(email: string) {
  const result = await db.query("SELECT * FROM users WHERE email = '" + email + "'")
  return result.rows[0]
}

export async function createUser(email: string, password: string) {
  const hash = md5(password)
  await db.query("INSERT INTO users (email, password) VALUES ('" + email + "', '" + hash + "')")
}

export async function getUserPosts(userId: string) {
  const posts = await db.query("SELECT * FROM posts WHERE user_id = " + userId)
  for (const post of posts.rows) {
    post.comments = await db.query("SELECT * FROM comments WHERE post_id = " + post.id)
  }
  return posts.rows
}
`

  const task: Task = {
    id: 'review-1',
    description: 'Review this code for security, performance, and quality issues',
    input: codeSnippet,
    budget: { maxCostCents: 50 },
  }

  console.log('=== Code Review Pipeline ===\n')

  // Step 1: Input guardrail — check for PII in the code
  console.log('1. Running input guardrails...')
  try {
    const guardResult = await runGuardrails([piiGuardrail()], codeSnippet, {
      agentName: 'input-check', executionId: task.id, phase: 'input',
    })
    console.log(`   PII check: ${guardResult.passed ? 'CLEAN' : 'WARNING — PII detected'}\n`)
  } catch {
    console.log('   PII check: BLOCKED — code contains PII, review aborted\n')
    return
  }

  // Step 2: Fan-out to 3 reviewers
  console.log('2. Running 3 reviewers in parallel...')
  const reviewResult = await runFanOut(task, {
    agents: [securityReviewer, perfReviewer, qualityReviewer],
    input: codeSnippet,
    optional: true,
  }, [provider], task.budget)

  for (const out of reviewResult.agentOutputs) {
    console.log(`\n   [${out.agentName}]:`)
    const lines = (out.output as string).split('\n').slice(0, 5)
    for (const line of lines) console.log(`   ${line}`)
    if ((out.output as string).split('\n').length > 5) console.log('   ...')
  }

  // Step 3: Check failures
  const failed = reviewResult.allResults.filter((r) => r.status === 'failed')
  if (failed.length > 0) {
    console.log(`\n   ${failed.length} reviewer(s) failed:`)
    for (const f of failed) console.log(`   - ${f.agentName}: ${f.error}`)
  }

  // Step 4: Synthesize with approval gate
  console.log('\n3. Synthesizing findings...')
  const synthInput = reviewResult.agentOutputs.map((o) => `[${o.agentName}]:\n${o.output}`).join('\n\n---\n\n')
  const synthPlan = await swarm.plan(synthInput, { agents: [synthesizer] })

  // Add approval gate before synthesis (in production, this would be a Slack message or UI button)
  synthPlan.steps[0]!.gate = { type: 'approval', message: 'Approve synthesis of review findings?' }

  const synthResult = await swarm.execute(synthPlan, {
    onApproval: async (gate) => {
      console.log(`   [GATE] ${gate.message} → auto-approved`)
      return 'approved'
    },
  })

  console.log(`\n   Synthesis:\n   ${(synthResult.output as string).replace(/\n/g, '\n   ')}`)

  // Step 5: Summary
  console.log('\n4. Execution summary:')
  console.log(`   Reviews: ${reviewResult.agentOutputs.length} completed, ${failed.length} failed`)
  console.log(`   Cost: ${(reviewResult.cost.totalCostCents + synthResult.cost.totalCostCents).toFixed(2)}c`)
  console.log(`   Events: ${synthResult.events.length} total`)
}

main().catch(console.error)
