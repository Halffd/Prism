export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
  context?: ContextData;
  timestamp: number;
  tokens?: number;
  characterId?: string;
  metrics?: ResponseMetrics;
}

export interface ResponseMetrics {
  tokensPerSecond?: number;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  contextSize?: number;
  finishReason?: string;
  model?: string;
  provider?: string;
}

export interface ContextData {
  type: 'page' | 'screen' | 'selection';
  url?: string;
  title?: string;
  selectedText?: string;
  fullText?: string;
  appName?: string;
  metadata?: Record<string, unknown>;
  systemPrompt?: string;
}

export interface PromptShortcut {
  id: string;
  name: string;
  content: string;
  category?: string;
  shortcutKey?: string;
  keyboardShortcut?: string;
  keyboardShortcuts?: string[]; // Multiple bindings; backward-compat with keyboardShortcut
  createdAt: number;
}

export interface ChatSession {
  id: string;
  userId: string;
  title?: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  parentSessionId?: string;
  forkedFromMessageId?: string;
  meta?: ChatMeta;
}

export interface ChatHistoryState {
  past: Message[][];
  present: Message[];
  future: Message[][];
}

export interface FormField {
  name: string;
  value: unknown;
  error?: string;
  touched: boolean;
  dirty: boolean;
}

export interface FormState {
  fields: Record<string, FormField>;
  isValid: boolean;
  isSubmitting: boolean;
  submitCount: number;
  errors: Record<string, string>;
}

