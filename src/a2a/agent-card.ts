/**
 * A2A Agent Card — describes an agent's capabilities per the Agent2Agent protocol.
 * https://github.com/a2aproject/A2A
 */

import type { Agent } from '../types/agent.js'

export interface AgentCard {
  name: string
  description: string
  url: string
  version: string
  capabilities: AgentCapabilities
  skills: AgentSkill[]
  defaultInputModes: string[]
  defaultOutputModes: string[]
}

export interface AgentCapabilities {
  streaming?: boolean
  pushNotifications?: boolean
  stateTransitionHistory?: boolean
}

export interface AgentSkill {
  id: string
  name: string
  description: string
  tags: string[]
  examples?: string[]
}

/**
 * Generate an A2A Agent Card from a SwarmWire Agent.
 */
export function toAgentCard(agent: Agent, baseUrl: string): AgentCard {
  return {
    name: agent.name,
    description: agent.role,
    url: `${baseUrl}/a2a/${agent.name}`,
    version: '0.1.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    skills: agent.capabilities.map((cap) => ({
      id: cap,
      name: cap,
      description: `Capability: ${cap}`,
      tags: [cap],
    })),
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
  }
}
