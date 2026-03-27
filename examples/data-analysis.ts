/**
 * Example: Data Analysis with Record/Replay
 *
 * Shows the recommended development workflow:
 * 1. Record: Run with real provider, save fixture
 * 2. Develop: Iterate using replay (instant, free, deterministic)
 * 3. Evaluate: Run evals against replay output
 * 4. CI: Fail build if eval scores drop
 *
 * Run with: npx tsx examples/data-analysis.ts
 */

import {
  Swarm,
  createAgent,
  templates,
  RecordingProvider,
  ReplayProvider,
  runEvalSuite,
  runEvalBatch,
  nonEmpty,
  containsKeywords,
  schemaMatch,
  noHallucination,
  dryRun,
  buildPlan,
  CascadeRouter,
  buildModelLadder,
  explainExecution,
} from '../src/index.js'
import type { Task, Provider } from '../src/index.js'

// ─── Mock provider simulating real LLM responses ───

function mockAnalyticsProvider(): Provider {
  return {
    name: 'mock',
    models: [
      { model: 'fast', tier: 'cheap', inputCostPer1kTokens: 0.15, outputCostPer1kTokens: 0.60, contextWindow: 128000 },
      { model: 'smart', tier: 'standard', inputCostPer1kTokens: 3, outputCostPer1kTokens: 15, contextWindow: 200000 },
    ],
    async chat(req) {
      // Simulate different responses based on agent role
      const prompt = req.messages[0]?.content ?? ''
      let content: string

      if (prompt.includes('clean') || req.systemPrompt?.includes('clean')) {
        content = JSON.stringify({
          rowCount: 10000,
          nullColumns: ['region', 'discount'],
          duplicates: 23,
          outliers: { revenue: { count: 5, threshold: '3 std devs' } },
          recommendations: ['Drop 23 duplicate rows', 'Impute nulls in region with mode', 'Cap revenue outliers at $50k'],
        })
      } else if (prompt.includes('pattern') || req.systemPrompt?.includes('pattern')) {
        content = JSON.stringify({
          trends: ['Revenue growing 15% QoQ', 'Customer churn spiking in Q3', 'Mobile traffic overtook desktop in June'],
          correlations: [{ pair: ['ad_spend', 'signups'], r: 0.82 }, { pair: ['page_load_time', 'bounce_rate'], r: 0.91 }],
          segments: ['Enterprise (high LTV, low volume)', 'SMB (medium LTV, high volume)', 'Free tier (conversion funnel)'],
        })
      } else {
        content = JSON.stringify({
          summary: 'Revenue is growing steadily at 15% QoQ with strong enterprise segment performance. Key risk: Q3 churn spike correlates with pricing change. Recommendation: A/B test pricing tiers before Q4.',
          keyMetrics: { revenueGrowth: '15% QoQ', churnRate: '8.2%', ltv: '$2,400', cac: '$180' },
          actionItems: ['Investigate Q3 churn root cause', 'A/B test pricing before Q4', 'Increase mobile optimization investment'],
        })
      }

      return { content, model: req.model, inputTokens: 250, outputTokens: 180, cachedInputTokens: 0, finishReason: 'stop', durationMs: 120 }
    },
    estimateCost: (_m, inp, out) => (inp + out) / 1000 * 3,
  }
}

