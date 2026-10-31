/**
 * Env-var API-key fallback shared by TUI key resolution.
 *
 * Mirrors `providers::resolve_key` in crates/prism-core/src/providers.rs:
 * a stored key always wins; otherwise the provider's environment
 * variables are checked in preference order (empty/whitespace values are
 * skipped — some launchers export placeholders). The env name table
 * matches the core's `ProviderDef.env` fields exactly.
 */

/** Canonical env names per provider id, in preference order. Matches core. */
export const PROVIDER_ENV: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  qwen: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  groq: ['GROQ_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  grok: ['XAI_API_KEY', 'GROK_API_KEY'],
  'nvidia-nim': ['NVIDIA_API_KEY', 'NVIDIA_NIM_API_KEY'],
  cerebras: ['CEREBRAS_API_KEY'],
  together: ['TOGETHER_API_KEY'],
  fireworks: ['FIREWORKS_API_KEY'],
  perplexity: ['PERPLEXITY_API_KEY'],
};

/** First non-empty value among the provider's env vars, or undefined. */
export function providerEnvKey(provider: string): string | undefined {
  for (const name of PROVIDER_ENV[provider] ?? []) {
    const value = process.env[name];
    if (value !== undefined && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Resolve the key for a direct request: stored key wins, env fallback
 * otherwise. Empty string when neither source has a key.
 */
export function resolveProviderKey(
  stored: string | undefined,
  provider: string,
): string {
  const s = (stored ?? '').trim();
  if (s !== '') {
    return s;
  }
  return providerEnvKey(provider) ?? '';
}
