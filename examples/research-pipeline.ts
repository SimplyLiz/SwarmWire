/**
 * Example: Research Pipeline
 *
 * Multi-agent research workflow that:
 * 1. Classifies the research topic
 * 2. Fans out to 3 specialist researchers in parallel
 * 3. Synthesizes findings with conflict detection
 * 4. Validates output quality with evals
 *
 * Run with: npx tsx examples/research-pipeline.ts
 * (Uses mock provider — no API keys needed)
 */

import {
  Swarm,
  createProvider,
  templates,
  runFanOut,
  detectConflicts,
  resolveConflict,
  explainExecution,
  summarizeExecution,
  dryRun,
  buildPlan,
  runEvalSuite,
  nonEmpty,
  lengthCheck,
  containsKeywords,
} from '../src/index.js'
import type { Task, Provider } from '../src/index.js'

// ─── Mock Provider (replace with real API keys for production) ───

function mockResearchProvider(): Provider {
  const responses: Record<string, string> = {
    classifier: JSON.stringify({ domain: 'databases', complexity: 'moderate', aspects: ['performance', 'developer-experience', 'ecosystem'] }),
    'perf-researcher': 'PostgreSQL benchmarks show 50k TPS for simple reads. MongoDB handles 100k TPS for document lookups but drops to 5k TPS for complex aggregations. SQLite excels at single-user workloads with sub-millisecond latency.',
    'dx-researcher': 'Prisma provides the best TypeScript DX with auto-generated types. Drizzle is lighter weight with SQL-like syntax. Knex.js offers raw query power but requires manual type definitions.',
    'ecosystem-researcher': 'PostgreSQL has 30+ years of ecosystem. PlanetScale (MySQL) offers serverless branching. Turso (SQLite) provides edge deployment. Neon (PostgreSQL) offers serverless with branching.',
    synthesizer: 'Based on the research:\n\n1. **For TypeScript projects**: Use PostgreSQL with Prisma for the best type-safe DX\n2. **For high-read workloads**: Consider MongoDB with Mongoose\n3. **For edge deployment**: Turso (SQLite) offers the lowest latency\n4. **For serverless**: Neon or PlanetScale provide automatic scaling\n\nKey trade-off: PostgreSQL offers the richest ecosystem but requires more operational overhead than serverless alternatives.',
  }

  let callCount = 0
  return {
    name: 'mock',
    models: [
      { model: 'fast', tier: 'cheap', inputCostPer1kTokens: 0.15, outputCostPer1kTokens: 0.60, contextWindow: 128000 },
      { model: 'smart', tier: 'standard', inputCostPer1kTokens: 3, outputCostPer1kTokens: 15, contextWindow: 200000 },
    ],
    async chat(req) {
      callCount++
      // Match response to agent based on system prompt keywords
      let content = `Research response #${callCount}`
      for (const [key, val] of Object.entries(responses)) {
        if (req.systemPrompt?.toLowerCase().includes(key) || req.messages.some((m) => m.content.toLowerCase().includes(key))) {
          content = val
          break
        }
      }
      return { content, model: req.model, inputTokens: 200, outputTokens: 150, cachedInputTokens: 0, finishReason: 'stop', durationMs: 100 }
    },
    estimateCost: (_m, inp, out) => (inp + out) / 1000 * 3,
  }
}

// ─── Main ───

