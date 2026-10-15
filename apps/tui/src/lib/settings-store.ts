import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type {
  AICapability,
  AIConfig,
  AIMode,
  AIProvider,
  HardwareProfile,
  LocalSearchProvider,
} from '@prism/shared-types';

/**
 * File-backed persistence for TUI settings. Stores the mutable subset of the
 * useSettings state as JSON (atomic tmp+rename write, defaults on missing or
 * corrupt files) so provider, keys, model and hardware choices survive
 * restarts. UI-only state (open/closed panels) is never persisted.
 *
 * Keys are stored in plaintext, matching the Prism extension convention.
 */

const AIMODES: AIMode[] = ['api', 'server', 'local'];

const CAPABILITIES: AICapability[] = [
  'chat',
  'ocr',
  'stt',
  'tts',
  'image-gen',
  'inpaint',
  'model-gen',
  'audio-gen',
  'video-gen',
  'llm',
  'agent',
  'web-search',
  'deepsearch',
  'council',
  'debate',
];

const SEARCH_PROVIDERS: LocalSearchProvider[] = ['duckduckgo', 'searxng'];

const COMPUTE_LEVELS: HardwareProfile['preferredCompute'][] = [
  'auto',
  'cpu-only',
  'gpu-auto',
  'gpu-nvidia',
  'gpu-amd',
  'gpu-intel',
];

const PERMISSION_LEVELS: Array<'allow' | 'ask' | 'deny'> = [
  'allow',
  'ask',
  'deny',
];

/** Fields of the useSettings state that are written to disk. */
export interface PersistedInput {
  aiConfig: AIConfig;
  adapterMode: AIMode;
  capabilityModes: Partial<Record<AICapability, AIMode>>;
  defaultToolPermission?: 'allow' | 'deny' | 'ask';
  localApiUrl: string;
  localSearchProvider: LocalSearchProvider;
  searxngUrl: string;
}

export interface PersistedSettings extends PersistedInput {
  /** Schema version for forward compatibility. */
  version: 1;
}

export function defaultPersisted(): PersistedSettings {
  return {
    version: 1,
    aiConfig: {
      provider: 'openai',
      apiUrl: 'https://api.openai.com/v1',
      providerKeys: { openai: '' },
      hardware: { preferredCompute: 'auto' },
    },
    adapterMode: 'api',
    capabilityModes: {},
    localApiUrl: 'http://localhost:8080',
    localSearchProvider: 'duckduckgo',
    searxngUrl: 'http://localhost:8888',
  };
}

/** Location of the settings file. PRISM_TUI_SETTINGS overrides everything. */
export function settingsFilePath(): string | null {
  const override = process.env.PRISM_TUI_SETTINGS;
  if (override) {
    return override;
  }
  try {
    const configHome =
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(configHome, 'prism', 'tui-settings.json');
  } catch {
    return null;
  }
}

/** Pick the persisted subset out of the (larger) hook state. */
export function toPersisted(input: PersistedInput): PersistedSettings {
  const out: PersistedSettings = {
    version: 1,
    aiConfig: input.aiConfig,
    adapterMode: input.adapterMode,
    capabilityModes: input.capabilityModes,
    localApiUrl: input.localApiUrl,
    localSearchProvider: input.localSearchProvider,
    searxngUrl: input.searxngUrl,
  };
  if (input.defaultToolPermission !== undefined) {
    out.defaultToolPermission = input.defaultToolPermission;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function sanitizeHardware(raw: unknown): HardwareProfile | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const compute = raw.preferredCompute;
  const profile: HardwareProfile = {
    preferredCompute: COMPUTE_LEVELS.includes(
      compute as HardwareProfile['preferredCompute'],
    )
      ? (compute as HardwareProfile['preferredCompute'])
      : 'auto',
  };
  const gpuLayers = asFiniteNumber(raw.gpuLayersOverride);
  if (gpuLayers !== undefined) {
    profile.gpuLayersOverride = gpuLayers;
  }
  const contextTokens = asFiniteNumber(raw.contextTokens);
  if (contextTokens !== undefined) {
    profile.contextTokens = contextTokens;
  }
  return profile;
}

function sanitizeCapabilityModes(
  raw: unknown,
): Partial<Record<AICapability, AIMode>> | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const out: Partial<Record<AICapability, AIMode>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      (CAPABILITIES as string[]).includes(key) &&
      (AIMODES as string[]).includes(value as string)
    ) {
      out[key as AICapability] = value as AIMode;
    }
  }
  return out;
}

