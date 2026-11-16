import type { AIConfig } from '@prism/shared-types';
import { getProviderOptions, loadProviderOptions } from './provider-catalog';

/**
 * A per-provider cache of the model list.
 *
 * The extension must work with no network, no signed-in user and no
 * Prism API reachable. A provider's model list is therefore cached the
 * first time it is fetched successfully, and the cached copy is used
 * whenever a later fetch fails — which is what keeps the model
 * selector populated on a cold start with no connectivity.
 *
 * The cache lives in `chrome.storage.local`, so it survives a browser
 * restart.
 */

const STORAGE_KEY = 'prismModelCache';

/** Cached model lists, keyed by provider id. */
export type ModelCache = Record<string, string[]>;

/**
 * Models known to work per provider without asking the network.
 *
 * These are the provider defaults the core carries. They are the last
 * resort: a cached live list is always preferred, because a server can
 * add or retire a model at any time.
 */
const FALLBACK_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
  gemini: [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ],
  claude: [
    'claude-sonnet-5',
    'claude-opus-5',
    'claude-haiku-4-5',
    'claude-opus-4-8',
  ],
  qwen: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
  deepseek: ['deepseek-v3', 'deepseek-reasoner'],
  grok: ['grok-3', 'grok-2'],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  cerebras: ['llama-3.3-70b', 'llama-3.1-8b'],
  together: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
  fireworks: ['accounts/fireworks/models/llama-v3p3-70b-instruct'],
  perplexity: ['sonar', 'sonar-pro'],
  mistral: ['mistral-large-latest', 'mistral-small-latest'],
  nvidia: ['meta/llama3-70b-instruct'],
  'nvidia-nim': ['meta/llama3-70b-instruct'],
  openrouter: ['openai/gpt-4o', 'anthropic/claude-sonnet-5'],
  ollama: ['llama3.2', 'llama3.1', 'qwen2.5', 'mistral', 'gemma2'],
  llamacpp: ['local-model'],
  koboldcpp: ['local-model'],
  sglang: ['local-model'],
  poe: ['poe', 'sage', 'dragonfruit', 'citrine'],
  'prism-api': ['gpt-4o', 'gemini-2.5-pro', 'qwen-max'],
  transformers: [
    'microsoft/Phi-3.5-mini-instruct',
    'Qwen/Qwen2.5-1.5B-Instruct',
  ],
  'cloudflare-workers': ['@cf/meta/llama-3-8b-instruct'],
  zai: ['glm-4-plus'],
};

/**
 * The models to offer when nothing else is known.
 *
 * The provider catalogue is consulted first so the defaults follow the
 * core's provider table rather than a list kept here.
 */
export function getFallbackModels(provider: string): string[] {
  const fromTable = FALLBACK_MODELS[provider];
  if (fromTable && fromTable.length > 0) {
    return [...fromTable];
  }
  return [];
}

/** Read the whole cache. Returns an empty cache when storage fails. */
export async function readModelCache(): Promise<ModelCache> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const raw = stored?.[STORAGE_KEY] as ModelCache | undefined;
    if (!raw || typeof raw !== 'object') {
      return {};
    }
    return raw;
  } catch {
    return {};
  }
}

/**
 * The cached models for one provider.
 *
 * Returns an empty array when nothing is cached — the caller then uses
 * the provider defaults.
 */
export async function getCachedModels(provider: string): Promise<string[]> {
  const cache = await readModelCache();
  const models = cache[provider];
  return Array.isArray(models) ? [...models] : [];
}

/**
 * Store the models for one provider.
 *
 * The list is merged with what is already cached: a provider that
 * answers with two models does not erase the other ten the user saw
 * yesterday. An empty list is not stored — a provider that answered
 * with no models is treated as "unknown", not as "has no models", so
 * the fallback still applies.
 */
export async function cacheModels(provider: string, models: string[]): Promise<void> {
  if (!provider || !Array.isArray(models) || models.length === 0) {
    return;
  }
  try {
    const cache = await readModelCache();
    const merged = [...(cache[provider] ?? []), ...models];
    cache[provider] = [...new Set(merged)];
    await chrome.storage.local.set({ [STORAGE_KEY]: cache });
  } catch {
    // A cache write failure must never break model selection.
  }
}

/** Forget one provider's cached models (or all of them). */
export async function clearModelCache(provider?: string): Promise<void> {
  try {
    if (!provider) {
      await chrome.storage.local.remove(STORAGE_KEY);
      return;
    }
    const cache = await readModelCache();
    delete cache[provider];
    await chrome.storage.local.set({ [STORAGE_KEY]: cache });
  } catch {
    // Nothing to do — the cache is an optimisation.
  }
}

/** Forget one provider's cached models. */
export async function clearCachedModels(provider: string): Promise<void> {
  return clearModelCache(provider);
}

/** Read the whole cache. */
export async function loadModelCache(): Promise<ModelCache> {
  return readModelCache();
}

/**
 * The model list to show for a provider, without touching the network.
 *
 * Order of preference: the cached live list, then the provider's
 * default models. This is what the selector renders before (or instead
 * of) a successful fetch.
 */
export async function getOfflineModels(provider: string): Promise<string[]> {
  const cached = await getCachedModels(provider);
  if (cached.length > 0) {
    return cached;
  }
  return getFallbackModels(provider);
}

/**
 * The model list for the provider a config points at.
 *
 * Same as `getOfflineModels`, but takes the whole config so callers do
 * not have to reach into it for the provider id.
 */
export async function modelsForProvider(config: AIConfig): Promise<string[]> {
  return getOfflineModels(config.provider);
}

/**
 * Resolve a provider's models with a network fetch and a cache.
 *
 * `fetchModels` returns the live list or throws. On success the result
 * is cached. On failure the cached list is returned; when there is no
 * cached list either, the provider defaults are returned. The function
 * never throws: model selection must keep working offline.
 */
export async function resolveModels(
  config: AIConfig,
  fetchModels: (config: AIConfig) => Promise<string[]>,
): Promise<{ models: string[]; source: 'network' | 'cache' | 'default' }> {
  const provider = config.provider;
  try {
    const models = await fetchModels(config);
    if (Array.isArray(models) && models.length > 0) {
      await cacheModels(provider, models);
      return { models: [...models], source: 'network' };
    }
  } catch {
    // Fall through to the cache.
  }

  const cached = await getCachedModels(provider);
  if (cached.length > 0) {
    return { models: cached, source: 'cache' };
  }

  return { models: getFallbackModels(provider), source: 'default' };
}

/**
 * The default model for a provider, taken from the core's provider
 * table. Used when the user has not picked a model yet.
 */
export async function getProviderDefaultModel(
  provider: string,
): Promise<string | undefined> {
  try {
    const options = await loadProviderOptions();
    return options.find((option) => option.id === provider)?.defaultModel;
  } catch {
    const options = getProviderOptions();
    return options.find((option) => option.id === provider)?.defaultModel;
  }
}
