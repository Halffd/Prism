import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  Message,
  ContextData,
  AIConfig,
  AudioTranscriptionResponse,
  TTSOptions,
  AudioServiceConfig,
} from '@prism/shared-types';

export interface ChatCompletionRequest {
  messages: Message[];
  context?: ContextData;
  config: AIConfig;
}

export interface ChatCompletionResponse {
  content: string;
  tokensUsed?: number;
  model?: string;
  /** Reasoning/scratchpad text when thinking mode extracted it. */
  thinking?: string;
}


/** Legacy vision-path thinking injection (last user message). */
function injectLastUserThinking(messages: Message[]): Message[] {
  const msgs = [...messages];
  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx !== -1) {
    msgs[lastUserIdx] = {
      ...msgs[lastUserIdx],
      content: `Before answering, reason through the problem step by step inside <thinking></thinking> tags, then give the final answer after the closing tag.\n\n${msgs[lastUserIdx].content}`,
    };
  }
  return msgs;
}

interface WasmSseDecoder {
  feed(chunk: Uint8Array): string;
  finish(): string;
  is_done(): boolean;
}

interface WasmNdjsonDecoder {
  feed(chunk: Uint8Array): string;
  finish(): string;
  is_done(): boolean;
}

export interface WasmCore {
  SseDecoder: new () => WasmSseDecoder;
  NdjsonDecoder: new () => WasmNdjsonDecoder;
  build_stream_body: (reqJson: string) => string;
  build_ollama_body: (reqJson: string) => string;
  build_api_chat_body: (reqJson: string) => string;
  parse_api_response: (body: string) => string;
  parse_models_response: (body: string) => string;
  strip_thinking: (content: string) => string;
  apply_thinking: (messagesJson: string) => string;
  ollama_root_url: (base: string) => string;
  providers_json: () => string;
}

let corePromise: Promise<WasmCore> | null = null;

/** Load the core once per environment (node pkg vs browser pkg). */
async function loadCore(): Promise<WasmCore> {
  if (!corePromise) {
    corePromise = (async () => {
      const isNode = typeof process !== 'undefined' && !!process.versions?.node;
      if (isNode) {
        // process.getBuiltinModule bypasses jest's module interception
        // (Node 22.3+); createRequire then loads the nodejs pkg from
        // real disk, outside jest's moduleNameMapper.
        const proc = process as unknown as {
          getBuiltinModule?: (id: string) => {
            createRequire: (filename: string) => (id: string) => unknown;
          };
        };
        const nodeModule = proc.getBuiltinModule?.('module');
        if (!nodeModule) {
          throw new Error('wasm loader: node builtin module unavailable');
        }
        // Node branch only: __filename exists under CJS (jest, tsc
        // builds). No import.meta token here — it would force @swc/jest
        // to emit ESM and break the jest require chain. Browser builds
        // take the dynamic-import branch and never need an anchor.
        const anchor =
          typeof __filename !== 'undefined'
            ? __filename
            : process.cwd() + '/index.js';
        const req = nodeModule.createRequire(anchor);
        // resolve-then-require: absolute path keeps the load outside
        // jest's relative moduleNameMapper.
        const resolved = req.resolve('./wasm-pkg-node/prism_wasm.js');
        return req(resolved) as WasmCore;
      }
      // @ts-ignore — wasm-pack bundler glue (node16 resolution limitation)
      const web = await import('./wasm-pkg-web/prism_wasm.js');
      await (web as unknown as { default: () => Promise<void> }).default();
      return web as unknown as WasmCore;
    })();
  }
  return corePromise;
}

type StreamEvent = { Chunk: string } | 'Done' | { Error: string };

interface ProviderDef {
  id: string;
  base_url: string;
}

let providerTable: ProviderDef[] | null = null;

async function providers(): Promise<ProviderDef[]> {
  const core = await loadCore();
  if (!providerTable) {
    providerTable = JSON.parse(core.providers_json()) as ProviderDef[];
  }
  return providerTable;
}

