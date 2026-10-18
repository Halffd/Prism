// LLM core service: the api server's provider path, swapped onto
// prism-core via the WASM bindings (migration step 5).
//
// Division of labor per docs/plans/single-core-plan.md: this host
// drives HTTP (Node fetch) and assembles host-specific context; the
// WASM core owns request-body construction, stream decoding, and all
// parsing. Parsers/decoders are fixture-pinned in contracts/fixtures.
//
// Note: the previous hand-rolled service supported Anthropic via its
// native API; the core is OpenAI-compatible-only, so Anthropic is
// dropped here until the core gains an Anthropic adapter.

/* eslint-disable @typescript-eslint/no-var-requires */
const wasm = require('../../wasm-pkg/prism_wasm.js') as {
  SseDecoder: new () => WasmSseDecoder;
  build_stream_body: (reqJson: string) => string;
};

interface WasmSseDecoder {
  feed(chunk: Uint8Array): string;
  finish(): string;
  is_done(): boolean;
}

export interface LLMCoreConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ContextData {
  type: 'page' | 'screen' | 'selection';
  url?: string;
  title?: string;
  selectedText?: string;
  fullText?: string;
  appName?: string;
  metadata?: Record<string, unknown>;
}

interface CoreMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
  context?: ContextData;
  timestamp: number;
  tokens?: number;
}

/** Decoded StreamEvent, externally tagged like the fixture format. */
type StreamEvent = { Chunk: string } | 'Done' | { Error: string };

const DEFAULT_BASE = 'https://api.openai.com/v1';

export class LLMCoreService {
  private config: LLMCoreConfig;

  constructor(config: LLMCoreConfig) {
    this.config = config;
  }

  /**
   * Stream the assistant response as plain text deltas. The provider
   * request body is built by the core; response bytes are decoded by
   * the core's SSE decoder.
   */
  async *streamResponse(
    messages: CoreMessage[],
    context?: ContextData,
  ): AsyncGenerator<string, void, unknown> {
    const formatted = this.formatMessagesForLLM(messages, context);

    // Development mode (no real key): keep the historical simulated reply.
    if (!this.config.apiKey || this.config.apiKey === 'fake-api-key') {
      yield this.simulateResponse(formatted);
      return;
    }

    const base = this.resolveBaseUrl();
    const bodyJson = wasm.build_stream_body(
      JSON.stringify({
        base_url: base,
        api_key: this.config.apiKey,
        model: this.config.model || 'gpt-3.5-turbo',
        temperature: this.config.temperature ?? 0.7,
        messages: formatted,
        max_tokens: this.config.maxTokens ?? 1000,
      }),
    );
    const bodyResult = JSON.parse(bodyJson) as { Ok?: string; Err?: string };
    if (bodyResult.Err || !bodyResult.Ok) {
      throw new Error(`core rejected request: ${bodyResult.Err ?? 'unknown'}`);
    }

    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(bodyResult.Ok),
    });

    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `OpenAI API error: ${response.status}: ${text.slice(0, 300)}`,
      );
    }

    const decoder = new wasm.SseDecoder();
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      for (const event of JSON.parse(decoder.feed(chunk)) as StreamEvent[]) {
        if (typeof event === 'string') {
          if (event === 'Done') return;
        } else if ('Chunk' in event) {
          yield event.Chunk;
        } else if ('Error' in event) {
          throw new Error(event.Error);
        }
      }
    }
    JSON.parse(decoder.finish()) as StreamEvent[];
  }

  /** Non-streaming convenience: full assistant text. */
  async generateResponse(
    messages: CoreMessage[],
    context?: ContextData,
  ): Promise<string> {
    let full = '';
    for await (const delta of this.streamResponse(messages, context)) {
      full += delta;
    }
    return full;
  }

  /** Base URL without the /chat/completions suffix, for core URL building. */
  private resolveBaseUrl(): string {
    const raw = (this.config.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
    return raw.endsWith('/chat/completions')
      ? raw.slice(0, -'/chat/completions'.length)
      : raw;
  }

  private formatMessagesForLLM(
    messages: CoreMessage[],
    context?: ContextData,
  ): LLMMessage[] {
    let systemMessageContent =
      'You are Prism, a helpful AI assistant that can answer questions based on provided context. Be concise and helpful.';

    if (context) {
      const contextText = [];
      if (context.title) contextText.push(`Page title: ${context.title}`);
      if (context.url) contextText.push(`Page URL: ${context.url}`);
      if (context.selectedText)
        contextText.push(`Selected text: "${context.selectedText}"`);
      if (context.fullText) {
        const truncatedText =
          context.fullText.length > 2000
            ? context.fullText.substring(0, 2000) + '...'
            : context.fullText;
        contextText.push(`Page content: ${truncatedText}`);
      }

      if (contextText.length > 0) {
        systemMessageContent += `\n\nRelevant context:\n${contextText.join('\n')}`;
      }
    }

    const formattedMessages: LLMMessage[] = [
      { role: 'system', content: systemMessageContent },
    ];

    for (const msg of messages) {
      formattedMessages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }

    return formattedMessages;
  }

  private simulateResponse(messages: LLMMessage[]): string {
    const lastUserMessage =
      messages.filter((m) => m.role === 'user').pop()?.content || 'the topic';

    const responses = [
      `I understand your question about "${lastUserMessage}". Based on the provided context, I can tell you...`,
      `Thanks for asking about "${lastUserMessage}". From what I can see in the provided content...`,
      `Looking at your query "${lastUserMessage}", I can provide the following insights...`,
      `Regarding "${lastUserMessage}", the context suggests that...`,
      `Based on the information available, "${lastUserMessage}" relates to...`,
    ];

    return responses[Math.floor(Math.random() * responses.length)];
  }
}
