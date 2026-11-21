// GENERATED FILE - do not edit by hand.
// Run `node scripts/generate-core-providers.mjs` to regenerate.
//
// The ids come from prism-core's own provider table (crates/prism-core/
// src/providers.rs) by running its wasm export providers_json() at
// build time. A hand-maintained copy here would drift away from the
// core; this file is regenerated whenever the core changes.
//
// Order matches the core's declaration order.

/** Canonical provider ids the core knows how to build a request for. */
export const CORE_PROVIDER_IDS: readonly string[] = [
  'openai',
  'gemini',
  'qwen',
  'deepseek',
  'groq',
  'openrouter',
  'mistral',
  'grok',
  'nvidia-nim',
  'cerebras',
  'together',
  'fireworks',
  'perplexity',
  'ollama',
  'llamacpp',
  'koboldcpp',
  'sglang',
];
