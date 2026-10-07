import type { LLMRequest, LLMResult, Message, Result, ServiceConfig } from '@prism/shared-types';

export interface LLMService {
  readonly provider: string;
  complete(request: LLMRequest): Promise<Result<LLMResult>>;
}

function toOpenAIMessages(messages: Message[]): Record<string, unknown>[] {
  return messages.map((msg) => {
    if (msg.images && msg.images.length > 0) {
      const content: Array<Record<string, unknown>> = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      msg.images.forEach((img) => content.push({ type: 'image_url', image_url: { url: img } }));
      return { role: msg.role, content };
    }
    return { role: msg.role, content: msg.content };
  });
}

function extractChoice(data: Record<string, unknown>): { content: string; finishReason: string | undefined } {
  const choices = (data.choices as Record<string, unknown>[]) || [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const msg = first?.message as Record<string, unknown> | undefined;
  return {
    content: (msg?.content as string) || '',
    finishReason: first?.finish_reason as string | undefined,
  };
}

function extractUsage(data: Record<string, unknown>): number | undefined {
  const usage = data.usage as Record<string, unknown> | undefined;
  return usage?.total_tokens as number | undefined;
}

async function openaiCompatibleComplete(
  config: ServiceConfig,
  request: LLMRequest,
  defaultBaseUrl: string,
  defaultModel: string,
  extraHeaders?: Record<string, string>,
): Promise<Result<LLMResult>> {
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    };
    const response = await fetch(
      `${config.apiUrl || defaultBaseUrl}/chat/completions`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: request.model || config.model || defaultModel,
          messages: toOpenAIMessages(request.messages),
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          top_p: request.topP,
          frequency_penalty: request.frequencyPenalty,
          presence_penalty: request.presencePenalty,
          stream: false,
        }),
      },
    );

    if (!response.ok) {
      const data = (await response.json()) as Record<string, unknown>;
      const errData = data.error as Record<string, unknown> | undefined;
      return { ok: false, error: (errData?.message as string) || `LLM request failed` };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const { content, finishReason } = extractChoice(data);
    return {
      ok: true,
      value: {
        content,
        tokensUsed: extractUsage(data),
        model: data.model as string,
        finishReason,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown LLM error' };
  }
}

export class OpenAILLMService implements LLMService {
  readonly provider = 'openai';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    return openaiCompatibleComplete(this.config, request, 'https://api.openai.com/v1', 'gpt-4o');
  }
}

