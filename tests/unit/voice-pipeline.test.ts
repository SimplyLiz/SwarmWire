import { describe, it, expect, vi } from 'vitest'
import { VoicePipeline } from '../../src/voice/index.js'
import type { STTProvider, TTSProvider } from '../../src/voice/index.js'
import type { Agent } from '../../src/types/agent.js'
import type { Provider, ModelConfig } from '../../src/types/provider.js'

function makeSTT(text = 'transcribed text'): STTProvider {
  return { transcribe: vi.fn().mockResolvedValue(text) }
}

function makeTTS(audio = Buffer.from('audio-data')): TTSProvider {
  return { synthesize: vi.fn().mockResolvedValue(audio) }
}

function makeAgent(output = 'agent response'): Agent {
  return {
    id: 'voice-agent',
    name: 'voice-agent',
    role: 'assistant',
    capabilities: [],
    tools: [],
    modelTier: 'standard',
    execute: vi.fn().mockResolvedValue(output),
  }
}

function makeProvider(): Provider {
  return {
    name: 'mock',
    models: [],
    complete: vi.fn().mockResolvedValue({ content: 'response', inputTokens: 5, outputTokens: 5, cachedInputTokens: 0 }),
    countTokens: vi.fn().mockResolvedValue(5),
  }
}

const model: ModelConfig = { name: 'mock-model', provider: 'mock', tier: 'standard' }

describe('VoicePipeline', () => {
  it('processTurn returns a VoiceTurn with non-empty output', async () => {
    const pipeline = new VoicePipeline({
      stt: makeSTT(),
      tts: makeTTS(),
      agent: makeAgent(),
      provider: makeProvider(),
      model,
    })

    const turn = await pipeline.processTurn(Buffer.from('audio input'))
    expect(turn.input).toBe('transcribed text')
    expect(turn.output).toBe('agent response')
    expect(turn.audioOutput.length).toBeGreaterThan(0)
    expect(turn.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('calls STT with the audio buffer', async () => {
    const stt = makeSTT()
    const pipeline = new VoicePipeline({ stt, tts: makeTTS(), agent: makeAgent(), provider: makeProvider(), model })
    const buf = Buffer.from('my audio')
    await pipeline.processTurn(buf)
    expect(stt.transcribe).toHaveBeenCalledWith(buf)
  })

  it('passes transcribed text to agent', async () => {
    const agent = makeAgent()
    const pipeline = new VoicePipeline({ stt: makeSTT('hello world'), tts: makeTTS(), agent, provider: makeProvider(), model })
    await pipeline.processTurn(Buffer.from('audio'))
    expect(agent.execute).toHaveBeenCalledWith('hello world', expect.anything())
  })

  it('passes agent output to TTS', async () => {
    const tts = makeTTS()
    const pipeline = new VoicePipeline({ stt: makeSTT(), tts, agent: makeAgent('say this'), provider: makeProvider(), model })
    await pipeline.processTurn(Buffer.from('audio'))
    expect(tts.synthesize).toHaveBeenCalledWith('say this')
  })

  it('VoicePipeline class has static factory methods', () => {
    expect(typeof VoicePipeline.createDeepgramSTT).toBe('function')
    expect(typeof VoicePipeline.createElevenLabsTTS).toBe('function')
    expect(typeof VoicePipeline.createOpenAISTT).toBe('function')
    expect(typeof VoicePipeline.createOpenAITTS).toBe('function')
  })
})
