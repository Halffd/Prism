import { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { colors, spacing } from '../theme/nocturnal-editorial';
import type {
  AIProvider,
  AIMode,
  AICapability,
  LocalSearchProvider,
  HardwareProfile,
} from '@prism/shared-types';

const PROVIDERS: AIProvider[] = ['openai', 'gemini', 'qwen', 'prism-api'];

const MODES: AIMode[] = ['api', 'server', 'local'];
const CAPABILITIES: AICapability[] = [
  'llm',
  'ocr',
  'stt',
  'tts',
  'image-gen',
  'inpaint',
  'model-gen',
  'audio-gen',
  'video-gen',
  'agent',
  'web-search',
  'deepsearch',
  'council',
];

const LOCAL_INFERENCE_OPTIONS = [
  { label: 'llama.cpp', url: 'http://localhost:8080' },
  { label: 'Ollama', url: 'http://localhost:11434' },
  { label: 'KoboldCpp', url: 'http://localhost:5001' },
  { label: 'SGLang', url: 'http://localhost:30000' },
];

const LOCAL_SEARCH_OPTIONS: {
  key: LocalSearchProvider;
  label: string;
  desc: string;
}[] = [
  { key: 'duckduckgo', label: 'DuckDuckGo', desc: 'No setup, scrapes HTML' },
  { key: 'searxng', label: 'SearXNG', desc: 'Self-hosted, requires docker' },
];

interface SettingsScreenProps {
  provider: AIProvider;
  model?: string;
  adapterMode: AIMode;
  capabilityModes: Partial<Record<AICapability, AIMode>>;
  localApiUrl: string;
  localSearchProvider: LocalSearchProvider;
  searxngUrl: string;
  defaultToolPermission?: 'allow' | 'deny' | 'ask';
  hardware?: HardwareProfile;
  onSetProvider: (p: AIProvider) => void;
  onSetAdapterMode: (m: AIMode) => void;
  onSetCapabilityMode: (c: AICapability, m: AIMode) => void;
  onSetLocalApiUrl: (u: string) => void;
  onSetLocalSearchProvider: (p: LocalSearchProvider) => void;
  onSetSearxngUrl: (u: string) => void;
  onSetModel: (m: string) => void;
  onSetDefaultToolPermission?: (p: 'allow' | 'deny' | 'ask') => void;
  onSetHardware?: (h: HardwareProfile) => void;
  onClose: () => void;
}

type Section =
  | 'provider'
  | 'mode'
  | 'local'
  | 'search'
  | 'capabilities'
  | 'permissions'
  | 'hardware'
  | 'model';

const PERMISSION_LEVELS: Array<'allow' | 'ask' | 'deny'> = [
  'allow',
  'ask',
  'deny',
];

export function SettingsScreen({
  provider,
  model,
  adapterMode,
  capabilityModes,
  localApiUrl,
  localSearchProvider,
  searxngUrl,
  defaultToolPermission,
  hardware = { preferredCompute: 'auto' },
  onSetProvider,
  onSetAdapterMode,
  onSetCapabilityMode,
  onSetLocalApiUrl,
  onSetLocalSearchProvider,
  onSetSearxngUrl,
  onSetModel,
  onSetDefaultToolPermission,
  onSetHardware,
  onClose,
}: SettingsScreenProps) {
  const { exit } = useApp();
  const [activeSection, setActiveSection] = useState<Section>('provider');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState(localApiUrl);
  const [editingModel, setEditingModel] = useState(false);
  const [modelDraft, setModelDraft] = useState(model ?? '');
  const [editingSearxng, setEditingSearxng] = useState(false);
  const [searxngDraft, setSearxngDraft] = useState(searxngUrl);

  const sections: Section[] = [
    'provider',
    'mode',
    'local',
    'search',
    'capabilities',
    'permissions',
    'hardware',
    'model',
  ];
  const sectionIdx = sections.indexOf(activeSection);

  useInput((input, key) => {
    if (editingUrl) {
      if (key.return) {
        onSetLocalApiUrl(urlDraft);
        setEditingUrl(false);
        return;
      }
      if (key.escape) {
        setEditingUrl(false);
        return;
      }
      if (key.backspace || key.delete) {
        setUrlDraft((u) => u.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setUrlDraft((u) => u + input);
      }
      return;
    }

    if (editingModel) {
      if (key.return) {
        onSetModel(modelDraft);
        setEditingModel(false);
        return;
      }
      if (key.escape) {
        setEditingModel(false);
        return;
      }
      if (key.backspace || key.delete) {
        setModelDraft((m) => m.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setModelDraft((m) => m + input);
      }
      return;
    }

    if (editingSearxng) {
      if (key.return) {
        onSetSearxngUrl(searxngDraft);
        setEditingSearxng(false);
        return;
      }
      if (key.escape) {
        setEditingSearxng(false);
        return;
      }
      if (key.backspace || key.delete) {
        setSearxngDraft((u) => u.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setSearxngDraft((u) => u + input);
      }
      return;
    }

    if (key.escape) {
      onClose();
      return;
    }

    if (key.tab) {
      const next = (sectionIdx + 1) % sections.length;
      setActiveSection(sections[next]);
      setSelectedIdx(0);
      return;
    }

    if (input === 'q') {
      exit();
      return;
    }

    if (key.upArrow) {
      setSelectedIdx((i) => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow) {
      if (activeSection === 'provider') {
        setSelectedIdx((i) => Math.min(PROVIDERS.length - 1, i + 1));
      } else if (activeSection === 'mode') {
        setSelectedIdx((i) => Math.min(MODES.length - 1, i + 1));
      } else if (activeSection === 'capabilities') {
        setSelectedIdx((i) => Math.min(CAPABILITIES.length - 1, i + 1));
      } else if (activeSection === 'permissions') {
        setSelectedIdx((i) => Math.min(PERMISSION_LEVELS.length - 1, i + 1));
      } else if (activeSection === 'local') {
        setSelectedIdx((i) => Math.min(LOCAL_INFERENCE_OPTIONS.length, i + 1));
      } else if (activeSection === 'search') {
        const maxIdx =
          localSearchProvider === 'searxng'
            ? LOCAL_SEARCH_OPTIONS.length
            : LOCAL_SEARCH_OPTIONS.length - 1;
        setSelectedIdx((i) => Math.min(maxIdx, i + 1));
      }
      return;
    }

    if (key.return) {
      if (activeSection === 'provider') {
        onSetProvider(PROVIDERS[selectedIdx]);
      } else if (activeSection === 'mode') {
        onSetAdapterMode(MODES[selectedIdx]);
      } else if (activeSection === 'local') {
        if (selectedIdx < LOCAL_INFERENCE_OPTIONS.length) {
          onSetLocalApiUrl(LOCAL_INFERENCE_OPTIONS[selectedIdx].url);
        } else {
          setEditingUrl(true);
          setUrlDraft(localApiUrl);
        }
      } else if (activeSection === 'search') {
        if (selectedIdx < LOCAL_SEARCH_OPTIONS.length) {
          onSetLocalSearchProvider(LOCAL_SEARCH_OPTIONS[selectedIdx].key);
        } else {
          setEditingSearxng(true);
          setSearxngDraft(searxngUrl);
        }
      } else if (activeSection === 'capabilities') {
        const cap = CAPABILITIES[selectedIdx];
        const current = capabilityModes[cap] ?? adapterMode;
        const modeIdx = MODES.indexOf(current);
        const nextMode = MODES[(modeIdx + 1) % MODES.length];
        onSetCapabilityMode(cap, nextMode);
      } else if (activeSection === 'permissions') {
        onSetDefaultToolPermission?.(PERMISSION_LEVELS[selectedIdx]);
      } else if (activeSection === 'hardware') {
        const levels: Array<
          | 'auto'
          | 'cpu-only'
          | 'gpu-auto'
          | 'gpu-nvidia'
          | 'gpu-amd'
          | 'gpu-intel'
        > = [
          'auto',
          'cpu-only',
          'gpu-auto',
          'gpu-nvidia',
          'gpu-amd',
          'gpu-intel',
        ];
        const currentIdx = levels.indexOf(hardware.preferredCompute);
        const nextIdx = (currentIdx + 1) % levels.length;
        onSetHardware?.({ ...hardware, preferredCompute: levels[nextIdx] });
      } else if (activeSection === 'model') {
        setEditingModel(true);
        setModelDraft(model ?? '');
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={spacing.xl} paddingY={spacing.lg}>
      <Box paddingBottom={spacing.lg}>
        <Text color={colors.primary} bold>
          Settings
        </Text>
        <Text color={colors.on_surface_variant}>
          {' '}
          | Tab: section | Up/Down: navigate | Enter: select | Esc: back
        </Text>
      </Box>

      <Box flexDirection="column" paddingBottom={spacing.lg}>
        <Text
          color={
            activeSection === 'provider'
              ? colors.primary
              : colors.on_surface_variant
          }
          bold={activeSection === 'provider'}
        >
          Provider {activeSection === 'provider' ? '<' : ''}
        </Text>
        <Box flexDirection="column" paddingLeft={spacing.lg}>
          {PROVIDERS.map((p, i) => (
            <Text
              key={p}
              color={
                i === selectedIdx && activeSection === 'provider'
                  ? colors.on_surface
                  : p === provider
                    ? colors.tertiary
                    : colors.on_surface_variant
              }
            >
              {i === selectedIdx && activeSection === 'provider' ? '> ' : ' '}
              {p} {p === provider ? '(active)' : ''}
            </Text>
          ))}
        </Box>
      </Box>

      <Box flexDirection="column" paddingBottom={spacing.lg}>
        <Text
          color={
            activeSection === 'mode'
              ? colors.primary
              : colors.on_surface_variant
          }
          bold={activeSection === 'mode'}
        >
          Adapter Mode {activeSection === 'mode' ? '<' : ''}
        </Text>
        <Box paddingLeft={spacing.lg} gap={spacing.lg}>
          {MODES.map((m, i) => (
            <Text
              key={m}
              color={
                i === selectedIdx && activeSection === 'mode'
                  ? colors.on_surface
                  : m === adapterMode
                    ? colors.tertiary
                    : colors.on_surface_variant
              }
            >
              {i === selectedIdx && activeSection === 'mode' ? '>' : ' '}
              {m.toUpperCase()}
              {m === adapterMode ? '*' : ''}
            </Text>
          ))}
        </Box>
      </Box>

      {adapterMode === 'local' && (
        <Box flexDirection="column" paddingBottom={spacing.lg}>
          <Text
            color={
              activeSection === 'local'
                ? colors.primary
                : colors.on_surface_variant
            }
            bold={activeSection === 'local'}
          >
            Local Server {activeSection === 'local' ? '<' : ''}
          </Text>
          <Box flexDirection="column" paddingLeft={spacing.lg}>
            {LOCAL_INFERENCE_OPTIONS.map((opt, i) => (
              <Text
                key={opt.label}
                color={
                  i === selectedIdx && activeSection === 'local'
                    ? colors.on_surface
                    : opt.url === localApiUrl
                      ? colors.tertiary
                      : colors.on_surface_variant
                }
              >
                {i === selectedIdx && activeSection === 'local' ? '> ' : ' '}
                {opt.label}: {opt.url}
                {opt.url === localApiUrl ? ' (active)' : ''}
              </Text>
            ))}
            <Text
              color={
                selectedIdx === LOCAL_INFERENCE_OPTIONS.length &&
                activeSection === 'local'
                  ? colors.on_surface
                  : colors.on_surface_variant
              }
            >
              {selectedIdx === LOCAL_INFERENCE_OPTIONS.length &&
              activeSection === 'local'
                ? '> '
                : ' '}
              Custom URL: {editingUrl ? urlDraft + '_' : localApiUrl}
            </Text>
          </Box>
        </Box>
      )}

      {(adapterMode === 'local' ||
        capabilityModes['web-search'] === 'local') && (
        <Box flexDirection="column" paddingBottom={spacing.lg}>
          <Text
            color={
              activeSection === 'search'
                ? colors.primary
                : colors.on_surface_variant
            }
            bold={activeSection === 'search'}
          >
            Local Search (No API Key) {activeSection === 'search' ? '<' : ''}
          </Text>
          <Box flexDirection="column" paddingLeft={spacing.lg}>
            {LOCAL_SEARCH_OPTIONS.map((opt, i) => (
              <Text
                key={opt.key}
                color={
                  i === selectedIdx && activeSection === 'search'
                    ? colors.on_surface
                    : opt.key === localSearchProvider
                      ? colors.tertiary
                      : colors.on_surface_variant
                }
              >
                {i === selectedIdx && activeSection === 'search' ? '> ' : ' '}
                {opt.label} - {opt.desc}
                {opt.key === localSearchProvider ? ' *' : ''}
              </Text>
            ))}
            {localSearchProvider === 'searxng' && (
              <Text
                color={
                  selectedIdx === LOCAL_SEARCH_OPTIONS.length &&
                  activeSection === 'search'
                    ? colors.on_surface
                    : colors.on_surface_variant
                }
              >
                {selectedIdx === LOCAL_SEARCH_OPTIONS.length &&
                activeSection === 'search'
                  ? '> '
                  : ' '}
                SearXNG URL: {editingSearxng ? searxngDraft + '_' : searxngUrl}{' '}
                [Enter: edit]
              </Text>
            )}
          </Box>
        </Box>
      )}

      <Box flexDirection="column" paddingBottom={spacing.lg}>
        <Text
          color={
            activeSection === 'capabilities'
              ? colors.primary
              : colors.on_surface_variant
          }
          bold={activeSection === 'capabilities'}
        >
          Per-Capability Mode {activeSection === 'capabilities' ? '<' : ''}
        </Text>
        <Box flexDirection="column" paddingLeft={spacing.lg}>
          {CAPABILITIES.map((cap, i) => {
            const mode = capabilityModes[cap] ?? adapterMode;
            return (
              <Text
                key={cap}
                color={
                  i === selectedIdx && activeSection === 'capabilities'
                    ? colors.on_surface
                    : colors.on_surface_variant
                }
              >
                {i === selectedIdx && activeSection === 'capabilities'
                  ? '> '
                  : ' '}
                {cap}: {mode.toUpperCase()} [Enter: cycle]
              </Text>
            );
          })}
        </Box>
      </Box>

      <Box flexDirection="column" paddingBottom={spacing.lg}>
        <Text
          color={
            activeSection === 'permissions'
              ? colors.primary
              : colors.on_surface_variant
          }
          bold={activeSection === 'permissions'}
        >
          Tool Permissions {activeSection === 'permissions' ? '<' : ''}
        </Text>
        <Box flexDirection="column" paddingLeft={spacing.lg}>
          <Text color={colors.on_surface_variant}>
            Default for agent tools (shell, read_file, web, …)
          </Text>
          {PERMISSION_LEVELS.map((level, i) => {
            const current = defaultToolPermission ?? 'ask';
            return (
              <Text
                key={level}
                color={
                  i === selectedIdx && activeSection === 'permissions'
                    ? colors.on_surface
                    : colors.on_surface_variant
                }
              >
                {i === selectedIdx && activeSection === 'permissions'
                  ? '> '
                  : ' '}
                {level.toUpperCase()}
                {level === current ? ' *' : ''} [Enter: select]
              </Text>
            );
          })}
          <Text color={colors.on_surface_variant}>
            Ask prompts y/n before each tool run; Deny blocks execution.
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" paddingBottom={spacing.lg}>
        <Text
          color={
            activeSection === 'hardware'
              ? colors.primary
              : colors.on_surface_variant
          }
          bold={activeSection === 'hardware'}
        >
          Hardware {activeSection === 'hardware' ? '<' : ''}
        </Text>
        <Box flexDirection="column" paddingLeft={spacing.lg}>
          <Text color={colors.on_surface_variant}>
            Preferred Compute: {hardware.preferredCompute}
          </Text>
          {hardware.gpuLayersOverride !== undefined && (
            <Text color={colors.on_surface_variant}>
              GPU Layers: {hardware.gpuLayersOverride}
            </Text>
          )}
          {hardware.contextTokens !== undefined && (
            <Text color={colors.on_surface_variant}>
              Context Tokens: {hardware.contextTokens}
            </Text>
          )}
          <Text color={colors.on_surface_variant}>
            {hardware.preferredCompute === 'cpu-only' ? '> ' : ' '}CPU Only
          </Text>
          <Text color={colors.on_surface_variant}>
            {hardware.preferredCompute === 'gpu-auto' ? '> ' : ' '}GPU Auto
          </Text>
          <Text color={colors.on_surface_variant}>
            {hardware.preferredCompute === 'gpu-nvidia' ? '> ' : ' '}GPU NVIDIA
          </Text>
          <Text color={colors.on_surface_variant}>
            {hardware.preferredCompute === 'gpu-amd' ? '> ' : ' '}GPU AMD
          </Text>
          <Text color={colors.on_surface_variant}>
            {hardware.preferredCompute === 'gpu-intel' ? '> ' : ' '}GPU Intel
          </Text>
          {hardware.gpuLayersOverride !== undefined && (
            <Text color={colors.outline_variant}>
              {' '}
              [Enter: cycle GPU layers]
            </Text>
          )}
          {hardware.contextTokens !== undefined && (
            <Text color={colors.outline_variant}>
              {' '}
              [Enter: cycle context tokens]
            </Text>
          )}
        </Box>
      </Box>

      <Box flexDirection="column" paddingBottom={spacing.lg}>
        <Text
          color={
            activeSection === 'model'
              ? colors.primary
              : colors.on_surface_variant
          }
          bold={activeSection === 'model'}
        >
          Model {activeSection === 'model' ? '<' : ''}
        </Text>
        <Box paddingLeft={spacing.lg}>
          <Text
            color={editingModel ? colors.on_surface : colors.on_surface_variant}
          >
            {editingModel ? modelDraft + '_' : (model ?? '(not set)')}
          </Text>
          {!editingModel && activeSection === 'model' && (
            <Text color={colors.outline_variant}> [Enter: edit]</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
