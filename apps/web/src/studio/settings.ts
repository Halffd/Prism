// Settings and persistence shared by the web studio surfaces. The storage
// keys and data shape match the earlier standalone studio so a browser
// carries its choices over.

export const SETTINGS_KEY = 'prism.studio.settings.v1';
export const CONVERSATIONS_KEY = 'prism.studio.conversations.v1';
export const PRISM_API_ID = 'prism-api';
export const SYSTEM_PRIMER =
  'You are Prism, a concise assistant embedded in a video generation studio.';

export interface StudioSettings {
  provider_id: string;
  base_url: string;
  model: string;
  api_key: string;
}

export interface StudioProvider {
  id: string;
  label: string;
  base_url: string;
  default_model: string;
  needs_key: boolean;
}

const PRISM_PROVIDER: StudioProvider = {
  id: PRISM_API_ID,
  label: 'Prism API (self-hosted)',
  base_url: 'http://localhost:3000',
  default_model: 'prism',
  needs_key: false,
};

// Fallback keeps Settings usable even if the core wasm has not loaded yet.
const FALLBACK_PROVIDERS: StudioProvider[] = [
  { id: 'openai', label: 'OpenAI', base_url: 'https://api.openai.com/v1', default_model: 'gpt-4o-mini', needs_key: true },
  { id: 'local', label: 'Prism Native (local)', base_url: 'http://127.0.0.1:7861/v1', default_model: 'local-model', needs_key: false },
  { id: 'ollama', label: 'Ollama', base_url: 'http://127.0.0.1:11434/v1', default_model: 'llama3.2', needs_key: false },
  PRISM_PROVIDER,
];

export function providerList(coreProviders: StudioProvider[] = []): StudioProvider[] {
  const list = coreProviders.length ? coreProviders : FALLBACK_PROVIDERS;
  return [...list, PRISM_PROVIDER].filter(
    (p, i, all) => all.findIndex((candidate) => candidate.id === p.id) === i,
  );
}

export function forProvider(
  id: string,
  coreProviders: StudioProvider[] = [],
): StudioSettings {
  const provider =
    providerList(coreProviders).find((candidate) => candidate.id === id) ?? PRISM_PROVIDER;
  return {
    provider_id: provider.id,
    base_url: provider.base_url,
    model: provider.default_model,
    api_key: '',
  };
}

export function providerLabel(id: string, coreProviders: StudioProvider[] = []): string {
  return providerList(coreProviders).find((p) => p.id === id)?.label ?? id;
}

export function needsKey(id: string, coreProviders: StudioProvider[] = []): boolean {
  return providerList(coreProviders).find((p) => p.id === id)?.needs_key ?? false;
}

export function isOllama(settings: StudioSettings): boolean {
  return settings.provider_id === 'ollama';
}

export function loadSettings(): StudioSettings {
  if (typeof window === 'undefined') return forProvider(PRISM_API_ID);
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StudioSettings>;
      if (parsed.provider_id) return { ...forProvider(parsed.provider_id), ...parsed } as StudioSettings;
    }
  } catch {
    // localStorage can be disabled; the in-memory default still works.
  }
  return forProvider(PRISM_API_ID);
}

export function saveSettings(settings: StudioSettings): boolean {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  entries: ChatEntry[];
}

export function loadConversations(): Conversation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CONVERSATIONS_KEY);
    return raw ? (JSON.parse(raw) as Conversation[]) : [];
  } catch {
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): void {
  try {
    window.localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
  } catch {
    // Keep the session in memory when storage is unavailable.
  }
}

export function conversationTitle(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 48) return trimmed;
  return `${trimmed.slice(0, 48)}…`;
}

export function ollamaRootUrl(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, '');
}

export function chatCompletionsUrl(baseUrl: string): string {
  const root = baseUrl.replace(/\/+$/, '');
  return root.endsWith('/v1') ? `${root}/chat/completions` : `${root}/v1/chat/completions`;
}

export function modelsUrl(baseUrl: string): string {
  const root = chatCompletionsUrl(baseUrl).replace(/\/chat\/completions$/, '');
  return `${root}/models`;
}
