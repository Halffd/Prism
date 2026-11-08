import type {
  AIConfig,
  InpaintRequest,
  InpaintResult,
  ModelGenRequest,
  ModelGenResult,
  VideoGenRequest,
  VideoGenResult,
} from '@prism/shared-types';
import { ImageGenerationService } from '@prism/image-gen';

/**
 * Media capabilities in the extension.
 *
 * The extension talks to four different media backends:
 *
 * - image generation goes through `ImageGenerationService` (Hugging Face),
 *   which predates the capability factory and has no `UnifiedAIClient`
 *   method of its own;
 * - inpainting, video generation and 3D model generation go through
 *   `UnifiedAIClient`, which routes them to the capability service
 *   registered for the chosen provider.
 *
 * This module owns the provider lists, the persisted per-capability
 * settings, and the request shapes. It has no UI.
 */

/** A capability the user can pick in the media panel. */
export type MediaCapability = 'image-gen' | 'inpaint' | 'video-gen' | 'model-gen';

/** The label shown for each capability. */
export const MEDIA_CAPABILITY_LABELS: Record<MediaCapability, string> = {
  'image-gen': 'Image',
  inpaint: 'Inpaint',
  'video-gen': 'Video',
  'model-gen': '3D model',
};

/**
 * The providers each capability supports.
 *
 * Image generation is Hugging Face only, so it is listed here rather than
 * read from the factory (which has no image-gen providers registered).
 */
export const MEDIA_CAPABILITY_PROVIDERS: Record<MediaCapability, string[]> = {
  'image-gen': ['huggingface'],
  inpaint: ['stability', 'huggingface', 'fireworks'],
  'video-gen': ['runway', 'kling', 'luma'],
  'model-gen': ['meshy', 'tripo'],
};

/** The capability that owns a provider, or undefined when unknown. */
export function capabilityForProvider(provider: string): MediaCapability | undefined {
  return (Object.keys(MEDIA_CAPABILITY_PROVIDERS) as MediaCapability[]).find(
    (capability) =>
      MEDIA_CAPABILITY_PROVIDERS[capability].includes(provider),
  );
}

/** The providers of a capability. */
export function providersForCapability(
  capability: MediaCapability,
): string[] {
  return MEDIA_CAPABILITY_PROVIDERS[capability] ?? [];
}

/** The persisted settings of one capability. */
export interface MediaCapabilitySettings {
  /** Which provider serves this capability. */
  provider: string;
  /** The provider's API key. */
  apiKey: string;
  /** The model id, when the provider selects one by name. */
  model: string;
}

/** The persisted settings of every capability. */
export type MediaSettings = Record<MediaCapability, MediaCapabilitySettings>;

/** The storage key holding the media settings. */
export const MEDIA_SETTINGS_STORAGE_KEY = 'mediaCapabilities';

/** The settings a fresh install starts from. */
export function defaultMediaSettings(): MediaSettings {
  return {
    'image-gen': {
      provider: 'huggingface',
      apiKey: '',
      model: 'stabilityai/stable-diffusion-2-1',
    },
    inpaint: { provider: 'stability', apiKey: '', model: '' },
    'video-gen': { provider: 'runway', apiKey: '', model: '' },
    'model-gen': { provider: 'meshy', apiKey: '', model: '' },
  };
}

/**
 * Merge stored settings over the defaults.
 *
 * Unknown capabilities and providers fall back to the default, so a
 * stale or hand-edited storage entry cannot leave the panel pointing at
 * a provider that does not exist.
 */
export function normalizeMediaSettings(
  stored: unknown,
): MediaSettings {
  const defaults = defaultMediaSettings();
  if (!stored || typeof stored !== 'object') {
    return defaults;
  }
  const raw = stored as Partial<Record<MediaCapability, unknown>>;
  const result = { ...defaults };
  for (const capability of Object.keys(defaults) as MediaCapability[]) {
    const value = raw[capability];
    if (!value || typeof value !== 'object') {
      continue;
    }
    const entry = value as Partial<MediaCapabilitySettings>;
    const providers = providersForCapability(capability);
    const provider =
      typeof entry.provider === 'string' && providers.includes(entry.provider)
        ? entry.provider
        : defaults[capability].provider;
    result[capability] = {
      provider,
      apiKey:
        typeof entry.apiKey === 'string' ? entry.apiKey : defaults[capability].apiKey,
      model:
        typeof entry.model === 'string' ? entry.model : defaults[capability].model,
    };
  }
  return result;
}