export class ClaudeLLMService implements LLMService {
  readonly provider = 'claude';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }

  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    try {
      const systemMsg = request.messages.find((m) => m.role === 'system');
      const nonSystem = request.messages.filter((m) => m.role !== 'system');

      const claudeMessages = nonSystem.map((msg) => {
        if (msg.images && msg.images.length > 0) {
          const content: Array<Record<string, unknown>> = [];
          if (msg.content) content.push({ type: 'text', text: msg.content });
          msg.images.forEach((img) => {
            const match = img.match(/^data:(image\/[^;]+);base64,(.+)$/);
            if (match) {
              content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
            }
          });
          return { role: msg.role === 'assistant' ? 'assistant' : 'user', content };
        }
        return { role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content };
      });

      const body: Record<string, unknown> = {
        model: request.model || this.config.model || 'claude-sonnet-4-20250514',
        messages: claudeMessages,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature,
        top_p: request.topP,
      };
      if (systemMsg) body.system = systemMsg.content;

      const response = await fetch(
        `${this.config.apiUrl || 'https://api.anthropic.com/v1'}/messages`,
        {
          method: 'POST',
          headers: {
            'x-api-key': this.config.apiKey,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        const errData = data.error as Record<string, unknown> | undefined;
        return { ok: false, error: (errData?.message as string) || 'Claude LLM request failed' };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const content = data.content as Record<string, unknown>[];
      const usage = data.usage as Record<string, unknown> | undefined;
      return {
        ok: true,
        value: {
          content: content[0]?.text as string,
          tokensUsed: usage ? ((usage.input_tokens as number) + (usage.output_tokens as number)) : undefined,
          model: data.model as string,
          finishReason: data.stop_reason as string | undefined,
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown LLM error' };
    }
  }
}

export class GeminiLLMService implements LLMService {
  readonly provider = 'gemini';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }

  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    try {
      const contents: Record<string, unknown>[] = [];
      for (const msg of request.messages) {
        if (msg.role === 'system') {
          contents.push({ role: 'user', parts: [{ text: msg.content }] });
          contents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
        } else {
          const parts: Record<string, unknown>[] = [];
          if (msg.content) parts.push({ text: msg.content });
          if (msg.images) {
            msg.images.forEach((img) => {
              if (img.startsWith('data:image/')) {
                const [header, b64] = img.split(',');
                const mimeType = header.split(';')[0].replace('data:', '');
                parts.push({ inlineData: { mimeType, data: b64 } });
              }
            });
          }
          contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
        }
      }

      const genConfig: Record<string, unknown> = {};
      if (request.temperature !== undefined) genConfig.temperature = request.temperature;
      if (request.maxTokens !== undefined) genConfig.maxOutputTokens = request.maxTokens;
      if (request.topP !== undefined) genConfig.topP = request.topP;

      const response = await fetch(
        `${this.config.apiUrl || 'https://generativelanguage.googleapis.com/v1beta'}/models/${request.model || this.config.model || 'gemini-2.5-flash'}:generateContent?key=${this.config.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents, generationConfig: genConfig }),
        },
      );

      if (!response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        return { ok: false, error: (data.error as Record<string, unknown>)?.message as string || 'Gemini LLM request failed' };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const candidates = data.candidates as Record<string, unknown>[];
      const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
      const parts = content?.parts as Record<string, unknown>[] | undefined;
      return {
        ok: true,
        value: {
          content: (parts?.[0]?.text as string) || '',
          model: request.model || this.config.model || 'gemini-2.5-flash',
          finishReason: candidates?.[0]?.finishReason as string | undefined,
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown LLM error' };
    }
  }
}

export class GroqLLMService implements LLMService {
  readonly provider = 'groq';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    return openaiCompatibleComplete(this.config, request, 'https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile');
  }
}

export class DeepSeekLLMService implements LLMService {
  readonly provider = 'deepseek';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    return openaiCompatibleComplete(this.config, request, 'https://api.deepseek.com', 'deepseek-chat');
  }
}

export class GrokLLMService implements LLMService {
  readonly provider = 'grok';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    return openaiCompatibleComplete(this.config, request, 'https://api.x.ai/v1', 'grok-3');
  }
}

export class OpenRouterLLMService implements LLMService {
  readonly provider = 'openrouter';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    return openaiCompatibleComplete(
      this.config,
      request,
      'https://openrouter.ai/api/v1',
      'openai/gpt-4o',
      { 'HTTP-Referer': 'https://prism.ai', 'X-Title': 'Prism' },
    );
  }
}

export class PoeLLMService implements LLMService {
  readonly provider = 'poe';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }

  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    try {
      const response = await fetch(
        `${this.config.apiUrl || 'https://api.poe.com/bot'}/${this.config.model || 'GPT-4o'}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: request.messages.map((m) => ({ role: m.role, content: m.content })),
            temperature: request.temperature,
            max_tokens: request.maxTokens,
          }),
        },
      );

      if (!response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        return { ok: false, error: (data.error as string) || 'Poe LLM request failed' };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const text = data.text as string | undefined;
      return {
        ok: true,
        value: {
          content: text || '',
          model: this.config.model || 'GPT-4o',
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown LLM error' };
    }
  }
}

export class NvidiaNimLLMService implements LLMService {
  readonly provider = 'nvidia-nim';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    return openaiCompatibleComplete(this.config, request, 'https://integrate.api.nvidia.com/v1', 'meta/llama-3.1-8b-instruct');
  }
}

export class CerebrasLLMService implements LLMService {
  readonly provider = 'cerebras';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    return openaiCompatibleComplete(this.config, request, 'https://api.cerebras.ai/v1', 'llama-3.3-70b');
  }
}

