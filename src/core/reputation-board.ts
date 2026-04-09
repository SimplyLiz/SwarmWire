/**
 * ReputationBoard — MessageBoard extended with per-agent reputation scoring.
 *
 * Agents earn reputation based on message quality (upvotes, citation frequency,
 * correct answers). Messages from higher-reputation agents are weighted more
 * heavily when consumers aggregate findings.
 *
 * Inspired by trust/reputation systems in multi-agent literature.
 */

import { MessageBoard } from './messageboard.js'
import type { Message, PostOptions } from './messageboard.js'

export interface ReputationScore {
  agentName: string
  score: number       // 0-1, normalized
  upvotes: number
  citations: number
  correctAnswers: number
  totalMessages: number
}

export interface ReputationConfig {
  /** Initial reputation for unknown agents. Default 0.5 */
  defaultScore?: number
  /** Weight for upvote signal. Default 0.4 */
  upvoteWeight?: number
  /** Weight for citation signal. Default 0.3 */
  citationWeight?: number
  /** Weight for correct-answer signal. Default 0.3 */
  answerWeight?: number
  /** Decay factor applied per consolidation pass (0-1). Default 0.95 */
  decayFactor?: number
}

export interface WeightedMessage extends Message {
  /** Sender's reputation score at time of weighting */
  weight: number
}

export class ReputationBoard extends MessageBoard {
  private readonly reputation: Map<string, ReputationScore> = new Map()
  private readonly defaultScore: number
  private readonly upvoteWeight: number
  private readonly citationWeight: number
  private readonly answerWeight: number
  private readonly decayFactor: number

  constructor(config: ReputationConfig = {}, maxMessages?: number) {
    super(maxMessages)
    this.defaultScore = config.defaultScore ?? 0.5
    this.upvoteWeight = config.upvoteWeight ?? 0.4
    this.citationWeight = config.citationWeight ?? 0.3
    this.answerWeight = config.answerWeight ?? 0.3
    this.decayFactor = config.decayFactor ?? 0.95
  }

  /** Post a message, initializing reputation for new agents */
  override post(from: string, to: string | '*', content: string, options: PostOptions = {}): Message {
    this.ensureAgent(from)
    const msg = super.post(from, to, content, options)

    // Track message count
    const rep = this.reputation.get(from)!
    rep.totalMessages++

    return msg
  }

  /** Upvote a message sender — increases their reputation */
  upvote(messageId: string, voterId: string): boolean {
    const msgs = this.export()
    const msg = msgs.find((m) => m.id === messageId)
    if (!msg || msg.from === voterId) return false

    this.ensureAgent(msg.from)
    this.reputation.get(msg.from)!.upvotes++
    this.recompute(msg.from)
    return true
  }

  /** Record that a message was cited in a subsequent finding */
  cite(sourceMessageId: string): void {
    const msgs = this.export()
    const msg = msgs.find((m) => m.id === sourceMessageId)
    if (!msg) return

    this.ensureAgent(msg.from)
    this.reputation.get(msg.from)!.citations++
    this.recompute(msg.from)
  }

  /** Record a correct answer (question resolved by this agent) */
  markAnswerCorrect(agentName: string): void {
    this.ensureAgent(agentName)
    this.reputation.get(agentName)!.correctAnswers++
    this.recompute(agentName)
  }

  /** Get reputation for an agent (creates default entry if unknown) */
  getReputation(agentName: string): ReputationScore {
    this.ensureAgent(agentName)
    return { ...this.reputation.get(agentName)! }
  }

  /** List all agents sorted by reputation descending */
  leaderboard(): ReputationScore[] {
    return [...this.reputation.values()].sort((a, b) => b.score - a.score)
  }

  /**
   * Read findings weighted by sender reputation.
   * Returns messages sorted by weight × content relevance.
   */
  weightedFindings(consumerAgent: string): WeightedMessage[] {
    const msgs = this.read(consumerAgent, { type: 'finding' })
    return msgs
      .map((m) => ({
        ...m,
        weight: this.getReputation(m.from).score,
      }))
      .sort((a, b) => b.weight - a.weight)
  }

  /**
   * Aggregate findings, blending content weighted by reputation score.
   * Returns a flat string with attribution.
   */
  aggregateFindings(consumerAgent: string): string {
    const weighted = this.weightedFindings(consumerAgent)
    if (weighted.length === 0) return ''

    return weighted
      .map((m) => `[${m.from} rep=${m.weight.toFixed(2)}] ${m.content}`)
      .join('\n')
  }

  /** Apply decay to all scores (call periodically to prevent score inflation) */
  decay(): void {
    for (const rep of this.reputation.values()) {
      rep.score = Math.max(0.1, rep.score * this.decayFactor)
    }
  }

  private ensureAgent(name: string): void {
    if (!this.reputation.has(name)) {
      this.reputation.set(name, {
        agentName: name,
        score: this.defaultScore,
        upvotes: 0,
        citations: 0,
        correctAnswers: 0,
        totalMessages: 0,
      })
    }
  }

  private recompute(agentName: string): void {
    const rep = this.reputation.get(agentName)
    if (!rep) return

    const total = rep.upvotes + rep.citations + rep.correctAnswers
    if (total === 0) {
      rep.score = this.defaultScore
      return
    }

    // Weighted sum of signals, normalized to 0-1
    const raw =
      (rep.upvotes * this.upvoteWeight +
        rep.citations * this.citationWeight +
        rep.correctAnswers * this.answerWeight) /
      Math.max(1, rep.totalMessages)

    // Clamp and blend with default to prevent extremes on small samples
    const blendFactor = Math.min(1, rep.totalMessages / 10)
    rep.score = this.defaultScore * (1 - blendFactor) + Math.min(1, raw * 2) * blendFactor
  }
}
