/**
 * Automatic model selection — a static heuristic router.
 *
 * Picks a model from the configured provider's known list based on task
 * characteristics. No network calls: uses the provider's modelCache when
 * populated (fetched via "Fetch Available Models"), falling back to a small
 * built-in list of well-known models per provider.
 */

export interface AutoModelCriteria {
  provider: string;
  /** Rough token count of the request (input + context). */
  inputTokens?: number;
  /** Whether the request includes images (vision-capable model required). */
  hasImages?: boolean;
  /** Which capability the model is selected for. */
  capability?: string;
  /** Speed/quality preference. */
  preferredSpeed?: 'fast' | 'balanced' | 'quality';
}

/** Well-known fallback models per provider (fast → quality). */
const KNOWN: Record<
  string,
  { fast: string[]; balanced: string[]; quality: string[] }
> = {
  openai: {
    fast: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-3.5-turbo'],
    balanced: ['gpt-4o', 'gpt-4.1'],
    quality: ['o3', 'gpt-4.5-preview', 'gpt-4-turbo'],
  },
  claude: {
    fast: ['claude-3-5-haiku-20241022', 'claude-3-haiku-20240307'],
    balanced: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022'],
    quality: ['claude-opus-4-20250514', 'claude-3-opus-20240229'],
  },
  gemini: {
    fast: ['gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash'],
    balanced: ['gemini-2.5-flash', 'gemini-2.0-flash'],
    quality: ['gemini-2.5-pro', 'gemini-1.5-pro'],
  },
  deepseek: {
    fast: ['deepseek-chat'],
    balanced: ['deepseek-chat'],
    quality: ['deepseek-reasoner'],
  },
  groq: {
    fast: ['llama-3.1-8b-instant'],
    balanced: ['llama-3.3-70b-versatile'],
    quality: ['llama-3.3-70b-versatile'],
  },
  ollama: {
    fast: ['llama3.2', 'qwen2.5:3b'],
    balanced: ['llama3.1', 'qwen2.5:7b'],
    quality: ['qwen2.5:32b', 'llama3.3'],
  },
  llamacpp: {
    fast: ['local'],
    balanced: ['local'],
    quality: ['local'],
  },
  koboldcpp: {
    fast: ['local'],
    balanced: ['local'],
    quality: ['local'],
  },
  sglang: {
    fast: ['local'],
    balanced: ['local'],
    quality: ['local'],
  },
  zai: {
    fast: ['glm-4-flash'],
    balanced: ['glm-4-plus'],
    quality: ['glm-4-plus'],
  },
  mistral: {
    fast: ['mistral-small-latest'],
    balanced: ['mistral-medium-latest'],
    quality: ['mistral-large-latest'],
  },
  cohere: {
    fast: ['command-r7b-12-2024'],
    balanced: ['command-r-plus-08-2024'],
    quality: ['command-r-plus-08-2024'],
  },
  together: {
    fast: ['meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo'],
    balanced: ['meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo'],
    quality: ['meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo'],
  },
};

/** Models known to accept image inputs, used when hasImages is set. */
const VISION_CAPABLE: Record<string, RegExp[]> = {
  openai: [/^gpt-4o/, /^gpt-4\.1/, /^o3/, /^o4/],
  claude: [/claude-3(-5)?-(sonnet|opus|haiku)/, /claude-(sonnet|opus|haiku)-4/],
  gemini: [/gemini/],
  groq: [/llama-3\.2-(11|90)b-vision/],
  deepseek: [],
};

/**
 * Pick the best model for a request.
 *
 * Order: the user's modelCache (provider-scoped, user-curated) filtered by the
 * speed tier, then the built-in KNOWN list, then undefined (caller keeps its
 * current model).
 */
export function selectAutoModel(
  criteria: AutoModelCriteria,
  modelCache?: Record<string, string[]>,
): string | undefined {
  const {
    provider,
    inputTokens = 0,
    hasImages = false,
    preferredSpeed = 'balanced',
  } = criteria;

  const tier: 'fast' | 'balanced' | 'quality' =
    preferredSpeed !== 'balanced'
      ? preferredSpeed
      : inputTokens > 8000 ||
          criteria.capability === 'deepsearch' ||
          criteria.capability === 'agent'
        ? 'quality'
        : inputTokens < 1500
          ? 'fast'
          : 'balanced';

  const cache = modelCache?.[provider] ?? [];
  const known = KNOWN[provider];

  if (hasImages) {
    const visionPatterns = VISION_CAPABLE[provider] ?? [];
    if (visionPatterns.length > 0) {
      const cachedVision = cache.find((m) =>
        visionPatterns.some((re) => regexTest(re, m)),
      );
      if (cachedVision) return cachedVision;
      if (known) {
        const allKnown = [
          ...known[tier],
          ...known.balanced,
          ...known.quality,
          ...known.fast,
        ];
        const knownVision = allKnown.find((m) =>
          visionPatterns.some((re) => regexTest(re, m)),
        );
        if (knownVision) return knownVision;
      }
    }
  }

  if (cache.length > 0) {
    // Prefer a cached model matching the tier keyword heuristics; otherwise the
    // first cached model (user-curated, so any entry is acceptable).
    const tierMatch = cache.find((m) => matchesTier(m, tier, provider));
    return tierMatch ?? cache[0];
  }

  if (known) {
    return known[tier][0] ?? known.balanced[0] ?? known.quality[0];
  }

  return undefined;
}

function regexTest(re: RegExp, value: string): boolean {
  re.lastIndex = 0;
  return re.test(value);
}

function matchesTier(
  model: string,
  tier: 'fast' | 'balanced' | 'quality',
  provider: string,
): boolean {
  const m = model.toLowerCase();
  if (tier === 'quality') {
    return (
      /opus|pro|max|large|reasoner|70b|32b|premium/.test(m) ||
      (provider === 'deepseek' && /reasoner/.test(m))
    );
  }
  if (tier === 'fast') {
    return (
      /mini|flash-lite|haiku|small|8b|instant|flash(?!-lite)/.test(m) &&
      !/opus|large|70b/.test(m)
    );
  }
  return true; // balanced accepts anything
}
