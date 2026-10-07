import type { STTRequest, STTResult, Result, ServiceConfig } from '@prism/shared-types';

export interface STTService {
  readonly provider: string;
  transcribe(request: STTRequest): Promise<Result<STTResult>>;
}

export class OpenAISTTService implements STTService {
  readonly provider = 'openai';
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  async transcribe(request: STTRequest): Promise<Result<STTResult>> {
    try {
      const formData = new FormData();
      formData.append('file', request.audio, `recording.${request.mimeType?.split('/')[1] || 'webm'}`);
      formData.append('model', this.config.model || 'whisper-1');
      formData.append('response_format', 'verbose_json');
      if (request.language) formData.append('language', request.language);

      const response = await fetch(`${this.config.apiUrl || 'https://api.openai.com/v1'}/audio/transcriptions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
        body: formData,
      });

      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        const err = data.error as Record<string, unknown> | undefined;
        return { ok: false, error: (err?.message as string) || 'OpenAI STT request failed' };
      }

      return {
        ok: true,
        value: {
          text: data.text as string,
          language: data.language as string | undefined,
          duration: data.duration as number | undefined,
          segments: (data.segments as Array<Record<string, unknown>> | undefined)?.map((s) => ({
            text: s.text as string,
            start: s.start as number,
            end: s.end as number,
            confidence: Math.exp(s.avg_logprob as number),
          })),
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown STT error' };
    }
  }
}

export class GeminiSTTService implements STTService {
  readonly provider = 'gemini';
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  async transcribe(request: STTRequest): Promise<Result<STTResult>> {
    try {
      const base64 = await this.blobToBase64(request.audio);
      const mimeType = request.mimeType || 'audio/webm';

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model || 'gemini-2.5-flash'}:generateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { text: 'Transcribe this audio. Return only the transcribed text.' },
                { inlineData: { mimeType, data: base64 } },
              ],
            }],
          }),
        },
      );

      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        const err = data.error as Record<string, unknown> | undefined;
        return { ok: false, error: (err?.message as string) || 'Gemini STT request failed' };
      }

      const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
      const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
      const parts = content?.parts as Array<Record<string, unknown>> | undefined;
      const text = (parts?.[0]?.text as string) || '';
      return { ok: true, value: { text, language: request.language } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown STT error' };
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

export class GroqSTTService implements STTService {
  readonly provider = 'groq';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async transcribe(request: STTRequest): Promise<Result<STTResult>> {
    return openaiCompatibleSTT(this.config, request, 'https://api.groq.com/openai/v1', 'whisper-large-v3');
  }
}

export class DeepSeekSTTService implements STTService {
  readonly provider = 'deepseek';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async transcribe(request: STTRequest): Promise<Result<STTResult>> {
    return openaiCompatibleSTT(this.config, request, 'https://api.deepseek.com', 'deepseek-chat');
  }
}

export class FireworksSTTService implements STTService {
  readonly provider = 'fireworks';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async transcribe(request: STTRequest): Promise<Result<STTResult>> {
    return openaiCompatibleSTT(this.config, request, 'https://api.fireworks.ai/inference/v1', 'whisper-v3');
  }
}

async function openaiCompatibleSTT(
  config: ServiceConfig,
  request: STTRequest,
  defaultApiUrl: string,
  defaultModel: string,
): Promise<Result<STTResult>> {
  try {
    const formData = new FormData();
    formData.append('file', request.audio, `recording.${request.mimeType?.split('/')[1] || 'webm'}`);
    formData.append('model', config.model || defaultModel);
    formData.append('response_format', 'verbose_json');
    if (request.language) formData.append('language', request.language);

    const response = await fetch(`${config.apiUrl || defaultApiUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      body: formData,
    });

    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const err = data.error as Record<string, unknown> | undefined;
      return { ok: false, error: (err?.message as string) || 'STT request failed' };
    }

    return {
      ok: true,
      value: {
        text: data.text as string,
        language: data.language as string | undefined,
        duration: data.duration as number | undefined,
        segments: (data.segments as Array<Record<string, unknown>> | undefined)?.map((s) => ({
          text: s.text as string,
          start: s.start as number,
          end: s.end as number,
          confidence: Math.exp(s.avg_logprob as number),
        })),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown STT error' };
  }
}