/**
 * The API key for a media provider.
 *
 * A key stored for the media provider itself wins. Otherwise the
 * capability's own key is used, so one key in the settings screen works
 * for chat and media alike.
 */
export function mediaApiKey(
  settings: MediaCapabilitySettings,
  aiConfig?: AIConfig,
): string {
  const providerKeys = aiConfig?.providerKeys as
    | Record<string, string | undefined>
    | undefined;
  const providerKey = providerKeys?.[settings.provider];
  if (providerKey?.trim()) {
    return providerKey.trim();
  }
  if (aiConfig?.provider === settings.provider && aiConfig.apiKey?.trim()) {
    return aiConfig.apiKey.trim();
  }
  return settings.apiKey.trim();
}

/** What a media request produced. */
export type MediaResult =
  | { kind: 'image'; url: string; blob?: Blob }
  | { kind: 'video'; url: string; blob?: Blob }
  | { kind: 'model'; url: string; blob?: Blob };

/** The error thrown when a media request fails. */
export class MediaCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaCapabilityError';
  }
}

/** Generate an image from a prompt. */
export async function generateImage(
  prompt: string,
  settings: MediaCapabilitySettings,
  aiConfig?: AIConfig,
): Promise<MediaResult> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new MediaCapabilityError('Enter a prompt first.');
  }
  const apiKey = mediaApiKey(settings, aiConfig);
  if (!apiKey) {
    throw new MediaCapabilityError('An API key is required for image generation.');
  }
  const service = new ImageGenerationService({
    model: settings.model || 'stabilityai/stable-diffusion-2-1',
    apiKey,
  });
  const result = await service.generateImage(trimmed);
  return { kind: 'image', url: result.imageUrl, blob: result.imageBlob };
}

/** The request for an inpainting call. */
export function buildInpaintRequest(params: {
  image: string;
  mask: string;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
}): InpaintRequest {
  const request: InpaintRequest = {
    image: params.image,
    mask: params.mask,
    prompt: params.prompt.trim(),
  };
  if (params.negativePrompt?.trim()) {
    request.negativePrompt = params.negativePrompt.trim();
  }
  if (params.seed !== undefined && Number.isFinite(params.seed)) {
    request.seed = params.seed;
  }
  return request;
}

/** The request for a video generation call. */
export function buildVideoRequest(params: {
  prompt: string;
  image?: string;
  duration?: number;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  model?: string;
  seed?: number;
}): VideoGenRequest {
  const request: VideoGenRequest = { prompt: params.prompt.trim() };
  if (params.image?.trim()) {
    request.image = params.image.trim();
  }
  if (params.duration !== undefined && params.duration > 0) {
    request.duration = params.duration;
  }
  if (params.aspectRatio) {
    request.aspectRatio = params.aspectRatio;
  }
  if (params.model?.trim()) {
    request.model = params.model.trim();
  }
  if (params.seed !== undefined && Number.isFinite(params.seed)) {
    request.seed = params.seed;
  }
  return request;
}

/** The request for a 3D model generation call. */
export function buildModelRequest(params: {
  prompt: string;
  image?: string;
  format?: 'glb' | 'obj' | 'stl' | 'usdz' | 'gltf';
  seed?: number;
}): ModelGenRequest {
  const request: ModelGenRequest = { prompt: params.prompt.trim() };
  if (params.image?.trim()) {
    request.image = params.image.trim();
  }
  if (params.format) {
    request.format = params.format;
  }
  if (params.seed !== undefined && Number.isFinite(params.seed)) {
    request.seed = params.seed;
  }
  return request;
}

