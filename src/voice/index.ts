/**
 * Voice Agent Pipeline — STT → LLM → TTS.
 * No WebRTC; processes audio buffers.
 */

import type { Agent } from '../types/agent.js'
import type { Provider, ModelConfig } from '../types/provider.js'

export interface STTProvider {
  transcribe(audioBuffer: Buffer, mimeType?: string): Promise<string>
}

export interface TTSProvider {
  synthesize(text: string): Promise<Buffer>
}

export interface VoicePipelineConfig {
  stt: STTProvider
  tts: TTSProvider
  agent: Agent
  provider: Provider
  model: ModelConfig
  silenceThresholdMs?: number
}

export interface VoiceTurn {
  input: string
  output: string
  audioOutput: Buffer
  durationMs: number
}

export class VoicePipeline {
  private readonly config: VoicePipelineConfig

  constructor(config: VoicePipelineConfig) {
    this.config = config
  }

  async processTurn(audioInput: Buffer): Promise<VoiceTurn> {
    const start = Date.now()

    // 1. STT
    const inputText = await this.config.stt.transcribe(audioInput)

    // 2. Agent
    const context = createMinimalContext()
    const rawOutput = await this.config.agent.execute(inputText, context)
    const outputText = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput)

    // 3. TTS
    const audioOutput = await this.config.tts.synthesize(outputText)

    return {
      input: inputText,
      output: outputText,
      audioOutput,
      durationMs: Date.now() - start,
    }
  }

  // ─── Provider factories (lazy imports) ────────────────────────

  static createDeepgramSTT(apiKey: string): STTProvider {
    return {
      async transcribe(audioBuffer: Buffer, mimeType = 'audio/wav'): Promise<string> {
        const { createClient } = await import('@deepgram/sdk' as string).catch(() => {
          throw new Error('@deepgram/sdk is not installed. Run: npm install @deepgram/sdk')
        })
        const dg = (createClient as (key: string) => unknown)(apiKey)
        const d = dg as {
          listen: {
            prerecorded: {
              transcribeFile: (buf: Buffer, opts: unknown) => Promise<{ result: { results: { channels: [{ alternatives: [{ transcript: string }] }] } } }>
            }
          }
        }
        const { result } = await d.listen.prerecorded.transcribeFile(audioBuffer, { mimetype: mimeType, model: 'nova-2' })
        return result.results.channels[0]?.alternatives[0]?.transcript ?? ''
      },
    }
  }

  static createElevenLabsTTS(apiKey: string, voiceId = '21m00Tcm4TlvDq8ikWAM'): TTSProvider {
    return {
      async synthesize(text: string): Promise<Buffer> {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, model_id: 'eleven_monolingual_v1' }),
        })
        if (!res.ok) throw new Error(`ElevenLabs TTS failed: ${res.status}`)
        return Buffer.from(await res.arrayBuffer())
      },
    }
  }

  static createOpenAISTT(apiKey: string): STTProvider {
    return {
      async transcribe(audioBuffer: Buffer): Promise<string> {
        const { OpenAI } = await import('openai' as string).catch(() => {
          throw new Error('openai is not installed. Run: npm install openai')
        })
        const client = new (OpenAI as new (o: unknown) => {
          audio: {
            transcriptions: {
              create: (params: unknown) => Promise<{ text: string }>
            }
          }
        })({ apiKey })
        const { Blob } = await import('node:buffer')
        const blob = new Blob([audioBuffer], { type: 'audio/wav' })
        const result = await client.audio.transcriptions.create({ file: blob as File, model: 'whisper-1' })
        return result.text
      },
    }
  }

  static createOpenAITTS(apiKey: string, voice = 'alloy'): TTSProvider {
    return {
      async synthesize(text: string): Promise<Buffer> {
        const { OpenAI } = await import('openai' as string).catch(() => {
          throw new Error('openai is not installed. Run: npm install openai')
        })
        const client = new (OpenAI as new (o: unknown) => {
          audio: {
            speech: {
              create: (params: unknown) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>
            }
          }
        })({ apiKey })
        const mp3 = await client.audio.speech.create({ model: 'tts-1', voice, input: text })
        return Buffer.from(await mp3.arrayBuffer())
      },
    }
  }
}

function createMinimalContext(): import('../types/agent.js').AgentContext {
  return {
    executionId: `voice_${Date.now().toString(36)}`,
    budgetRemaining: {},
    llm: async () => '',
    tool: async () => { throw new Error('tools not available in voice context') },
    trace: () => {},
    getStepOutput: () => undefined,
    board: {
      post() {},
      read() { return [] },
      inbox() { return [] },
      findings() { return [] },
      warnings() { return [] },
      reply() {},
    },
    deps: {},
  }
}
