import * as fs from 'fs';
import * as path from 'path';
import { AIService } from './llm-service.js';
import type { ChatCompletionRequest } from './llm-service.js';
import type { AIConfig, Message } from '@prism/shared-types';

// jest's transformed __dirname is shallower than tsc's; walk up until
// the repo's contracts/fixtures dir is found.
function findFixtures(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'contracts', 'fixtures');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('contracts/fixtures not found above ' + __dirname);
}
const FIXTURES = findFixtures();

function fixtureBytes(rel: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(FIXTURES, rel)));
}

function sseBytes(events: string[]): Uint8Array {
  const body =
    events
      .map(
        (e) =>
          `data: ${JSON.stringify({ choices: [{ delta: { content: e } }] })}\n\n`,
      )
      .join('') + 'data: [DONE]\n\n';
  return new Uint8Array(Buffer.from(body));
}

function msg(content: string, images?: string[]): Message {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    role: 'user',
    content,
    timestamp: Date.now(),
    images,
  };
}

function config(overrides: Partial<AIConfig>): AIConfig {
  return {
    provider: 'openai',
    apiKey: 'sk-test',
    apiUrl: 'https://api.openai.com/v1',
    ...overrides,
  } as AIConfig;
}

function request(cfg: AIConfig, messages: Message[]): ChatCompletionRequest {
  return { messages, config: cfg };
}

describe('AIService chatCompletion (prism-core wasm path)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('decodes a real-shape OpenAI SSE stream through the core', async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(fixtureBytes('sse/openai-happy/input.txt'), {
          status: 200,
        }),
    ) as unknown as typeof fetch;
    const svc = new AIService(config({}));
    const res = await svc.chatCompletion(request(config({}), [msg('hi')]));
    expect(res.content).toBe('Hello');
    const call = (global.fetch as jest.Mock).mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(call[0]).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(call[1].body);
    expect(body.stream).toBe(true);
    expect(body.model).toBe('gpt-3.5-turbo');
  });

  it('survives chunk boundaries inside multi-byte characters', async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(fixtureBytes('sse/openai-split-utf8/input.txt'), {
          status: 200,
        }),
    ) as unknown as typeof fetch;
    const svc = new AIService(config({}));
    const res = await svc.chatCompletion(request(config({}), [msg('hi')]));
    expect(res.content).toBe('héllo');
  });

  it('routes provider base urls from the core table (cerebras)', async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(fixtureBytes('sse/openai-happy/input.txt'), {
          status: 200,
        }),
    ) as unknown as typeof fetch;
    const cfg = config({ provider: 'cerebras', apiKey: 'cs', apiUrl: undefined });
    const svc = new AIService(cfg);
    const res = await svc.chatCompletion(request(cfg, [msg('hi')]));
    expect(res.content).toBe('Hello');
    const call = (global.fetch as jest.Mock).mock.calls[0] as unknown as [
      string,
    ];
    expect(call[0]).toBe('https://api.cerebras.ai/v1/chat/completions');
  });

  it('thinking mode: core injects scratchpad and extracts reasoning', async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(
          sseBytes(['<thinking>2+2 is 4</thinking>The answer is 4']),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const cfg = config({
      thinkingMode: { enabled: true },
    } as Partial<AIConfig>);
    const svc = new AIService(cfg);
    const res = await svc.chatCompletion(request(cfg, [msg('2+2?')]));
    expect(res.content).toBe('The answer is 4');
    expect(res.thinking).toBe('2+2 is 4');
    const call = (global.fetch as jest.Mock).mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    const body = JSON.parse(call[1].body);
    // Core semantics: scratchpad injected into the FIRST user message.
    expect(body.messages[0].content).toContain(
      'Before answering, reason through the problem step by step',
    );
  });

  it('ollama provider goes native with hardware options', async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(fixtureBytes('ollama/happy/input.txt'), { status: 200 }),
    ) as unknown as typeof fetch;
    const cfg = config({
      provider: 'ollama',
      apiKey: undefined,
      apiUrl: undefined,
      localApiUrl: 'http://localhost:11434/v1',
      hardware: {
        preferredCompute: 'gpu-nvidia',
        gpuLayersOverride: 16,
        contextTokens: 8192,
      },
    } as Partial<AIConfig>);
    const svc = new AIService(cfg);
    const res = await svc.chatCompletion(request(cfg, [msg('hi')]));
    expect(res.content).toBe('Hello');
    const call = (global.fetch as jest.Mock).mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(call[0]).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(call[1].body);
    expect(body.options.num_ctx).toBe(8192);
    expect(body.options.num_gpu).toBe(16);
  });

  it('image-bearing messages stay on the legacy vision path', async () => {
    const axios = require('axios');
    const postMock = jest.fn(async () => ({
      data: { choices: [{ message: { content: 'vision reply' } }] },
    }));
    axios.post = postMock;
    global.fetch = jest.fn() as unknown as typeof fetch;
    const svc = new AIService(config({}));
    const res = await svc.chatCompletion(
      request(config({}), [
        msg('what is this?', ['data:image/png;base64,AAAA']),
      ]),
    );
    expect(res.content).toBe('vision reply');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(postMock).toHaveBeenCalled();
  });
});
