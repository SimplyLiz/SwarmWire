/**
 * A2A Agent Card — describes an agent's capabilities per the Agent2Agent protocol.
 * https://github.com/a2aproject/A2A
 */

import type { Agent } from '../types/agent.js'
import type { AgentCard, AgentProvider, SecurityScheme } from './types.js'

export interface ToAgentCardOptions {
  /** Protocol version to advertise. Default '0.3.0' */
  protocolVersion?: string
  /** Agent provider info */
  provider?: AgentProvider
  /** Icon URL */
  iconUrl?: string
  /** Documentation URL */
  documentationUrl?: string
  /** Security schemes supported */
  securitySchemes?: Record<string, SecurityScheme>
  /** Security requirements (OR-of-ANDs) */
  security?: Record<string, string[]>[]
  /** Whether to enable streaming */
  streaming?: boolean
  /** Whether to enable push notifications */
  pushNotifications?: boolean
  /** Whether to include state transition history */
  stateTransitionHistory?: boolean
  /** Whether the agent supports an extended card for authenticated callers */
  supportsAuthenticatedExtendedCard?: boolean
  /** Default input MIME types. Default ['text/plain', 'application/json'] */
  defaultInputModes?: string[]
  /** Default output MIME types. Default ['text/plain', 'application/json'] */
  defaultOutputModes?: string[]
}

/**
 * Generate an A2A Agent Card from a SwarmWire Agent.
 */
export function toAgentCard(agent: Agent, baseUrl: string, options?: ToAgentCardOptions): AgentCard {
  const opts = options ?? {}

  const card: AgentCard = {
    kind: 'agentCard',
    name: agent.name,
    description: agent.role,
    url: `${baseUrl}`,
    version: '0.1.0',
    protocolVersion: opts.protocolVersion ?? '0.3.0',
    capabilities: {
      streaming: opts.streaming ?? false,
      pushNotifications: opts.pushNotifications ?? false,
      stateTransitionHistory: opts.stateTransitionHistory ?? true,
    },
    skills: agent.capabilities.map((cap) => ({
      id: cap,
      name: cap,
      description: `Capability: ${cap}`,
      tags: [cap],
    })),
    defaultInputModes: opts.defaultInputModes ?? ['text/plain', 'application/json'],
    defaultOutputModes: opts.defaultOutputModes ?? ['text/plain', 'application/json'],
  }

  if (opts.provider) card.provider = opts.provider
  if (opts.iconUrl) card.iconUrl = opts.iconUrl
  if (opts.documentationUrl) card.documentationUrl = opts.documentationUrl
  if (opts.securitySchemes) card.securitySchemes = opts.securitySchemes
  if (opts.security) card.security = opts.security
  if (opts.supportsAuthenticatedExtendedCard) card.supportsAuthenticatedExtendedCard = true

  return card
}

export type { AgentCard, AgentCapabilities, AgentSkill } from './types.js'
