import type { AudioGenRequest, AudioGenResult, Result, ServiceConfig } from '@prism/shared-types';

export interface AudioGenService {
  readonly provider: string;
  generate(request: AudioGenRequest): Promise<Result<AudioGenResult>>;
}

export class ElevenLabsAudioGenService implements AudioGenService {
  readonly provider = 'elevenlabs';
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  async generate(request: AudioGenRequest): Promise<Result<AudioGenResult>> {
    try {
      const response = await fetch(
        `${this.config.apiUrl || 'https://api.elevenlabs.io/v1'}/sound-generation`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': this.config.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: request.prompt,
            duration_seconds: request.duration,
            output_format: request.outputFormat || 'mp3',
          }),
        },
      );

      if (!response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        const detail = data.detail as Record<string, unknown> | undefined;
        return { ok: false, error: (detail?.message as string) || 'ElevenLabs audio gen request failed' };
      }

      const audio = await response.blob();
      return {
        ok: true,
        value: { audio, duration: request.duration || 0, format: request.outputFormat || 'mp3' },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown audio gen error' };
    }
  }
}

export class StabilityAudioGenService implements AudioGenService {
  readonly provider = 'stability';
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  async generate(request: AudioGenRequest): Promise<Result<AudioGenResult>> {
    try {
      const formData = new FormData();
      formData.append('prompt', request.prompt);
      if (request.duration) formData.append('duration', String(request.duration));

      const response = await fetch(
        `${this.config.apiUrl || 'https://api.stability.ai/v2beta'}/stable-audio/generate`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          body: formData,
        },
      );

      if (!response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        return { ok: false, error: (data.message as string) || 'Stability audio gen request failed' };
      }

      const audio = await response.blob();
      return {
        ok: true,
        value: { audio, duration: request.duration || 0, format: request.outputFormat || 'wav' },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown audio gen error' };
    }
  }
}

export class HuggingFaceAudioGenService implements AudioGenService {
  readonly provider = 'huggingface';
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  async generate(request: AudioGenRequest): Promise<Result<AudioGenResult>> {
    try {
      const model = this.config.model || 'facebook/musicgen-small';
      const response = await fetch(
        `${this.config.apiUrl || 'https://api-inference.huggingface.co/models'}/${model}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: request.prompt,
            parameters: {
              max_new_tokens: Math.min((request.duration || 10) * 50, 1500),
            },
          }),
        },
      );

      if (!response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        return { ok: false, error: (data.error as string) || 'HuggingFace audio gen request failed' };
      }

      const audio = await response.blob();
      return {
        ok: true,
        value: { audio, duration: request.duration || 0, format: 'wav' },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown audio gen error' };
    }
  }
}