export class CloudflareWorkersLLMService implements LLMService {
  readonly provider = 'cloudflare-workers';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }

  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    try {
      const model = request.model || this.config.model || '@cf/meta/llama-3.1-8b-instruct';
      const apiUrl = this.config.apiUrl || `https://api.cloudflare.com/client/v4/accounts/${this.config.apiKey?.split(':')[0] || '{account_id}'}/ai/run/${model}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: request.temperature,
          max_tokens: request.maxTokens,
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        const errors = data.errors as Array<Record<string, unknown>> | undefined;
        return { ok: false, error: errors?.[0]?.message as string || 'Cloudflare Workers LLM request failed' };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const result = data.result as Record<string, unknown> | undefined;
      return {
        ok: true,
        value: {
          content: (result?.response as string) || '',
          model,
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown LLM error' };
    }
  }
}

export class FireworksLLMService implements LLMService {
  readonly provider = 'fireworks';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    return openaiCompatibleComplete(this.config, request, 'https://api.fireworks.ai/inference/v1', 'accounts/fireworks/models/llama-v3p1-8b-instruct');
  }
}

export class ZaiLLMService implements LLMService {
  readonly provider = 'zai';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    return openaiCompatibleComplete(this.config, request, 'https://api.z.ai/v1', 'glm-4-flash');
  }
}

export class QwenLLMService implements LLMService {
  readonly provider = 'qwen';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    return openaiCompatibleComplete(this.config, request, 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-plus');
  }
}

export class TransformersLLMService implements LLMService {
  readonly provider = 'transformers';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }

  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    try {
      const model = request.model || this.config.model || 'microsoft/DialoGPT-medium';
      const apiUrl = this.config.apiUrl || `https://api-inference.huggingface.co/models/${model}`;

      const response = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: toOpenAIMessages(request.messages),
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          top_p: request.topP,
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        return { ok: false, error: (data.error as string) || 'Transformers LLM request failed' };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const { content, finishReason } = extractChoice(data);
      return {
        ok: true,
        value: { content, tokensUsed: extractUsage(data), model: data.model as string || model, finishReason },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown LLM error' };
    }
  }
}

export class MistralLLMService implements LLMService {
  readonly provider = 'mistral';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    return openaiCompatibleComplete(this.config, request, 'https://api.mistral.ai/v1', 'mistral-large-latest');
  }
}

export class CohereLLMService implements LLMService {
  readonly provider = 'cohere';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }

  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    try {
      const chatHistory = request.messages
        .filter((m) => m.role !== 'system')
        .slice(0, -1)
        .map((m) => ({ role: m.role === 'assistant' ? 'CHATBOT' : m.role === 'user' ? 'USER' : 'SYSTEM', message: m.content }));

      const lastMsg = request.messages[request.messages.length - 1];
      const systemMsg = request.messages.find((m) => m.role === 'system');

      const body: Record<string, unknown> = {
        model: request.model || this.config.model || 'command-r-plus',
        message: lastMsg?.content || '',
        chat_history: chatHistory.length > 0 ? chatHistory : undefined,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        p: request.topP,
      };
      if (systemMsg) body.preamble = systemMsg.content;

      const response = await fetch(
        `${this.config.apiUrl || 'https://api.cohere.com/v2'}/chat`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        return { ok: false, error: (data.message as string) || 'Cohere LLM request failed' };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const content = data.text as string | undefined;
      const meta = data.meta as Record<string, unknown> | undefined;
      const billedUnits = meta?.billed_units as Record<string, number> | undefined;
      return {
        ok: true,
        value: {
          content: content || '',
          tokensUsed: billedUnits ? (billedUnits.input_tokens || 0) + (billedUnits.output_tokens || 0) : undefined,
          model: data.model as string || this.config.model || 'command-r-plus',
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown LLM error' };
    }
  }
}

export class TogetherLLMService implements LLMService {
  readonly provider = 'together';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    return openaiCompatibleComplete(this.config, request, 'https://api.together.xyz/v1', 'meta-llama/Llama-3-70b-chat-hf');
  }
}

export class PerplexityLLMService implements LLMService {
  readonly provider = 'perplexity';
  private config: ServiceConfig;
  constructor(config: ServiceConfig) { this.config = config; }
  async complete(request: LLMRequest): Promise<Result<LLMResult>> {
    return openaiCompatibleComplete(this.config, request, 'https://api.perplexity.ai', 'sonar-pro');
  }
}
