import { CORE_PROVIDER_IDS } from '../generated/core-providers';
import { loadCore, providerTable, type CoreProvider } from '@prism/ai-core';

/**
 * The provider catalogue used by the extension's selectors.
 *
 * The core-table ids come from the generated snapshot
 * (`../generated/core-providers`), which `scripts/generate-core-providers.mjs`
 * produces by running prism-core's own `providers_json()` export. That
 * keeps the popup's first-paint list in sync with the core without a
 * hand-maintained copy.
 *
 * A handful of providers the extension supports but the core does not
 * compile a body for (Anthropic's native API, the hosted Prism API, Poe,
 * Cloudflare Workers, Z.AI and the in-browser transformers runtime) are
 * appended here — the list lives in one shared module, not duplicated
 * as `<option>` elements in a component.
 */

export interface ProviderOption {
  id: string;
  label: string;
  /** Model the provider uses when the user has not picked one. */
  defaultModel?: string;
  /** Base URL, when the core knows one. */
  baseUrl?: string;
  /** True when the provider needs an API key. */
  needsKey?: boolean;
}

/** Providers the extension supports that the core's direct table omits. */
export const EXTENSION_ONLY_PROVIDER_IDS: readonly string[] = [
  'prism-api',
  'claude',
  'transformers',
  'poe',
  'cloudflare-workers',
  'zai',
];

const LABEL_OVERRIDES: Record<string, string> = {
  'prism-api': 'Prism API',
  'nvidia-nim': 'NVIDIA NIM',
  openrouter: 'OpenRouter',
  llamacpp: 'llama.cpp',
  koboldcpp: 'KoboldCpp',
  sglang: 'SGLang',
  'cloudflare-workers': 'Cloudflare Workers',
  zai: 'Z.AI',
  transformers: 'Transformers',
  poe: 'Poe',
  claude: 'Claude',
};

function humanize(id: string): string {
  const override = LABEL_OVERRIDES[id];
  if (override) return override;
  return id
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * The provider list, available synchronously and without any network or
 * wasm access. This is what the selector renders on first paint.
 */
export function getProviderOptions(): ProviderOption[] {
  const ids = [
    'prism-api',
    ...CORE_PROVIDER_IDS.filter((id) => id !== 'prism-api'),
    ...EXTENSION_ONLY_PROVIDER_IDS.filter((id) => id !== 'prism-api'),
  ];
  return Array.from(new Set(ids)).map((id) => ({
    id,
    label: humanize(id),
  }));
}

/**
 * The same list, enriched with the labels, default models and base URLs
 * the core carries. The core is optional: when the wasm is unavailable
 * the synchronous list is returned unchanged, so selection keeps working
 * offline.
 */
export async function loadProviderOptions(): Promise<ProviderOption[]> {
  const fallback = getProviderOptions();
  try {
    const core = await loadCore();
    const table: CoreProvider[] = providerTable(core);
    if (!Array.isArray(table) || table.length === 0) return fallback;

    const byId = new Map(table.map((provider) => [provider.id, provider]));
    return fallback.map((option) => {
      const provider = byId.get(option.id);
      if (!provider) return option;
      return {
        ...option,
        label: provider.label || option.label,
        defaultModel: provider.default_model || option.defaultModel,
        baseUrl: provider.base_url || option.baseUrl,
        needsKey: provider.needs_key,
      };
    });
  } catch {
    return fallback;
  }
}

/** Look up one provider option. */
export function findProviderOption(
  options: ProviderOption[],
  id: string,
): ProviderOption | undefined {
  return options.find((option) => option.id === id);
}
