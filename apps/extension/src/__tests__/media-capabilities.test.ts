import type { AIConfig } from '@prism/shared-types';
import {
  buildInpaintRequest,
  buildModelRequest,
  buildVideoRequest,
  capabilityForProvider,
  defaultMediaSettings,
  generateModel,
  generateVideo,
  inpaint,
  mediaApiKey,
  MEDIA_CAPABILITY_PROVIDERS,
  normalizeMediaSettings,
  providersForCapability,
  type MediaCapabilityClient,
  type MediaCapabilitySettings,
} from '../chat/media-capabilities';

/**
 * The media panel must reach the provider the user picked, with that
 * provider's key — not the chat provider's.
 *
 * These tests drive the module against a recording client, so they
 * observe the provider registration and the request that is made.
 */
describe('Media capabilities', () => {
  /** A client that records what it was asked to do. */
  function recordingClient(
    response: unknown = { success: true, data: { imageUrl: 'https://img.test/a.png' } },
  ) {
    const calls = {
      setCapabilityProvider: [] as Array<{
        capability: string;
        provider: string;
        config?: { apiKey?: string; model?: string };
      }>,
      inpaint: [] as unknown[],
      modelGen: [] as unknown[],
      videoGen: [] as unknown[],
    };
    const client: MediaCapabilityClient = {
      setCapabilityProvider(capability, provider, config) {
        calls.setCapabilityProvider.push({ capability, provider, config });
      },
      async inpaint(request) {
        calls.inpaint.push(request);
        return response as never;
      },
      async modelGen(request) {
        calls.modelGen.push(request);
        return response as never;
      },
      async videoGen(request) {
        calls.videoGen.push(request);
        return response as never;
      },
    };
    return { client, calls };
  }

  const stability: MediaCapabilitySettings = {
    provider: 'stability',
    apiKey: 'sk-stability',
    model: 'sd3',
  };

  it('knows which capability a provider serves', () => {
    expect(capabilityForProvider('stability')).toBe('inpaint');
    expect(capabilityForProvider('runway')).toBe('video-gen');
    expect(capabilityForProvider('meshy')).toBe('model-gen');
    expect(capabilityForProvider('openai')).toBeUndefined();
  });

  it('offers a provider list per capability', () => {
    expect(providersForCapability('inpaint')).toContain('stability');
    expect(providersForCapability('video-gen')).toEqual(
      expect.arrayContaining(['runway', 'kling', 'luma']),
    );
    expect(providersForCapability('model-gen')).toEqual(
      expect.arrayContaining(['meshy', 'tripo']),
    );
  });

  it('every capability has at least one provider', () => {
    for (const providers of Object.values(MEDIA_CAPABILITY_PROVIDERS)) {
      expect(providers.length).toBeGreaterThan(0);
    }
  });

  it('falls back to the defaults when nothing is stored', () => {
    const settings = normalizeMediaSettings(undefined);
    expect(settings['image-gen'].provider).toBe('huggingface');
    expect(settings.inpaint.provider).toBe('stability');
  });

  it('keeps a stored provider that the capability supports', () => {
    const settings = normalizeMediaSettings({
      inpaint: { provider: 'fireworks', apiKey: 'k', model: 'm' },
    });
    expect(settings.inpaint.provider).toBe('fireworks');
    expect(settings.inpaint.apiKey).toBe('k');
  });

  it('replaces a stored provider the capability does not support', () => {
    const settings = normalizeMediaSettings({
      inpaint: { provider: 'runway', apiKey: 'k', model: 'm' },
    });
    expect(settings.inpaint.provider).toBe(defaultMediaSettings().inpaint.provider);
  });

  it('prefers a key stored for the media provider itself', () => {
    const aiConfig = {
      provider: 'openai',
      apiKey: 'chat-key',
      providerKeys: { openai: 'chat-key', stability: 'media-key' },
    } as AIConfig;
    expect(mediaApiKey(stability, aiConfig)).toBe('media-key');
  });

  it('falls back to the capability key when no provider key matches', () => {
    const aiConfig = {
      provider: 'openai',
      apiKey: 'chat-key',
      providerKeys: { openai: 'chat-key' },
    } as AIConfig;
    expect(mediaApiKey(stability, aiConfig)).toBe('sk-stability');
  });

  it('registers the chosen provider before an inpainting call', async () => {
    const { client, calls } = recordingClient({
      success: true,
      data: { imageUrl: 'https://img.test/out.png', image: new Blob() },
    });

    await inpaint(client, stability, {
      image: 'data:image/png;base64,AAA',
      mask: 'data:image/png;base64,BBB',
      prompt: '  make it blue  ',
    });

    expect(calls.setCapabilityProvider[0]).toEqual({
      capability: 'inpaint',
      provider: 'stability',
      config: { apiKey: 'sk-stability', model: 'sd3' },
    });
    expect(calls.inpaint[0]).toMatchObject({
      prompt: 'make it blue',
      image: 'data:image/png;base64,AAA',
      mask: 'data:image/png;base64,BBB',
    });
  });

  it('refuses to inpaint without a source image or mask', async () => {
    const { client, calls } = recordingClient();
    await expect(
      inpaint(client, stability, {
        image: '',
        mask: 'data:image/png;base64,BBB',
        prompt: 'x',
      }),
    ).rejects.toThrow(/source image and a mask/);
    expect(calls.inpaint).toHaveLength(0);
  });

  it('reports the provider error when an inpainting call fails', async () => {
    const { client } = recordingClient({ success: false, error: 'no credit' });
    await expect(
      inpaint(client, stability, {
        image: 'a',
        mask: 'b',
        prompt: 'x',
      }),
    ).rejects.toThrow('no credit');
  });

  it('registers the chosen provider before a video call', async () => {
    const { client, calls } = recordingClient({
      success: true,
      data: {
        videoUrl: 'https://video.test/out.mp4',
        video: new Blob(),
        duration: 5,
        format: 'mp4',
      },
    });

    await generateVideo(client, { ...stability, provider: 'runway' }, {
      prompt: 'a wave',
      duration: 5,
      aspectRatio: '16:9',
    });

    expect(calls.setCapabilityProvider[0].capability).toBe('video-gen');
    expect(calls.setCapabilityProvider[0].provider).toBe('runway');
    expect(calls.videoGen[0]).toMatchObject({
      prompt: 'a wave',
      duration: 5,
      aspectRatio: '16:9',
    });
  });

  it('registers the chosen provider before a model call', async () => {
    const { client, calls } = recordingClient({
      success: true,
      data: {
        modelUrl: 'https://model.test/out.glb',
        model: new Blob(),
        format: 'glb',
      },
    });

    await generateModel(client, { ...stability, provider: 'meshy' }, {
      prompt: 'a chair',
      format: 'glb',
    });

    expect(calls.setCapabilityProvider[0].capability).toBe('model-gen');
    expect(calls.setCapabilityProvider[0].provider).toBe('meshy');
    expect(calls.modelGen[0]).toMatchObject({ prompt: 'a chair', format: 'glb' });
  });

  it('leaves optional fields out of a video request when unset', () => {
    const request = buildVideoRequest({ prompt: 'a wave' });
    expect(request).toEqual({ prompt: 'a wave' });
    expect('duration' in request).toBe(false);
    expect('image' in request).toBe(false);
  });

  it('leaves optional fields out of a model request when unset', () => {
    const request = buildModelRequest({ prompt: 'a chair' });
    expect(request).toEqual({ prompt: 'a chair' });
    expect('format' in request).toBe(false);
  });

  it('keeps the negative prompt of an inpaint request when set', () => {
    const request = buildInpaintRequest({
      image: 'a',
      mask: 'b',
      prompt: 'x',
      negativePrompt: '  blurry  ',
    });
    expect(request.negativePrompt).toBe('blurry');
  });
});