/**
 * Rebuild an AIConfig from untrusted JSON, keeping only known fields with
 * correct types. Runtime-only fields (modelCache, thinkingMode) are dropped.
 */
function sanitizeAiConfig(raw: unknown): AIConfig | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const config: AIConfig = { provider: 'openai' };

  const provider = asString(raw.provider);
  if (provider) {
    config.provider = provider as AIProvider;
  }

  if (isRecord(raw.providerKeys)) {
    const keys: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw.providerKeys)) {
      const str = asString(value);
      if (str !== undefined) {
        keys[key] = str;
      }
    }
    config.providerKeys = keys;
  }

  const strings: Array<keyof AIConfig & string> = [
    'apiKey',
    'apiUrl',
    'model',
    'systemPrompt',
    'localApiUrl',
  ];
  for (const key of strings) {
    const value = asString(raw[key]);
    if (value !== undefined) {
      (config as unknown as Record<string, unknown>)[key] = value;
    }
  }

  const numbers: Array<keyof AIConfig & string> = [
    'temperature',
    'maxTokens',
    'topP',
    'frequencyPenalty',
    'presencePenalty',
  ];
  for (const key of numbers) {
    const value = asFiniteNumber(raw[key]);
    if (value !== undefined) {
      (config as unknown as Record<string, unknown>)[key] = value;
    }
  }

  const booleans: Array<keyof AIConfig & string> = [
    'imageSupport',
    'lowSpecMode',
  ];
  for (const key of booleans) {
    if (typeof raw[key] === 'boolean') {
      (config as unknown as Record<string, unknown>)[key] = raw[key];
    }
  }

  const mode = raw.mode;
  if ((AIMODES as string[]).includes(mode as string)) {
    config.mode = mode as AIMode;
  }

  const capabilityModes = sanitizeCapabilityModes(raw.capabilityModes);
  if (capabilityModes) {
    config.capabilityModes = capabilityModes;
  }

  const hardware = sanitizeHardware(raw.hardware);
  if (hardware) {
    config.hardware = hardware;
  }

  return config;
}

/** Merge untrusted parsed JSON onto defaults; never throws. */
function sanitizeParsed(data: unknown): PersistedSettings {
  const defaults = defaultPersisted();
  if (!isRecord(data)) {
    return defaults;
  }

  const adapterMode = data.adapterMode;
  const searchProvider = data.localSearchProvider;
  const permission = data.defaultToolPermission;

  const parsedConfig = sanitizeAiConfig(data.aiConfig);
  const aiConfig = parsedConfig
    ? {
        ...defaults.aiConfig,
        ...parsedConfig,
        providerKeys: {
          ...defaults.aiConfig.providerKeys,
          ...parsedConfig.providerKeys,
        },
      }
    : defaults.aiConfig;

  const out: PersistedSettings = {
    version: 1,
    aiConfig,
    adapterMode: (AIMODES as string[]).includes(adapterMode as string)
      ? (adapterMode as AIMode)
      : defaults.adapterMode,
    capabilityModes:
      sanitizeCapabilityModes(data.capabilityModes) ?? defaults.capabilityModes,
    localApiUrl: asString(data.localApiUrl) ?? defaults.localApiUrl,
    localSearchProvider: (SEARCH_PROVIDERS as string[]).includes(
      searchProvider as string,
    )
      ? (searchProvider as LocalSearchProvider)
      : defaults.localSearchProvider,
    searxngUrl: asString(data.searxngUrl) ?? defaults.searxngUrl,
  };
  if ((PERMISSION_LEVELS as string[]).includes(permission as string)) {
    out.defaultToolPermission = permission as 'allow' | 'deny' | 'ask';
  }
  return out;
}

/**
 * Load settings from disk. Missing, unreadable, or corrupt files yield
 * defaults; a partially-filled file yields defaults for absent fields.
 */
export function loadPersisted(): PersistedSettings {
  const file = settingsFilePath();
  if (!file) {
    return defaultPersisted();
  }
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return defaultPersisted();
  }
  try {
    return sanitizeParsed(JSON.parse(raw));
  } catch {
    return defaultPersisted();
  }
}

/**
 * Write settings atomically (tmp file + rename). Creates parent directories.
 * Throws on I/O failure — callers decide whether that is fatal.
 */
export function savePersisted(settings: PersistedSettings): void {
  const file = settingsFilePath();
  if (!file) {
    throw new Error('no config directory available');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}
