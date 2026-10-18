import * as fs from 'fs';
import * as path from 'path';
import { LLMCoreService } from './llm-core.service';

const FIXTURES = path.resolve(
  __dirname,
  '../../../../..',
  'contracts',
  'fixtures',
);

function fixtureBytes(rel: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(FIXTURES, rel)));
}

function mockedResponse(bytes: Uint8Array): Response {
  return new Response(bytes, { status: 200 });
}

function userMessage() {
  return { id: 'm1', role: 'user' as const, content: 'hi', timestamp: 0 };
}

describe('LLMCoreService (prism-core wasm path)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('decodes a real-shape OpenAI SSE stream into deltas', async () => {
    global.fetch = jest.fn(async () =>
      mockedResponse(fixtureBytes('sse/openai-happy/input.txt')),
    ) as unknown as typeof fetch;
    const svc = new LLMCoreService({ apiKey: 'sk-test', model: 'gpt-4o' });
    const out: string[] = [];
    for await (const delta of svc.streamResponse([userMessage()])) {
      out.push(delta);
    }
    expect(out).toEqual(['Hel', 'lo']);
  });

  it('survives chunk boundaries inside multi-byte characters', async () => {
    global.fetch = jest.fn(async () =>
      mockedResponse(fixtureBytes('sse/openai-split-utf8/input.txt')),
    ) as unknown as typeof fetch;
    const svc = new LLMCoreService({ apiKey: 'sk-test' });
    const out: string[] = [];
    for await (const delta of svc.streamResponse([userMessage()])) {
      out.push(delta);
    }
    expect(out).toEqual(['héllo']);
  });

  it('builds the provider request body through the core', async () => {
    global.fetch = jest.fn(async () =>
      mockedResponse(fixtureBytes('sse/openai-happy/input.txt')),
    ) as unknown as typeof fetch;
    const svc = new LLMCoreService({
      apiKey: 'sk-test',
      model: 'gpt-4o',
      temperature: 0.5,
    });
    for await (const _ of svc.streamResponse([userMessage()])) {
      void _;
    }
    const call = (global.fetch as jest.Mock).mock.calls[0] as unknown as [
      string,
      { body: string; headers: Record<string, string> },
    ];
    expect(call[0]).toBe('https://api.openai.com/v1/chat/completions');
    expect(call[1].headers['Accept']).toBe('text/event-stream');
    const body = JSON.parse(call[1].body);
    expect(body.model).toBe('gpt-4o');
    expect(body.stream).toBe(true);
    expect(body.messages[0].role).toBe('system');
    expect(body.temperature).toBeCloseTo(0.5, 5);
  });

  it('throws on provider error status', async () => {
    global.fetch = jest.fn(
      async () =>
        new Response('{"error":{"message":"bad key"}}', { status: 401 }),
    ) as unknown as typeof fetch;
    const svc = new LLMCoreService({ apiKey: 'sk-bad' });
    await expect(async () => {
      for await (const _ of svc.streamResponse([userMessage()])) {
        void _;
      }
    }).rejects.toThrow('OpenAI API error');
  });

  it('resolves a baseUrl that already ends in /chat/completions', async () => {
    global.fetch = jest.fn(async () =>
      mockedResponse(fixtureBytes('sse/openai-happy/input.txt')),
    ) as unknown as typeof fetch;
    const svc = new LLMCoreService({
      apiKey: 'sk-test',
      baseUrl: 'http://localhost:1234/v1/chat/completions',
    });
    for await (const _ of svc.streamResponse([userMessage()])) {
      void _;
    }
    const call = (global.fetch as jest.Mock).mock.calls[0] as unknown as [
      string,
    ];
    expect(call[0]).toBe('http://localhost:1234/v1/chat/completions');
  });

  it('generateResponse concatenates the stream into full text', async () => {
    global.fetch = jest.fn(async () =>
      mockedResponse(fixtureBytes('sse/openai-happy/input.txt')),
    ) as unknown as typeof fetch;
    const svc = new LLMCoreService({ apiKey: 'sk-test' });
    const full = await svc.generateResponse([userMessage()]);
    expect(full).toBe('Hello');
  });
});
