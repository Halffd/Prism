import type { AIConfig } from '@prism/shared-types';

/**
 * The custom model must reach the user's own endpoint.
 *
 * These tests drive the real client against a stubbed `fetch`, so they
 * observe the request that is actually made: the URL, the bearer token and
 * the model id in the body.
 */
describe('Custom model request', () => {
  const CUSTOM_BASE_URL = 'https://api.example.test/v1';

  const config: AIConfig = {
    provider: 'openai',
    apiUrl: 'http://localhost:3000/api',
    apiKey: 'hosted-key',
    model: 'gpt-4o',
    providerKeys: { openai: 'hosted-key' },
    customModels: [
      {
        id: 'custom_1',
        label: 'My Local LLM',
        baseUrl: CUSTOM_BASE_URL,
        apiKey: 'sk-custom',
        model: 'my-model:latest',
      },
    ],
    activeCustomModelId: 'custom_1',
  };

  let fetchMock: jest.Mock;

  /** A minimal OpenAI-shaped streaming response. */
  const sseResponse = (content: string) => ({
    ok: true,
    status: 200,
    // The client drains the body as an async iterable of bytes.
    body: {
      async *[Symbol.asyncIterator]() {
        yield new TextEncoder().encode(
          `data: ${JSON.stringify({
            choices: [{ delta: { content } }],
          })}\n\ndata: [DONE]\n\n`,
        );
      },
    },
    text: async () => '',
  });

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue(sseResponse('hello'));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * Builds a client for a configuration.
   *
   * The client is loaded on demand: the extension loads it lazily, and a
   * static import would break the boundary that the build enforces.
   */
  async function createClient(aiConfig: AIConfig) {
    const { UnifiedAIClient } = await import('@prism/api-client');
    return new UnifiedAIClient({
      aiConfig,
      prismApiUrl: aiConfig.apiUrl,
    });
  }

  it('sends the request to the custom endpoint', async () => {
    const client = await createClient(config);

    const response = await client.sendMessage('hi');

    expect(response.success).toBe(true);
    expect(fetchMock).toHaveBeenCalled();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CUSTOM_BASE_URL}/chat/completions`);
    expect(init.headers.Authorization).toBe('Bearer sk-custom');
  });

  it('sends the model id of the custom endpoint', async () => {
    const client = await createClient(config);

    await client.sendMessage('hi');

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.model).toBe('my-model:latest');
  });

  it('does not send the request to the Prism API', async () => {
    const client = await createClient(config);

    await client.sendMessage('hi');

    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).not.toContain(`${config.apiUrl}/chat`);
  });

  it('sends the request to the Prism API when no custom model is selected', async () => {
    const withoutCustom = { ...config, activeCustomModelId: undefined };
    const client = await createClient(withoutCustom);

    // The Prism API answers with its own envelope, not with an SSE stream.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { id: 'a', role: 'assistant', content: 'hi', timestamp: 1 },
      }),
      text: async () => '',
    });

    const response = await client.sendMessage('hi');

    expect(response.success).toBe(true);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${withoutCustom.apiUrl}/chat`);
  });
});