function ensureV1Suffix(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function parseBodyResult(json: string): string {
  const parsed = JSON.parse(json) as { Ok?: unknown; Err?: string };
  if (parsed.Err !== undefined || parsed.Ok === undefined) {
    throw new Error(`core rejected request: ${parsed.Err ?? 'unknown'}`);
  }
  // The builder embeds the body as a JSON value inside {"Ok": ...}.
  return JSON.stringify(parsed.Ok);
}

/** Drain decoded events; concatenate chunk text; throw on Error events. */
async function decodeStreamToText(
  body: AsyncIterable<Uint8Array>,
  decoder: WasmSseDecoder | WasmNdjsonDecoder,
): Promise<string> {
  let text = '';
  for await (const chunk of body) {
    const events = JSON.parse(decoder.feed(chunk)) as StreamEvent[];
    for (const event of events) {
      if (typeof event === 'string') {
        if (event === 'Done') return text;
      } else if ('Chunk' in event) {
        text += event.Chunk;
      } else if ('Error' in event) {
        throw new Error(event.Error);
      }
    }
  }
  JSON.parse(decoder.finish()) as StreamEvent[];
  return text;
}

/** Full assistant text for an OpenAI-compatible stream. */
async function directStream(
  base: string,
  apiKey: string,
  bodyJson: string,
): Promise<string> {
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: bodyJson,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `server returned ${response.status}: ${text.slice(0, 300)}`,
    );
  }
  return decodeStreamToText(
    response.body as unknown as AsyncIterable<Uint8Array>,
    new (await loadCore()).SseDecoder(),
  );
}

async function coreChatComplete(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  config: AIConfig,
): Promise<string> {
  const core = await loadCore();
  const provider = config.provider;

  if (provider === 'prism-api') {
    const server = config.apiUrl || 'http://localhost:3000';
    const token = config.providerKeys?.['prism-api'] || config.apiKey || '';
    const last = messages[messages.length - 1]?.content ?? '';
    const bodyJson = parseBodyResult(
      core.build_api_chat_body(
        JSON.stringify({ server_url: server, token, content: last }),
      ),
    );
    const response = await fetch(`${server.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: bodyJson,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `server returned ${response.status}: ${text.slice(0, 300)}`,
      );
    }
    const parsed = JSON.parse(
      core.parse_api_response(await response.text()),
    ) as {
      Ok?: string;
      Err?: string;
    };
    if (parsed.Err !== undefined) {
      throw new Error(parsed.Err);
    }
    return parsed.Ok ?? '';
  }

  if (provider === 'ollama') {
    // Old llm-service behavior: ollama always goes native /api/chat.
    const root = core.ollama_root_url(
      config.localApiUrl || 'http://localhost:11434',
    );
    const bodyJson = parseBodyResult(
      core.build_ollama_body(
        JSON.stringify({
          base_url: root,
          model: config.model || 'llama3',
          temperature: config.temperature ?? 0.8,
          messages,
          num_ctx: config.hardware?.contextTokens,
          num_gpu:
            config.hardware?.preferredCompute === 'cpu-only'
              ? 0
              : config.hardware?.gpuLayersOverride,
          max_tokens: config.maxTokens,
        }),
      ),
    );
    const response = await fetch(`${root}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyJson,
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `server returned ${response.status}: ${text.slice(0, 300)}`,
      );
    }
    return decodeStreamToText(
      response.body as unknown as AsyncIterable<Uint8Array>,
      new core.NdjsonDecoder(),
    );
  }

  if (
    provider === 'llamacpp' ||
    provider === 'sglang' ||
    provider === 'koboldcpp'
  ) {
    const raw =
      config.localApiUrl ||
      config.apiUrl ||
      (await providers()).find((p) => p.id === provider)?.base_url ||
      'http://localhost:8080';
    const base = ensureV1Suffix(raw);
    const bodyJson = parseBodyResult(
      core.build_stream_body(
        JSON.stringify({
          base_url: base,
          api_key: config.apiKey || '',
          model: config.model || '',
          temperature: config.temperature ?? 0.8,
          messages,
          max_tokens: config.maxTokens,
          top_p: config.topP,
        }),
      ),
    );
    return directStream(base, config.apiKey || '', bodyJson);
  }

  // Cloud OpenAI-compat set (openai, gemini, qwen, deepseek, grok,
  // openrouter, nvidia-nim, groq, cerebras, together, fireworks,
  // perplexity, mistral) + default fallback.
  const fromConfig = config.apiUrl?.trim();
  const base = (
    fromConfig ||
    (await providers()).find((p) => p.id === provider)?.base_url ||
    'https://api.openai.com/v1'
  ).replace(/\/+$/, '');
  const apiKey = config.providerKeys?.[provider] || config.apiKey || '';
  const bodyJson = parseBodyResult(
    core.build_stream_body(
      JSON.stringify({
        base_url: base,
        api_key: apiKey,
        model: config.model || 'gpt-3.5-turbo',
        temperature: config.temperature ?? 0.7,
        messages,
        max_tokens: config.maxTokens,
        top_p: config.topP,
      }),
    ),
  );
  return directStream(base, apiKey, bodyJson);
}