async function main() {
  const provider = mockAnalyticsProvider()

  console.log('=== Data Analysis with Record/Replay ===\n')

  // ─── Phase 1: Record ───
  console.log('PHASE 1: Record execution with real provider\n')

  const recorder = new RecordingProvider(provider, './fixtures/analysis-run.json')
  const swarm = new Swarm({ providers: [recorder], budget: { maxCostCents: 100 } })

  const cleaner = swarm.agent({
    ...templates.dataAnalyst({ modelTier: 'cheap' }),
    name: 'data-cleaner',
    model: { provider: 'mock', model: 'fast' },
    systemPrompt: 'You are a data cleaner. Analyze the dataset for nulls, duplicates, outliers. Return JSON with cleaning recommendations.',
  })

  const analyst = swarm.agent({
    ...templates.dataAnalyst(),
    name: 'pattern-finder',
    model: { provider: 'mock', model: 'smart' },
    systemPrompt: 'You are a pattern finder. Identify trends, correlations, and customer segments. Return structured JSON.',
  })

  const reporter = swarm.agent({
    ...templates.writer(),
    name: 'report-writer',
    model: { provider: 'mock', model: 'smart' },
    systemPrompt: 'You are a report writer. Synthesize cleaning results and analysis into an executive summary with key metrics and action items. Return JSON.',
  })

  const task: Task = {
    id: 'analysis-1',
    description: 'Analyze Q3 sales data and produce executive summary',
    input: 'Dataset: 10,000 rows of Q1-Q3 sales data with columns: date, region, product, revenue, customer_segment, channel, discount, page_load_time',
    budget: { maxCostCents: 50 },
  }

  // Run pipeline: clean → analyze → report
  const result = await swarm.run(task, {
    pattern: 'pipeline',
    stages: [
      { name: 'clean', agent: cleaner },
      { name: 'analyze', agent: analyst },
      { name: 'report', agent: reporter },
    ],
  })

  console.log(`   Recorded ${recorder.count} LLM interactions`)
  console.log(`   Cost: ${result.cost.totalCostCents.toFixed(2)}c`)
  console.log(`   Output preview: ${String(result.output).slice(0, 100)}...`)

  // Save fixture
  await recorder.save()
  console.log('   Saved to ./fixtures/analysis-run.json\n')

  // ─── Phase 2: Replay ───
  console.log('PHASE 2: Replay from fixture (instant, free, deterministic)\n')

  const replayer = new ReplayProvider('./fixtures/analysis-run.json', { name: 'mock' })
  const replaySwarm = new Swarm({ providers: [replayer], budget: { maxCostCents: 100 } })

  // Re-register agents with same names
  replaySwarm.agent({ ...cleaner, name: 'data-cleaner' } as Parameters<typeof replaySwarm.agent>[0])
  replaySwarm.agent({ ...analyst, name: 'pattern-finder' } as Parameters<typeof replaySwarm.agent>[0])
  replaySwarm.agent({ ...reporter, name: 'report-writer' } as Parameters<typeof replaySwarm.agent>[0])

  const replayResult = await replaySwarm.run(task, {
    pattern: 'pipeline',
    stages: [
      { name: 'clean', agent: cleaner },
      { name: 'analyze', agent: analyst },
      { name: 'report', agent: reporter },
    ],
  })

  console.log(`   Replay cost: ${replayResult.cost.totalCostCents.toFixed(2)}c (should be $0)`)
  console.log(`   Matched: ${replayer.matchedCount}/${replayer.totalCount} fixtures`)
  console.log(`   Output matches original: ${String(result.output) === String(replayResult.output)}\n`)

  // ─── Phase 3: Evaluate ───
  console.log('PHASE 3: Run quality evals\n')

  const evalSuite = {
    name: 'analysis-quality',
    evals: [
      nonEmpty(),
      noHallucination(),
      containsKeywords(['revenue', 'churn', 'recommendation']),
      schemaMatch(['summary', 'keyMetrics', 'actionItems']),
    ],
    threshold: 0.7,
  }

  // Parse output for eval
  let parsedOutput: unknown
  try { parsedOutput = JSON.parse(String(replayResult.output)) } catch { parsedOutput = replayResult.output }

  const evalResult = await runEvalSuite(evalSuite, task.input, parsedOutput as string)

  console.log(`   Suite: ${evalResult.suiteName}`)
  console.log(`   Score: ${(evalResult.averageScore * 100).toFixed(0)}% — ${evalResult.passed ? 'PASSED' : 'FAILED'}`)
  for (const r of evalResult.results) {
    console.log(`   - ${r.evalName}: ${(r.score * 100).toFixed(0)}%`)
  }

  // ─── Phase 4: Cost optimization ───
  console.log('\nPHASE 4: Cost optimization analysis\n')

  const ladder = buildModelLadder([provider])
  console.log(`   Model ladder (${ladder.rungs.length} models):`)
  for (const rung of ladder.rungs) {
    console.log(`   - ${rung.model.model} (${rung.tier}): $${rung.costPer1kTokens.toFixed(2)}/1k tokens`)
  }

  const cascadeRouter = new CascadeRouter({ providers: [provider], qualityThreshold: 0.7 })
  const routeResult = await cascadeRouter.route({
    model: '',
    messages: [{ role: 'user', content: 'Analyze this dataset for trends' }],
  })
  console.log(`\n   CascadeRouter selected: ${routeResult.model.model} (${routeResult.escalations} escalations)`)
  console.log(`   Quality score: ${(routeResult.qualityScore * 100).toFixed(0)}%`)

  console.log('\n=== Done ===')
}

main().catch(console.error)
