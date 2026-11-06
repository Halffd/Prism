/**
 * Resolution of a user-defined custom model onto the OpenAI-compatible
 * request path.
 *
 * The logic lives in `@prism/shared-types` because the extension and the
 * API client have to agree on it: the extension builds the configuration,
 * and the API client decides where a request is sent. This module is the
 * extension's view of that shared logic.
 */
export {
  customModelOptions,
  findCustomModel,
  hasActiveCustomModel,
  resolveActiveCustomModel,
  resolveRequestConfig,
  withCustomModel,
  type ResolvedCustomModel,
} from '@prism/shared-types';