/** The client surface the capability calls need. */
export interface MediaCapabilityClient {
  setCapabilityProvider(
    capability: string,
    provider: string,
    config?: { apiKey?: string; model?: string },
  ): void;
  inpaint(request: InpaintRequest): Promise<MediaApiResponse<InpaintResult>>;
  modelGen(request: ModelGenRequest): Promise<MediaApiResponse<ModelGenResult>>;
  videoGen(request: VideoGenRequest): Promise<MediaApiResponse<VideoGenResult>>;
}

/** The response shape the capability calls return. */
export interface MediaApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Run an inpainting request against the client.
 *
 * The provider is registered on the client first, so the call reaches
 * the service the user picked rather than the chat provider.
 */
export async function inpaint(
  client: MediaCapabilityClient,
  settings: MediaCapabilitySettings,
  params: {
    image: string;
    mask: string;
    prompt: string;
    negativePrompt?: string;
    seed?: number;
  },
  aiConfig?: AIConfig,
): Promise<MediaResult> {
  if (!params.image.trim() || !params.mask.trim()) {
    throw new MediaCapabilityError('Inpainting needs a source image and a mask.');
  }
  client.setCapabilityProvider('inpaint', settings.provider, {
    apiKey: mediaApiKey(settings, aiConfig),
    model: settings.model || undefined,
  });
  const response = await client.inpaint(buildInpaintRequest(params));
  if (!response.success || !response.data) {
    throw new MediaCapabilityError(
      response.error || 'Inpainting failed.',
    );
  }
  const url = response.data.imageUrl;
  if (!url) {
    throw new MediaCapabilityError('provider returned no media URL');
  }
  return { kind: 'image', url, blob: response.data.image };
}

/**
 * Run a video generation request against the client.
 */
export async function generateVideo(
  client: MediaCapabilityClient,
  settings: MediaCapabilitySettings,
  params: {
    prompt: string;
    image?: string;
    duration?: number;
    aspectRatio?: '16:9' | '9:16' | '1:1';
    seed?: number;
  },
  aiConfig?: AIConfig,
): Promise<MediaResult> {
  if (!params.prompt.trim() && !params.image?.trim()) {
    throw new MediaCapabilityError('Enter a prompt first.');
  }
  client.setCapabilityProvider('video-gen', settings.provider, {
    apiKey: mediaApiKey(settings, aiConfig),
    model: settings.model || undefined,
  });
  const response = await client.videoGen(buildVideoRequest(params));
  if (!response.success || !response.data) {
    throw new MediaCapabilityError(
      response.error || 'Video generation failed.',
    );
  }
  const url = response.data.videoUrl;
  if (!url) {
    throw new MediaCapabilityError('provider returned no media URL');
  }
  return { kind: 'video', url, blob: response.data.video };
}

/**
 * Run a 3D model generation request against the client.
 */
export async function generateModel(
  client: MediaCapabilityClient,
  settings: MediaCapabilitySettings,
  params: {
    prompt: string;
    image?: string;
    format?: 'glb' | 'obj' | 'stl' | 'usdz' | 'gltf';
    seed?: number;
  },
  aiConfig?: AIConfig,
): Promise<MediaResult> {
  if (!params.prompt.trim() && !params.image?.trim()) {
    throw new MediaCapabilityError('Enter a prompt first.');
  }
  client.setCapabilityProvider('model-gen', settings.provider, {
    apiKey: mediaApiKey(settings, aiConfig),
    model: settings.model || undefined,
  });
  const response = await client.modelGen(buildModelRequest(params));
  if (!response.success || !response.data) {
    throw new MediaCapabilityError(
      response.error || 'Model generation failed.',
    );
  }
  const url = response.data.modelUrl;
  if (!url) {
    throw new MediaCapabilityError('provider returned no media URL');
  }
  return { kind: 'model', url, blob: response.data.model };
}

/** Load the media settings from extension storage. */
export async function loadMediaSettings(): Promise<MediaSettings> {
  const stored = await chrome.storage.local.get(MEDIA_SETTINGS_STORAGE_KEY);
  return normalizeMediaSettings(stored[MEDIA_SETTINGS_STORAGE_KEY]);
}

/** Save the media settings to extension storage. */
export async function saveMediaSettings(settings: MediaSettings): Promise<void> {
  await chrome.storage.local.set({
    [MEDIA_SETTINGS_STORAGE_KEY]: settings,
  });
}
