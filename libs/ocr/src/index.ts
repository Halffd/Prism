import type { OCRRequest, OCRResult, Result, ServiceConfig } from '@prism/shared-types';

export interface OCRService {
  readonly provider: string;
  recognize(request: OCRRequest): Promise<Result<OCRResult>>;
}

export class OpenAIOCRService implements OCRService {
  readonly provider = 'openai';
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  async recognize(request: OCRRequest): Promise<Result<OCRResult>> {
    try {
      const base64 = typeof request.image === 'string'
        ? request.image
        : await this.blobToBase64(request.image);

      const response = await fetch(`${this.config.apiUrl || 'https://api.openai.com/v1'}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model || 'gpt-4o',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Extract all text from this image. Return only the text content.' },
              { type: 'image_url', image_url: { url: base64 } },
            ],
          }],
          max_tokens: 4096,
        }),
      });

        const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        const err = data.error as Record<string, unknown> | undefined;
        return { ok: false, error: (err?.message as string) || 'OpenAI OCR request failed' };
      }

      const choices = data.choices as Array<Record<string, unknown>> | undefined;
      const message = choices?.[0]?.message as Record<string, unknown> | undefined;
      const text = (message?.content as string) || '';
      return {
        ok: true,
        value: { text, confidence: 0.9, language: request.language },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown OCR error' };
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

export class GeminiOCRService implements OCRService {
  readonly provider = 'gemini';
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  async recognize(request: OCRRequest): Promise<Result<OCRResult>> {
    try {
      const base64 = typeof request.image === 'string'
        ? request.image
        : await this.blobToBase64(request.image);

      const requestParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        { text: 'Extract all text from this image. Return only the text content.' },
      ];

      if (base64.startsWith('data:')) {
        const [header, data] = base64.split(',');
        const mimeType = header.split(';')[0].replace('data:', '');
        requestParts.push({ inlineData: { mimeType, data } });
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.config.model || 'gemini-2.5-flash'}:generateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: requestParts }] }),
        },
      );

      const respData = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        const err = respData.error as Record<string, unknown> | undefined;
        return { ok: false, error: (err?.message as string) || 'Gemini OCR request failed' };
      }

      const candidates = respData.candidates as Array<Record<string, unknown>> | undefined;
      const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
      const responseParts = content?.parts as Array<Record<string, unknown>> | undefined;
      const text = (responseParts?.[0]?.text as string) || '';
      return {
        ok: true,
        value: { text, confidence: 0.85, language: request.language },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown OCR error' };
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

export class ClaudeOCRService implements OCRService {
  readonly provider = 'claude';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }

  async recognize(request: OCRRequest): Promise<Result<OCRResult>> {
    try {
      const base64 = typeof request.image === 'string'
        ? request.image
        : await this.blobToBase64(request.image);

      const content: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = [
        { type: 'text', text: 'Extract all text from this image. Return only the text content.' },
      ];

      if (base64.startsWith('data:')) {
        const match = base64.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (match) {
          content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
        }
      }

      const response = await fetch(`${this.config.apiUrl || 'https://api.anthropic.com/v1'}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.config.apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.model || 'claude-3-5-sonnet-20241022',
          max_tokens: 4096,
          messages: [{ role: 'user', content }],
        }),
      });

      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        const err = data.error as Record<string, unknown> | undefined;
        return { ok: false, error: (err?.message as string) || 'Claude OCR request failed' };
      }

      const contentItems = data.content as Array<Record<string, unknown>> | undefined;
      const text = (contentItems?.[0]?.text as string) || '';
      return {
        ok: true,
        value: { text, confidence: 0.88, language: request.language },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown OCR error' };
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

export class GroqOCRService implements OCRService {
  readonly provider = 'groq';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }

  async recognize(request: OCRRequest): Promise<Result<OCRResult>> {
    return openaiCompatibleOCR(this.config, request, 'https://api.groq.com/openai/v1', 'llama-3.2-90b-vision-preview');
  }
}

export class DeepSeekOCRService implements OCRService {
  readonly provider = 'deepseek';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async recognize(request: OCRRequest): Promise<Result<OCRResult>> {
    return openaiCompatibleOCR(this.config, request, 'https://api.deepseek.com', 'deepseek-chat');
  }
}

export class QwenOCRService implements OCRService {
  readonly provider = 'qwen';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async recognize(request: OCRRequest): Promise<Result<OCRResult>> {
    return openaiCompatibleOCR(this.config, request, 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-vl-plus');
  }
}

export class MistralOCRSService implements OCRService {
  readonly provider = 'mistral';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async recognize(request: OCRRequest): Promise<Result<OCRResult>> {
    return openaiCompatibleOCR(this.config, request, 'https://api.mistral.ai/v1', 'pixtral-large-latest');
  }
}

export class OpenRouterOCRService implements OCRService {
  readonly provider = 'openrouter';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async recognize(request: OCRRequest): Promise<Result<OCRResult>> {
    return openaiCompatibleOCR(this.config, request, 'https://openrouter.ai/api/v1', 'openai/gpt-4o', { 'HTTP-Referer': 'https://prism.ai', 'X-Title': 'Prism' });
  }
}

async function openaiCompatibleOCR(
  config: ServiceConfig,
  request: OCRRequest,
  defaultApiUrl: string,
  defaultModel: string,
  extraHeaders?: Record<string, string>,
): Promise<Result<OCRResult>> {
  try {
    const base64 = typeof request.image === 'string'
      ? request.image
      : await blobToBase64(request.image);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    };

    const response = await fetch(`${config.apiUrl || defaultApiUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model || defaultModel,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Extract all text from this image. Return only the text content.' },
            { type: 'image_url', image_url: { url: base64 } },
          ],
        }],
        max_tokens: 4096,
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const err = data.error as Record<string, unknown> | undefined;
      return { ok: false, error: (err?.message as string) || 'OCR request failed' };
    }

    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    const text = (message?.content as string) || '';
    return { ok: true, value: { text, confidence: 0.85, language: request.language } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown OCR error' };
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
