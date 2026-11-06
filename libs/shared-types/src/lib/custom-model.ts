import type { AIConfig, CustomModel } from './message.types';

/**
 * Resolution of a user-defined custom model onto the OpenAI-compatible
 * request path.
 *
 * Prism already speaks the OpenAI chat-completions protocol for a long list
 * of hosted providers. A custom model is any other endpoint that speaks the
 * same protocol, so a custom model is resolved into that same shape: the
 * base URL, the bearer token and the model id travel together and must not
 * be confused with the settings of the currently selected hosted provider.
 *
 * The logic lives here, and not in the extension, because both the
 * extension and the API client have to agree on it: the extension builds the
 * configuration, and the API client decides where a request is sent.
 */

/** A custom model together with the request settings it resolves to. */
export interface ResolvedCustomModel {
  /** The custom model entry itself. */
  customModel: CustomModel;
  /** Base URL of the endpoint. */
  baseUrl: string;
  /** Bearer token for the endpoint; empty when the endpoint needs none. */
  apiKey: string;
  /** Model id sent to the endpoint. */
  model: string;
}

/**
 * Finds a custom model by id.
 *
 * @param config The AI configuration holding the custom model list.
 * @param id The custom model id.
 * @returns The matching entry, or `undefined` when there is none.
 */
export function findCustomModel(
  config: AIConfig | undefined,
  id: string | undefined,
): CustomModel | undefined {
  if (!config || !id) {
    return undefined;
  }
  return config.customModels?.find((entry) => entry.id === id);
}

/**
 * Resolves the custom model a configuration has selected.
 *
 * @param config The AI configuration.
 * @returns The resolved model, or `undefined` when no custom model is
 *   selected or the selected one no longer exists.
 */
export function resolveActiveCustomModel(
  config: AIConfig | undefined,
): ResolvedCustomModel | undefined {
  const customModel = findCustomModel(config, config?.activeCustomModelId);
  if (!customModel) {
    return undefined;
  }
  return {
    customModel,
    baseUrl: customModel.baseUrl.trim(),
    apiKey: customModel.apiKey ?? '',
    model: customModel.model.trim(),
  };
}

/**
 * Builds the request configuration for a custom model.
 *
 * The result keeps every unrelated setting of the original configuration and
 * only replaces the parts that address the endpoint. The provider stays
 * `openai` because that is the protocol the custom endpoint speaks, and the
 * endpoint's own key and URL are carried in `providerKeys.openai` and
 * `apiUrl` so that the existing OpenAI-compatible path picks them up
 * without needing to know about custom models at all.
 *
 * @param config The AI configuration to derive from.
 * @param resolved The custom model to address.
 * @returns A configuration that addresses the custom endpoint.
 */
export function withCustomModel(
  config: AIConfig,
  resolved: ResolvedCustomModel,
): AIConfig {
  return {
    ...config,
    provider: 'openai',
    apiUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    model: resolved.model,
    providerKeys: {
      ...config.providerKeys,
      openai: resolved.apiKey,
    },
  };
}

/**
 * Produces the configuration a request should be sent with.
 *
 * When a custom model is selected, the request is addressed at that
 * endpoint. Otherwise the configuration is used as it stands.
 *
 * @param config The AI configuration.
 * @returns The configuration to send the request with.
 */
export function resolveRequestConfig(config: AIConfig): AIConfig {
  const resolved = resolveActiveCustomModel(config);
  return resolved ? withCustomModel(config, resolved) : config;
}

/**
 * The models offered for the current configuration.
 *
 * A selected custom model offers its own model list, so that the model
 * picker reflects what the endpoint actually serves.
 *
 * @param config The AI configuration.
 * @returns The model ids to offer, or an empty list when there is none.
 */
export function customModelOptions(config: AIConfig | undefined): string[] {
  const resolved = resolveActiveCustomModel(config);
  if (!resolved) {
    return [];
  }
  if (resolved.customModel.models && resolved.customModel.models.length > 0) {
    return resolved.customModel.models;
  }
  return resolved.model ? [resolved.model] : [];
}

/**
 * Whether a configuration addresses a user-defined endpoint.
 *
 * @param config The AI configuration.
 * @returns `true` when a custom model is selected.
 */
export function hasActiveCustomModel(config: AIConfig | undefined): boolean {
  return resolveActiveCustomModel(config) !== undefined;
}