async function main() {
  const provider = mockResearchProvider()
  const swarm = new Swarm({
    providers: [provider],
    budget: { maxCostCents: 500 },
  })

  // Define agents
  const classifier = swarm.agent({
    ...templates.researcher({ modelTier: 'cheap' }),
    name: 'classifier',
    role: 'Classify research topics',
    model: { provider: 'mock', model: 'fast' },
    systemPrompt: 'You are a classifier. Categorize the research topic and identify key aspects to investigate.',
  })

  const perfResearcher = swarm.agent({
    ...templates.researcher(),
    name: 'perf-researcher',
    role: 'Research performance characteristics',
    model: { provider: 'mock', model: 'smart' },
    systemPrompt: 'You are a perf-researcher. Focus on benchmarks, throughput, latency, and scalability.',
  })

  const dxResearcher = swarm.agent({
    ...templates.researcher(),
    name: 'dx-researcher',
    role: 'Research developer experience',
    model: { provider: 'mock', model: 'smart' },
    systemPrompt: 'You are a dx-researcher. Focus on API design, TypeScript support, documentation quality, and learning curve.',
  })

  const ecoResearcher = swarm.agent({
    ...templates.researcher(),
    name: 'ecosystem-researcher',
    role: 'Research ecosystem and community',
    model: { provider: 'mock', model: 'smart' },
    systemPrompt: 'You are an ecosystem-researcher. Focus on community size, package ecosystem, hosting options, and long-term viability.',
  })

  const synthesizer = swarm.agent({
    ...templates.synthesizer(),
    name: 'synthesizer',
    role: 'Synthesize research into actionable recommendations',
    model: { provider: 'mock', model: 'smart' },
    systemPrompt: 'You are a synthesizer. Merge multiple research perspectives into clear, ranked recommendations with trade-offs.',
  })

  const task: Task = {
    id: 'research-1',
    description: 'Research the best database options for a TypeScript web application',
    input: 'Compare PostgreSQL, MongoDB, SQLite, and MySQL for a TypeScript/Node.js web app. Consider performance, developer experience, and ecosystem.',
    budget: { maxCostCents: 200 },
  }

  console.log('=== Research Pipeline Example ===\n')

  // Step 1: Dry-run — estimate cost before spending money
  console.log('1. Dry-run cost projection:')
  const plan = await swarm.plan(task.description, {
    agents: [classifier, perfResearcher, dxResearcher, ecoResearcher, synthesizer],
  })
  const projection = dryRun(plan, [provider])
  console.log(`   Estimated cost: ${projection.estimatedCost.likelyCents.toFixed(1)}c (${projection.estimatedCost.minCents.toFixed(1)}-${projection.estimatedCost.maxCents.toFixed(1)}c)`)
  console.log(`   Steps: ${projection.totalSteps} (${projection.parallelSteps} parallel)`)
  console.log(`   Will exceed budget: ${projection.willExceedBudget}\n`)

  // Step 2: Classify the topic
  console.log('2. Classifying topic...')
  const classResult = await swarm.run(task.input, { agents: [classifier] })
  console.log(`   Classification: ${typeof classResult.output === 'string' ? classResult.output.slice(0, 100) : JSON.stringify(classResult.output).slice(0, 100)}...\n`)

  // Step 3: Fan-out to 3 researchers in parallel
  console.log('3. Fanning out to 3 researchers...')
  const researchResult = await runFanOut(task, {
    agents: [perfResearcher, dxResearcher, ecoResearcher],
    input: task.input,
    optional: true,
  }, [provider], task.budget)

  console.log(`   ${researchResult.agentOutputs.length} researchers completed`)
  for (const out of researchResult.agentOutputs) {
    const preview = typeof out.output === 'string' ? out.output.slice(0, 80) : String(out.output).slice(0, 80)
    console.log(`   - ${out.agentName}: ${preview}...`)
  }

  // Step 4: Check for conflicts
  const conflicts = detectConflicts(researchResult.agentOutputs)
  if (conflicts.length > 0) {
    console.log(`\n   Conflicts detected: ${conflicts.length}`)
    for (const c of conflicts) {
      const resolution = resolveConflict(c, researchResult.agentOutputs, 'evidence_weight')
      console.log(`   - ${c.type}: ${c.description} → resolved via ${resolution.method}`)
    }
  }

  // Step 5: Synthesize
  console.log('\n4. Synthesizing findings...')
  const synthInput = researchResult.agentOutputs.map((o) => `[${o.agentName}]: ${o.output}`).join('\n\n')
  const synthResult = await swarm.run(synthInput, { agents: [synthesizer] })
  console.log(`\n   Final output:\n   ${typeof synthResult.output === 'string' ? synthResult.output.replace(/\n/g, '\n   ') : JSON.stringify(synthResult.output)}`)

  // Step 6: Evaluate quality
  console.log('\n5. Running quality evals...')
  const evalResult = await runEvalSuite({
    name: 'research-quality',
    evals: [
      nonEmpty(),
      lengthCheck(100, 5000),
      containsKeywords(['postgresql', 'typescript', 'trade-off']),
    ],
    threshold: 0.7,
  }, task.input, synthResult.output as string)

  console.log(`   Score: ${(evalResult.averageScore * 100).toFixed(0)}% — ${evalResult.passed ? 'PASSED' : 'FAILED'}`)
  for (const r of evalResult.results) {
    console.log(`   - ${r.evalName}: ${(r.score * 100).toFixed(0)}%`)
  }

  // Summary
  console.log('\n6. Execution summary:')
  console.log(`   ${summarizeExecution(synthResult)}`)
  console.log(`   Total research cost: ${(researchResult.cost.totalCostCents + synthResult.cost.totalCostCents).toFixed(2)}c`)
}

main().catch(console.error)