export interface ChatFormData {
  [formId: string]: FormState;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export type AIProvider =
  | 'openai'
  | 'gemini'
  | 'qwen'
  | 'prism-api'
  | 'koboldcpp'
  | 'llamacpp'
  | 'ollama'
  | 'sglang'
  | 'transformers'
  | 'claude'
  | 'deepseek'
  | 'grok'
  | 'openrouter'
  | 'poe'
  | 'nvidia-nim'
  | 'groq'
  | 'cerebras'
  | 'cloudflare-workers'
  | 'fireworks'
  | 'zai'
  | 'mistral'
  | 'cohere'
  | 'together'
  | 'perplexity'
  | 'kling'
  | 'luma'
  | 'tripo'
  | 'meshy'
  | 'runway'
  | 'stability'
  | 'huggingface'
  | 'elevenlabs'
  | 'brave'
  | 'tavily'
  | 'serper'
  | 'bing'
  | 'duckduckgo'
  | 'jina'
  | 'searxng';

export interface AIConfig {
  provider: AIProvider;
  providerKeys?: {
    openai?: string;
    gemini?: string;
    qwen?: string;
    'prism-api'?: string;
    koboldcpp?: string;
    llamacpp?: string;
    ollama?: string;
    sglang?: string;
    transformers?: string;
    claude?: string;
    deepseek?: string;
    grok?: string;
    openrouter?: string;
    poe?: string;
    'nvidia-nim'?: string;
    groq?: string;
    cerebras?: string;
    'cloudflare-workers'?: string;
    fireworks?: string;
    zai?: string;
    mistral?: string;
    cohere?: string;
    together?: string;
    perplexity?: string;
    kling?: string;
    luma?: string;
    tripo?: string;
    meshy?: string;
    runway?: string;
    stability?: string;
    huggingface?: string;
    elevenlabs?: string;
    brave?: string;
    tavily?: string;
    serper?: string;
    bing?: string;
    duckduckgo?: string;
    jina?: string;
    searxng?: string;
  };
  apiKey?: string;
  apiUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  localApiUrl?: string;
  imageSupport?: boolean;
  mode?: AIMode;
  capabilityModes?: Partial<Record<AICapability, AIMode>>;
  systemPrompt?: string;
  modelCache?: Record<string, string[]>;
  thinkingMode?: ThinkingConfig;
  /** Hardware/low-spec profile for local inference servers. */
  hardware?: HardwareProfile;
  /** Reduced memory/animation/token budgets for low-spec machines. */
  lowSpecMode?: boolean;
}

export interface HardwareProfile {
  preferredCompute:
    'auto' | 'cpu-only' | 'gpu-auto' | 'gpu-nvidia' | 'gpu-amd' | 'gpu-intel';
  /** GPU offload layer override for llama.cpp-style servers. */
  gpuLayersOverride?: number;
  /** Context size hint (tokens) for local servers. */
  contextTokens?: number;
}

export type PopupDisplayMode = 'popup' | 'sidebar' | 'iframe' | 'floating';

export interface ExtensionSettings {
  popupDisplayMode: PopupDisplayMode;
  sidebarPosition: 'left' | 'right';
  sidebarWidth: number;
  enablePopupIframe: boolean;
  enableSidebar: boolean;
  defaultProvider: AIProvider;
  adapterMode?: AIMode;
  capabilityModes?: Partial<Record<AICapability, AIMode>>;
  prismApiUrl?: string;
  prismApiKey?: string;
  pageContentTokenLimit?: number;
  totalMessageTokenLimit?: number;
  buttonPosition?: { top: number; right: number };
  buttonSensitivityAreaPercentage?: number;
  textSelectionKey?: string;
  pageContextKey?: string;
  pageScreenshotKey?: string;
  clipboardKey?: string;
  pageInfoKey?: string;
  iframeToggleKey?: string;
  systemPrompt?: string;
  activeCharacterId?: string;
  activePersonaId?: string;
  activeWorldInfoId?: string;
  activePresetId?: string;
  activeAgentId?: string;
  contextAssembler?: ContextAssemblerConfig;
}

export interface AudioTranscriptionResponse {
  text: string;
  language?: string;
  duration?: number;
}

export interface TTSOptions {
  model?: string;
  voice?:
    | 'alloy'
    | 'ash'
    | 'ballad'
    | 'coral'
    | 'echo'
    | 'sage'
    | 'shimmer'
    | 'verse';
  speed?: number;
  responseFormat?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav';
}

export interface AudioServiceConfig {
  apiKey: string;
  apiUrl?: string;
  provider?: AIProvider;
}

export type AICapability =
  | 'chat'
  | 'ocr'
  | 'stt'
  | 'tts'
  | 'image-gen'
  | 'inpaint'
  | 'model-gen'
  | 'audio-gen'
  | 'video-gen'
  | 'llm'
  | 'agent'
  | 'web-search'
  | 'deepsearch'
  | 'council'
  | 'debate';

export type AIMode = 'api' | 'server' | 'local';

export type Result<T, E = string> =
  { ok: true; value: T } | { ok: false; error: E };

export interface ServiceConfig {
  apiKey: string;
  apiUrl?: string;
  model?: string;
  provider: AIProvider;
}

export type LocalSearchProvider = 'duckduckgo' | 'searxng';

export interface AdapterConfig {
  mode: AIMode;
  prismApiUrl?: string;
  prismApiKey?: string;
  authToken?: string;
  localApiUrl?: string;
  localSearchProvider?: LocalSearchProvider;
  searxngUrl?: string;
  providerKeys?: AIConfig['providerKeys'];
  /** Hardware/low-spec profile forwarded to the local adapter. */
  hardware?: HardwareProfile;
}

export interface OCRRequest {
  image: Blob | string;
  language?: string;
  mimeType?: string;
}

export interface OCRResult {
  text: string;
  confidence: number;
  blocks?: OCRBlock[];
  language?: string;
}

export interface OCRBlock {
  text: string;
  confidence: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface STTRequest {
  audio: Blob;
  language?: string;
  mimeType?: string;
}

export interface STTResult {
  text: string;
  language?: string;
  duration?: number;
  segments?: STTSegment[];
}

export interface STTSegment {
  text: string;
  start: number;
  end: number;
  confidence: number;
}

export interface TTSRequest {
  text: string;
  voice?: string;
  speed?: number;
  model?: string;
  responseFormat?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
}

export interface TTSResult {
  audio: Blob;
  duration?: number;
  format: string;
}

export interface InpaintRequest {
  image: Blob | string;
  mask: Blob | string;
  prompt: string;
  negativePrompt?: string;
  numInferenceSteps?: number;
  guidanceScale?: number;
  seed?: number;
}

export interface InpaintResult {
  image: Blob;
  imageUrl?: string;
}

export interface ModelGenRequest {
  prompt: string;
  image?: Blob | string;
  format?: 'glb' | 'obj' | 'stl' | 'usdz' | 'gltf';
  quality?: 'draft' | 'medium' | 'high';
  seed?: number;
}

export interface ModelGenResult {
  model: Blob;
  modelUrl?: string;
  format: string;
}

export interface AudioGenRequest {
  prompt: string;
  duration?: number;
  model?: string;
  seed?: number;
  outputFormat?: 'wav' | 'mp3' | 'ogg' | 'flac';
}

export interface AudioGenResult {
  audio: Blob;
  audioUrl?: string;
  duration: number;
  format: string;
}

export interface VideoGenRequest {
  prompt: string;
  image?: Blob | string;
  duration?: number;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  model?: string;
  seed?: number;
  outputFormat?: 'mp4' | 'webm' | 'gif';
}

export interface VideoGenResult {
  video: Blob;
  videoUrl?: string;
  duration: number;
  format: string;
}

export interface LLMRequest {
  messages: Message[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stream?: boolean;
  /** Extended thinking/reasoning. Provider-native when supported, otherwise a step-by-step prompt instruction. */
  thinking?: ThinkingConfig;
}

export interface ThinkingConfig {
  enabled: boolean;
  /** Token budget for provider-native thinking (e.g. Anthropic budget_tokens). */
  budgetTokens?: number;
}

export interface LLMResult {
  content: string;
  tokensUsed?: number;
  model?: string;
  finishReason?: string;
  /** Reasoning/scratchpad text when the provider returns it separately. */
  thinking?: string;
}

export interface AgentRequest {
  task: string;
  context?: Record<string, unknown>;
  maxSteps?: number;
  tools?: AgentTool[];
  agentId?: string;
  /** Tone/style descriptor composed into the system prompt. */
  personality?: string;
  /** Persistent memories ranked into the system prompt. */
  memories?: AgentMemory[];
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type BuiltinToolName =
  'web_search' | 'calculator' | 'fetch_url' | 'code_eval' | 'read_file';

export interface AgentToolDef {
  name: BuiltinToolName | string;
  description: string;
  parameters: Record<string, unknown>;
  enabled: boolean;
}

export type AgentStrategy = 'react' | 'plan-and-execute' | 'reflexion';

export interface CustomAgent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  strategy: AgentStrategy;
  provider: AIProvider;
  model?: string;
  temperature: number;
  maxSteps: number;
  maxTokens: number;
  tools: AgentToolDef[];
  /** Freeform tone/style descriptor shaping the agent's voice. */
  personality?: string;
  /** Persistent memories carried across sessions. */
  coreMemories?: AgentMemory[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentMemory {
  id: string;
  agentId: string;
  kind: 'fact' | 'preference' | 'note';
  content: string;
  /** 0–1; used for retrieval ranking. */
  importance?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentStep {
  thought: string;
  action: string;
  observation: string;
}

export interface AgentResult {
  answer: string;
  steps: AgentStep[];
  tokensUsed?: number;
  model?: string;
  agentId?: string;
}

export interface WebSearchRequest {
  query: string;
  maxResults?: number;
  freshness?: 'day' | 'week' | 'month' | 'year' | 'all';
  region?: string;
  safeSearch?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  publishedDate?: string;
  author?: string;
  score?: number;
  domain: string;
}

export interface WebSearchResult {
  results: WebSearchResultItem[];
  query: string;
  totalResults?: number;
  latencyMs?: number;
}

export interface DeepSearchPhase {
  id: string;
  type: 'query' | 'search' | 'extract' | 'synthesize' | 'validate';
  status: 'pending' | 'running' | 'completed' | 'failed';
  query?: string;
  searchResults?: WebSearchResultItem[];
  extractedContent?: string;
  synthesis?: string;
  gaps?: string[];
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface DeepSearchRequest {
  query: string;
  maxDepth?: number;
  maxSearches?: number;
  maxExtractions?: number;
  targetTokens?: number;
  freshness?: 'day' | 'week' | 'month' | 'year' | 'all';
  region?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  onPhaseUpdate?: (phase: DeepSearchPhase) => void;
}

export interface DeepSearchResult {
  answer: string;
  sources: WebSearchResultItem[];
  phases: DeepSearchPhase[];
  totalSearches: number;
  totalExtractions: number;
  tokensUsed?: number;
  latencyMs?: number;
  confidence?: number;
  gaps?: string[];
}

export type PromptPosition =
  | 'system'
  | 'before-system'
  | 'after-system'
  | 'before-char'
  | 'after-char'
  | 'before-history'
  | 'after-history'
  | 'before-input'
  | 'after-input';

export interface PromptPreset {
  id: string;
  name: string;
  description?: string;
  prompts: PromptEntry[];
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PromptEntry {
  id: string;
  name: string;
  content: string;
  position: PromptPosition;
  role: 'system' | 'user' | 'assistant';
  enabled: boolean;
  injectionDepth?: number;
  order?: number;
}

export interface CharacterCard {
  id: string;
  spec: 'chara_card_v2';
  specVersion: '2.0';
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  mesExample: string;
  creatorNotes: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  alternateGreetings: string[];
  tags: string[];
  creator: string;
  characterVersion: string;
  avatar?: string;
  extensions: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface PersonaProfile {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  avatar?: string;
  createdAt: number;
  updatedAt: number;
}

export type WorldInfoPosition =
  | 'before-char'
  | 'after-char'
  | 'before-system'
  | 'after-system'
  | 'before-input'
  | 'after-input';

export interface WorldInfoEntry {
  id: string;
  worldInfoId: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  comment: string;
  enabled: boolean;
  position: WorldInfoPosition;
  insertionOrder: number;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  useGroupScoring: boolean;
  scanDepth: number;
  preventRecursion: boolean;
  delayUntilRecursion: number;
  role: 'system' | 'user' | 'assistant';
  probability: number;
  extensions: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface WorldInfo {
  id: string;
  name: string;
  description?: string;
  entries: string[];
  scanDepth: number;
  tokenBudget: number;
  recursiveScanning: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMeta {
  characterId?: string;
  personaId?: string;
  worldInfoId?: string;
  presetId?: string;
  greetingIndex?: number;
  characterIds?: string[];
  groupChatConfig?: GroupChatConfig;
}

export type GroupChatMode = 'round-robin' | 'reactive' | 'selective';

export interface GroupChatConfig {
  mode: GroupChatMode;
  turnOrder?: string[];
  currentTurnIndex?: number;
  allowSelfInteractions?: boolean;
  maxResponsesPerTurn?: number;
}

export interface MessageSwipe {
  id: string;
  content: string;
  tokens?: number;
  selected: boolean;
}

export interface GroupChatResponse {
  messages: Message[];
  mode: GroupChatMode;
  respondingCharacterIds: string[];
}

export interface EnhancedMessage extends Message {
  swipes?: MessageSwipe[];
  swipeIndex?: number;
  isEditing?: boolean;
  isContinued?: boolean;
  parentMessageId?: string;
  metadata?: Record<string, unknown>;
}

export interface ContextAssemblerConfig {
  maxTokens: number;
  systemPromptPosition: PromptPosition;
  characterCardPosition: PromptPosition;
  personaPosition: PromptPosition;
  worldInfoPosition: PromptPosition;
  presetPosition: PromptPosition;
  includeWorldInfo: boolean;
  includeCharacterCard: boolean;
  includePersona: boolean;
  includePreset: boolean;
  worldInfoScanDepth: number;
  worldInfoTokenBudget: number;
  worldInfoRecursive: boolean;
  groupChat?: {
    includeAllCharacters?: boolean;
    characterSeparator?: string;
    characterTokenBudget?: number;
  };
}

export interface AssembledContext {
  systemPrompt: string;
  messages: Message[];
  tokenCount: number;
  tokenBreakdown: {
    system: number;
    character: number;
    characters?: Record<string, number>;
    persona: number;
    worldInfo: number;
    preset: number;
    history: number;
    input: number;
  };
  activatedWorldInfoEntries: WorldInfoEntry[];
}

export interface CouncilMember {
  provider: AIProvider;
  model?: string;
  label?: string;
}

export interface CouncilRequest {
  prompt: string;
  members: CouncilMember[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  votingStrategy?: 'single-judge' | 'peer-vote' | 'consensus';
  judgeProvider?: AIProvider;
  judgeModel?: string;
  onMemberUpdate?: (
    member: CouncilMember,
    status: 'pending' | 'thinking' | 'done' | 'failed',
    response?: string,
  ) => void;
}

export interface CouncilResponse {
  responses: CouncilMemberResponse[];
  verdict: CouncilVerdict;
  totalTokensUsed?: number;
  latencyMs?: number;
}

export interface CouncilMemberResponse {
  provider: AIProvider;
  model?: string;
  label?: string;
  content: string;
  tokensUsed?: number;
  latencyMs?: number;
  error?: string;
}

export interface CouncilVote {
  voterProvider: AIProvider;
  voterModel?: string;
  rankedResponses: Array<{
    rank: number;
    provider: AIProvider;
    model?: string;
  }>;
  reasoning: string;
}

export interface CouncilVerdict {
  winnerProvider: AIProvider;
  winnerModel?: string;
  winnerContent: string;
  votes: CouncilVote[];
  strategy: 'single-judge' | 'peer-vote' | 'consensus';
  reasoning: string;
}

export interface MultiSendTarget {
  provider: AIProvider;
  model?: string;
  label?: string;
}

export interface MultiSendRequest {
  prompt: string;
  targets: MultiSendTarget[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  conversationHistory?: Message[];
  onTargetUpdate?: (
    target: MultiSendTarget,
    status: 'pending' | 'thinking' | 'done' | 'failed',
    response?: string,
  ) => void;
}

export interface MultiSendTargetResponse {
  provider: AIProvider;
  model?: string;
  label?: string;
  content: string;
  tokensUsed?: number;
  latencyMs?: number;
  error?: string;
}

export interface MultiSendResponse {
  responses: MultiSendTargetResponse[];
  totalTokensUsed?: number;
  latencyMs?: number;
}

export interface MultiSendTarget {
  provider: AIProvider;
  model?: string;
  label?: string;
}

export interface MultiSendRequest {
  prompt: string;
  targets: MultiSendTarget[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  conversationHistory?: Message[];
  onTargetUpdate?: (
    target: MultiSendTarget,
    status: 'pending' | 'thinking' | 'done' | 'failed',
    response?: string,
  ) => void;
}

export interface MultiSendTargetResponse {
  provider: AIProvider;
  model?: string;
  label?: string;
  content: string;
  tokensUsed?: number;
  latencyMs?: number;
  error?: string;
}

export interface MultiSendResponse {
  responses: MultiSendTargetResponse[];
  totalTokensUsed?: number;
  latencyMs?: number;
}

export type DebateMode = 'dual' | 'group';

export interface DebateParticipant {
  provider: AIProvider;
  model?: string;
  label?: string;
  stance?: 'support' | 'oppose' | 'neutral';
}

export interface DebateTurn {
  participantIndex: number;
  participant: DebateParticipant;
  content: string;
  tokensUsed?: number;
  latencyMs?: number;
  error?: string;
}

export interface DebateRequest {
  topic: string;
  participants: DebateParticipant[];
  mode: DebateMode;
  maxTurns?: number;
  systemPrompt?: string;
  conversationHistory?: Message[];
  temperature?: number;
  maxTokens?: number;
  onTurnUpdate?: (
    turn: DebateTurn,
    turnIndex: number,
    totalTurns: number,
  ) => void;
}

export interface DebateResult {
  turns: DebateTurn[];
  summary?: string;
  totalTokensUsed?: number;
  latencyMs?: number;
}