export class AIService {
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  async chatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const { messages } = request;
    const thinkEnabled = request.config.thinkingMode?.enabled === true;
    const hasImages = messages.some((m) => m.images && m.images.length > 0);

    // Vision stays on the legacy provider paths until the core supports
    // image content (v1 core contract is text-only). Those paths keep
    // the legacy thinking mechanics (last-user injection + regex strip).
    if (hasImages) {
      const effectiveRequest = thinkEnabled
        ? { ...request, messages: injectLastUserThinking(messages) }
        : request;
      const raw = await this.legacyImagesDispatch(effectiveRequest);
      if (thinkEnabled && raw.content.includes('<thinking>')) {
        const match = raw.content.match(/<thinking>([\s\S]*?)<\/thinking>/);
        return {
          ...raw,
          content: raw.content
            .replace(/<thinking>[\s\S]*?<\/thinking>\s*/, '')
            .trim(),
          thinking: match?.[1]?.trim(),
        };
      }
      return raw;
    }

    // Text path: core-owned end to end. The wasm core injects the
    // scratchpad instruction (FIRST user message — core semantics; the
    // legacy TS path used the last one) and strips the reasoning block.
    const core = await loadCore();
    let wire = messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));
    if (thinkEnabled) {
      wire = JSON.parse(core.apply_thinking(JSON.stringify(wire)));
    }
    // Non-compat legacy providers keep their native methods until the
    // core grows adapters for them.
    switch (request.config.provider) {
      case 'claude':
        return this.claudeChatCompletion({
          ...request,
          messages: wire as unknown as Message[],
        });
      case 'transformers':
        return this.transformersChatCompletion({
          ...request,
          messages: wire as unknown as Message[],
        });
      case 'poe':
        return this.poeChatCompletion({
          ...request,
          messages: wire as unknown as Message[],
        });
      case 'cloudflare-workers':
        return this.cloudflareWorkersChatCompletion({
          ...request,
          messages: wire as unknown as Message[],
        });
      case 'zai':
        return this.zaiChatCompletion({
          ...request,
          messages: wire as unknown as Message[],
        });
      default:
        break;
    }

    const content = await coreChatComplete(wire, request.config);
    if (thinkEnabled) {
      const [clean, reasoning] = JSON.parse(core.strip_thinking(content)) as [
        string,
        string | null,
      ];
      return { content: clean, thinking: reasoning ?? undefined };
    }
    return { content };
  }

  /** Legacy vision dispatch (openai/gemini paths support images). */
  private async legacyImagesDispatch(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    switch (request.config.provider) {
      case 'gemini':
        return this.geminiChatCompletion(request);
      default:
        return this.openAIChatCompletion(request);
    }
  }

  private async openAIChatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const { messages, config } = request;
    const openAiMessages = messages.map((msg) => {
      if (msg.images && msg.images.length > 0) {
        // Create a content array with text and image URLs
        const content: Array<{
          type: string;
          text?: string;
          image_url?: { url: string };
        }> = [];

        if (msg.content) {
          content.push({
            type: 'text',
            text: msg.content,
          });
        }

        msg.images.forEach((image) => {
          content.push({
            type: 'image_url',
            image_url: { url: image },
          });
        });

        return {
          role: msg.role,
          content: content,
        };
      } else {
        return {
          role: msg.role,
          content: msg.content,
        };
      }
    });

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: config.model || 'gpt-4-vision-preview', // Use vision model for image support
        messages: openAiMessages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        top_p: config.topP,
        frequency_penalty: config.frequencyPenalty,
        presence_penalty: config.presencePenalty,
      },
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const choice = response.data.choices[0];
    return {
      content: choice.message.content,
      tokensUsed: response.data.usage?.total_tokens,
      model: response.data.model,
    };
  }

  private async geminiChatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const { messages, config } = request;

    // Initialize the Google Generative AI client
    if (!config.apiKey) {
      throw new Error('No API key provided for Google Gemini');
    }
    const genAI = new GoogleGenerativeAI(config.apiKey);

    // Determine the model to use
    const modelId = config.model || 'gemini-2.5-flash';

    // Prepare the contents array
    let contents: Array<any> = [];

    // Process messages to create content in the format expected by the new SDK
    for (const msg of messages) {
      if (msg.role === 'system') {
        // For system messages, we'll handle them as text content when supported
        if (msg.content) {
          contents.push({
            role: 'user',
            parts: [{ text: msg.content }],
          });
          // Add a response from model to acknowledge the system instruction
          contents.push({
            role: 'model',
            parts: [{ text: 'I understand your instructions.' }],
          });
        }
      } else {
        const parts: Array<any> = [];

        if (msg.content) {
          parts.push({ text: msg.content });
        }

        if (msg.images && Array.isArray(msg.images)) {
          for (const image of msg.images) {
            if (image.startsWith('data:image/')) {
              const [header, base64Data] = image.split(',');
              const mimeType = header.split(';')[0].replace('data:', '');
              parts.push({
                inlineData: {
                  mimeType: mimeType,
                  data: base64Data,
                },
              });
            }
          }
        }

        contents.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: parts,
        });
      }
    }

    // Create the generation config
    const generationConfig: any = {};
    if (config.temperature !== undefined)
      generationConfig.temperature = config.temperature;
    if (config.maxTokens !== undefined)
      generationConfig.maxOutputTokens = config.maxTokens;
    if (config.topP !== undefined) generationConfig.topP = config.topP;

    try {
      // Generate the content using the new SDK
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent({
        contents,
        generationConfig,
      });

      const response = result.response;
      const text = response.text();

      return {
        content: text,
        tokensUsed: undefined, // The new SDK doesn't provide token usage in the same way
        model: modelId,
      };
    } catch (error) {
      console.error('Error generating content with Google Gen AI SDK:', error);
      throw error;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    // For now, return a static list of models for each provider
    // In a real implementation, you would fetch from the provider's API
    switch (this.config.provider) {
      case 'openai':
        return await this.getOpenAIModels();
      case 'gemini':
        return await this.getGeminiModels();
      case 'qwen':
        return await this.getQwenModels();
      case 'prism-api':
        return await this.getPrismModels();
      case 'koboldcpp':
        return await this.getKoboldCppModels();
      case 'llamacpp':
        return await this.getLlamaCppModels();
      case 'ollama':
        return await this.getOllamaModels();
      case 'sglang':
        return await this.getSglangModels();
      case 'transformers':
        return await this.getTransformersModels();
      case 'claude':
        return await this.getClaudeModels();
      case 'deepseek':
        return await this.getDeepseekModels();
      case 'grok':
        return await this.getGrokModels();
      case 'openrouter':
        return await this.getOpenrouterModels();
      case 'poe':
        return await this.getPoeModels();
      default:
        throw new Error(`Unsupported AI provider: ${this.config.provider}`);
    }
  }

  private async getOpenAIModels(): Promise<string[]> {
    if (!this.config.apiKey) {
      return ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o', 'gpt-4-turbo'];
    }

    try {
      const response = await axios.get('https://api.openai.com/v1/models', {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      // Filter for chat models
      const chatModels = response.data.data
        .filter((model: any) => model.id.includes('gpt'))
        .map((model: any) => model.id)
        .sort();

      return chatModels.length > 0
        ? chatModels
        : ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o', 'gpt-4-turbo'];
    } catch (error) {
      console.error('Error fetching OpenAI models:', error);
      return ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o', 'gpt-4-turbo'];
    }
  }

  private async getGeminiModels(): Promise<string[]> {
    // The new Google Gen AI SDK doesn't provide a models listing method
    // So we'll continue to use the API approach
    if (!this.config.apiKey) {
      return [
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
        'gemini-pro',
      ];
    }

    try {
      const response = await axios.get(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${this.config.apiKey}`,
      );

      // Filter for text generation models
      const textModels = response.data.models
        .filter((model: any) =>
          model.supportedGenerationMethods?.includes('generateContent'),
        )
        .map((model: any) => model.name.replace('models/', ''))
        .sort();

      return textModels.length > 0
        ? textModels
        : [
            'gemini-2.5-flash',
            'gemini-2.5-pro',
            'gemini-1.5-pro',
            'gemini-1.5-flash',
            'gemini-pro',
          ];
    } catch (error) {
      console.error('Error fetching Gemini models:', error);
      return [
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
        'gemini-pro',
      ];
    }
  }

  private async getQwenModels(): Promise<string[]> {
    // Qwen models are typically accessed through Alibaba Cloud's API
    // This is a simplified implementation - in reality you'd fetch from the actual endpoint
    return ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-7b', 'qwen-14b'];
  }

  private async getPrismModels(): Promise<string[]> {
    // For Prism API, return commonly used models as options
    return [
      'gpt-3.5-turbo',
      'gpt-4',
      'gpt-4o',
      'gemini-pro',
      'gemini-1.5-pro',
      'qwen-max',
      'qwen-plus',
    ];
  }

  private async getKoboldCppModels(): Promise<string[]> {
    // For KoboldCPP, return commonly used models or fetch from the API if available
    // Since KoboldCPP doesn't have a standard models endpoint, we'll return some common model names
    return [
      'llama-3.2-3b',
      'llama-3.2-1b',
      'llama-3.1-8b',
      'llama-3.3-70b',
      'mistral-7b',
      'mixtral-8x7b',
      'phi-3.5-mini',
      'gemma-2-9b',
      'gemma-2-27b',
    ];
  }

  private async getLlamaCppModels(): Promise<string[]> {
    // For LlamaCPP, try to fetch available models if possible
    // LlamaCPP doesn't typically have a models endpoint, but we'll try to get a list
    if (!this.config.localApiUrl && !this.config.apiUrl) {
      return [
        'llama-3.2-3b',
        'llama-3.2-1b',
        'llama-3.1-8b',
        'llama-3.3-70b',
        'mistral-7b',
        'mixtral-8x7b',
        'phi-3.5-mini',
        'gemma-2-9b',
        'gemma-2-27b',
      ];
    }

    try {
      const apiUrl =
        this.config.localApiUrl ||
        this.config.apiUrl ||
        'http://localhost:8080';
      const response = await axios.get(`${apiUrl}/v1/models`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.data && response.data.data) {
        return response.data.data.map((model: any) => model.id);
      }
    } catch (error) {
      console.error('Error fetching LlamaCPP models:', error);
    }

    // Return defaults if API call fails
    return [
      'llama-2-7b',
      'llama-2-13b',
      'llama-3-8b',
      'mistral-7b',
      'mixtral-8x7b',
      'phi-2',
      'gemma-2b',
      'gemma-7b',
    ];
  }

  private async getOllamaModels(): Promise<string[]> {
    // Fetch models from Ollama
    if (!this.config.localApiUrl && !this.config.apiUrl) {
      return [
        'llama3.2',
        'llama3.1',
        'llama3.2:3b',
        'llama3.2:1b',
        'qwen2.5',
        'qwen2.5:7b',
        'qwen2.5:3b',
        'mistral',
        'mixtral',
        'gemma2',
        'phi3.5',
        'phi3.5:mini',
      ];
    }

    try {
      const apiUrl =
        this.config.localApiUrl ||
        this.config.apiUrl ||
        'http://localhost:11434';
      const response = await axios.get(`${apiUrl}/api/tags`);

      if (response.data && response.data.models) {
        return response.data.models.map((model: any) => model.name);
      }
    } catch (error) {
      console.error('Error fetching Ollama models:', error);
    }

    // Return defaults if API call fails
    return [
      'llama3.2',
      'llama3.1',
      'llama3.2:3b',
      'llama3.2:1b',
      'qwen2.5',
      'qwen2.5:7b',
      'qwen2.5:3b',
      'mistral',
      'mixtral',
      'gemma2',
      'phi3.5',
      'phi3.5:mini',
    ];
  }

  private async getSglangModels(): Promise<string[]> {
    // For SGLang, try to fetch available models if possible
    if (!this.config.localApiUrl && !this.config.apiUrl) {
      return [
        'llama-3.2-3b',
        'llama-3.2-1b',
        'llama-3.1-8b',
        'llama-3.3-70b',
        'mistral-7b',
        'mixtral-8x7b',
        'phi-3.5-mini',
        'gemma-2-9b',
        'gemma-2-27b',
      ];
    }

    try {
      const apiUrl =
        this.config.localApiUrl ||
        this.config.apiUrl ||
        'http://localhost:30000';
      const response = await axios.get(`${apiUrl}/v1/models`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.data && response.data.data) {
        return response.data.data.map((model: any) => model.id);
      }
    } catch (error) {
      console.error('Error fetching SGLang models:', error);
    }

    // Return defaults if API call fails
    return [
      'llama-3.2-3b',
      'llama-3.2-1b',
      'llama-3.1-8b',
      'llama-3.3-70b',
      'mistral-7b',
      'mixtral-8x7b',
      'phi-3.5-mini',
      'gemma-2-9b',
      'gemma-2-27b',
    ];
  }

  private async getTransformersModels(): Promise<string[]> {
    // For Transformers, return common models available through Hugging Face
    return [
      'microsoft/Phi-3.5-mini-instruct',
      'microsoft/Phi-3-mini-4k-instruct',
      'microsoft/Phi-3-medium-4k-instruct',
      'Qwen/Qwen2.5-1.5B-Instruct',
      'Qwen/Qwen2.5-7B-Instruct',
      'Qwen/Qwen2.5-32B-Instruct',
      'google/gemma-2-2b-it',
      'google/gemma-2-9b-it',
      'microsoft/Phi-3.5-mini-instruct',
    ];
  }

  private async getClaudeModels(): Promise<string[]> {
    // Return current Claude model options (as of Oct 2026)
    return [
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-fable-5-1',
      'claude-fable-5',
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-opus-4-5',
      'claude-sonnet-5',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
    ];
  }

  private async getDeepseekModels(): Promise<string[]> {
    // Return current DeepSeek model options (V4 generation, Oct 2026)
    return ['deepseek-v3', 'deepseek-reasoner'];
  }

  private async getGrokModels(): Promise<string[]> {
    // Return current Grok model options (as of Oct 2026)
    return ['grok-3', 'grok-2'];
  }

  public async getOpenrouterModels(): Promise<string[]> {
    if (!this.config.apiKey) {
      // Return some default models when no API key is set
      return [
        'openchat/openchat-7b',
        'neversleep/noromaid-mixtral-8x7b',
        'microsoft/wizardlm-2-8x22b',
        'cognitivecomputations/dolphin-mixtral-8x7b',
      ];
    }

    try {
      const response = await axios.get('https://openrouter.ai/api/v1/models', {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      // Filter for chat models and map to their IDs
      const chatModels = response.data.data
        .filter((model: any) => model.capabilities?.chat)
        .map((model: any) => model.id)
        .sort();

      return chatModels.length > 0
        ? chatModels
        : [
            'openchat/openchat-7b',
            'neversleep/noromaid-mixtral-8x7b',
            'microsoft/wizardlm-2-8x22b',
            'cognitivecomputations/dolphin-mixtral-8x7b',
          ];
    } catch (error) {
      console.error('Error fetching OpenRouter models:', error);
      // Return some default models if API call fails
      return [
        'openchat/openchat-7b',
        'neversleep/noromaid-mixtral-8x7b',
        'microsoft/wizardlm-2-8x22b',
        'cognitivecomputations/dolphin-mixtral-8x7b',
      ];
    }
  }

  private async getPoeModels(): Promise<string[]> {
    // Return POE model options (placeholder as API is not publicly available)
    return ['poe', 'sage', 'dragonfruit', 'citrine'];
  }

  private async transformersChatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const { messages, config } = request;

    // Transformers API is typically used with Hugging Face Inference API
    const apiUrl =
      config.localApiUrl ||
      config.apiUrl ||
      'https://api-inference.huggingface.co/models';
    const model = config.model || 'microsoft/DialoGPT-medium';

    const transformersMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const response = await axios.post(
      `${apiUrl}/${model}/chat/completions`,
      {
        model: model,
        messages: transformersMessages,
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 200,
        top_p: config.topP || 0.9,
      },
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    );

    return {
      content: response.data.choices[0].message.content,
      tokensUsed: response.data.usage?.total_tokens,
      model: response.data.model,
    };
  }

  private async claudeChatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const { messages, config } = request;

    const apiUrl =
      config.localApiUrl || config.apiUrl || 'https://api.anthropic.com/v1';

    const claudeMessages = messages
      .filter((msg) => msg.role !== 'system')
      .map((msg) => {
        if (msg.images && msg.images.length > 0) {
          const content: Array<{
            type: string;
            text?: string;
            source?: { type: string; media_type: string; data: string };
          }> = [];
          if (msg.content) {
            content.push({ type: 'text', text: msg.content });
          }
          msg.images.forEach((image) => {
            const matches = image.match(/^data:(image\/[^;]+);base64,(.+)$/);
            if (matches) {
              content.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: matches[1],
                  data: matches[2],
                },
              });
            } else {
              content.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: image.replace(/^data:image\/\w+;base64,/, ''),
                },
              });
            }
          });
          return { role: msg.role === 'user' ? 'user' : 'assistant', content };
        }
        return {
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        };
      });

    const response = await axios.post(
      `${apiUrl}/messages`,
      {
        model: config.model || 'claude-3-sonnet-20240229',
        messages: claudeMessages,
        temperature: config.temperature || 0.7,
        max_tokens: config.maxTokens || 1024,
        top_p: config.topP || 0.9,
      },
      {
        headers: {
          'x-api-key': config.apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
      },
    );

    return {
      content: response.data.content[0].text,
      tokensUsed:
        response.data.usage?.input_tokens + response.data.usage?.output_tokens,
      model: response.data.model,
    };
  }

  private async poeChatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    // POE API access is typically through their web API
    // This is a placeholder implementation as POE doesn't have a public API
    // In a real implementation, this would require either POE API key or web scraping
    const { config } = request;

    // For now, we'll return a simulated response
    // In a real implementation, you would need to use POE's API or web interface
    console.warn(
      'POE API integration not fully implemented - using mock response',
    );

    // Return a simulated response
    return {
      content:
        "This is a simulated response from POE. In a real implementation, this would connect to POE's API.",
      tokensUsed: 25,
      model: config.model || 'poe',
    };
  }

  private async cloudflareWorkersChatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const { messages, config } = request;
    const response = await axios.post(
      config.apiUrl ||
        'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/meta/llama-3.1-8b-instruct',
      {
        messages: messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
      },
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    );

    return {
      content: response.data.result.response,
      tokensUsed: undefined,
      model: config.model || '@cf/meta/llama-3.1-8b-instruct',
    };
  }

  private async zaiChatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const { messages, config } = request;
    const response = await axios.post(
      'https://api.z.ai/v1/chat/completions',
      {
        model: config.model || 'glm-4-flash',
        messages: messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      },
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    );

    return {
      content: response.data.choices[0].message.content,
      tokensUsed: response.data.usage?.total_tokens,
      model: response.data.model,
    };
  }

  async transcribeAudio(
    audioBlob: Blob,
    config: AudioServiceConfig,
  ): Promise<AudioTranscriptionResponse> {
    const apiKey =
      config.apiKey ||
      this.config.apiKey ||
      this.config.providerKeys?.['openai'] ||
      '';
    const apiUrl = config.apiUrl || 'https://api.openai.com/v1';

    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');

    const response = await axios.post(
      `${apiUrl}/audio/transcriptions`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        maxContentLength: 25 * 1024 * 1024,
        maxBodyLength: 25 * 1024 * 1024,
      },
    );

    return {
      text: response.data.text,
      language: response.data.language,
      duration: response.data.duration,
    };
  }

  async textToSpeech(
    text: string,
    options: TTSOptions,
    config: AudioServiceConfig,
  ): Promise<Blob> {
    const apiKey =
      config.apiKey ||
      this.config.apiKey ||
      this.config.providerKeys?.['openai'] ||
      '';
    const apiUrl = config.apiUrl || 'https://api.openai.com/v1';

    const response = await axios.post(
      `${apiUrl}/audio/speech`,
      {
        model: options.model || 'tts-1',
        input: text,
        voice: options.voice || 'alloy',
        speed: options.speed || 1.0,
        response_format: options.responseFormat || 'mp3',
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        responseType: 'blob',
      },
    );

    return response.data;
  }
}
