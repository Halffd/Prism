import type { TTSRequest, TTSResult, Result, ServiceConfig } from '@prism/shared-types';

export interface TTSService {
  readonly provider: string;
  synthesize(request: TTSRequest): Promise<Result<TTSResult>>;
}

export class OpenAITTSService implements TTSService {
  readonly provider = 'openai';
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  async synthesize(request: TTSRequest): Promise<Result<TTSResult>> {
    try {
      const response = await fetch(`${this.config.apiUrl || 'https://api.openai.com/v1'}/audio/speech`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model || this.config.model || 'tts-1',
          input: request.text,
          voice: request.voice || 'alloy',
          speed: request.speed || 1.0,
          response_format: request.responseFormat || 'mp3',
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        const err = data.error as Record<string, unknown> | undefined;
        return { ok: false, error: (err?.message as string) || 'OpenAI TTS request failed' };
      }

      const audio = await response.blob();
      return {
        ok: true,
        value: { audio, format: request.responseFormat || 'mp3' },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown TTS error' };
    }
  }
}

export class ElevenLabsTTSService implements TTSService {
  readonly provider = 'elevenlabs';
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  async synthesize(request: TTSRequest): Promise<Result<TTSResult>> {
    try {
      const voiceId = request.voice || '21m00Tcm4TlvDq8ikWAM';
      const response = await fetch(
        `${this.config.apiUrl || 'https://api.elevenlabs.io/v1'}/text-to-speech/${voiceId}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': this.config.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg',
          },
          body: JSON.stringify({
            text: request.text,
            model_id: this.config.model || 'eleven_multilingual_v2',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
        },
      );

      if (!response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        const detail = data.detail as Record<string, unknown> | undefined;
        return { ok: false, error: (detail?.message as string) || 'ElevenLabs TTS request failed' };
      }

      const audio = await response.blob();
      return { ok: true, value: { audio, format: 'mp3' } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown TTS error' };
    }
  }
}

export class GroqTTSService implements TTSService {
  readonly provider = 'groq';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async synthesize(request: TTSRequest): Promise<Result<TTSResult>> {
    return openaiCompatibleTTS(this.config, request, 'https://api.groq.com/openai/v1', 'playai-tts', 'Fritz-PlayAI', 'wav');
  }
}

export class DeepSeekTTSService implements TTSService {
  readonly provider = 'deepseek';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async synthesize(request: TTSRequest): Promise<Result<TTSResult>> {
    return openaiCompatibleTTS(this.config, request, 'https://api.deepseek.com', 'deepseek-tts', 'alloy', 'mp3');
  }
}

export class FireworksTTSService implements TTSService {
  readonly provider = 'fireworks';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async synthesize(request: TTSRequest): Promise<Result<TTSResult>> {
    return openaiCompatibleTTS(this.config, request, 'https://api.fireworks.ai/inference/v1', 'tts-1', 'alloy', 'mp3');
  }
}

export class MistralTTSService implements TTSService {
  readonly provider = 'mistral';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async synthesize(request: TTSRequest): Promise<Result<TTSResult>> {
    return openaiCompatibleTTS(this.config, request, 'https://api.mistral.ai/v1', 'mistral-tts', 'alloy', 'mp3');
  }
}

async function openaiCompatibleTTS(
  config: ServiceConfig,
  request: TTSRequest,
  defaultApiUrl: string,
  defaultModel: string,
  defaultVoice: string,
  defaultFormat: string,
): Promise<Result<TTSResult>> {
  try {
    const response = await fetch(`${config.apiUrl || defaultApiUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model || config.model || defaultModel,
        input: request.text,
        voice: request.voice || defaultVoice,
        response_format: request.responseFormat || defaultFormat,
      }),
    });

    if (!response.ok) {
      const data = (await response.json()) as Record<string, unknown>;
      const err = data.error as Record<string, unknown> | undefined;
      return { ok: false, error: (err?.message as string) || 'TTS request failed' };
    }

    const audio = await response.blob();
    return { ok: true, value: { audio, format: request.responseFormat || defaultFormat } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown TTS error' };
  }
}
