import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Switch,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  StatusBar,
} from 'react-native';
import { storage } from './ChatScreen';
import type { AIConfig, AIProvider, AIMode, AICapability } from '@prism/shared-types';
import { colors, typography, spacing, borderRadius } from '../theme/nocturnal-editorial';

const PROVIDERS: { label: string; value: AIProvider }[] = [
  { label: 'Prism API', value: 'prism-api' },
  { label: 'OpenAI (ChatGPT)', value: 'openai' },
  { label: 'Google Gemini', value: 'gemini' },
  { label: 'Alibaba Qwen', value: 'qwen' },
  { label: 'Claude', value: 'claude' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'Mistral', value: 'mistral' },
  { label: 'Cohere', value: 'cohere' },
  { label: 'Together AI', value: 'together' },
  { label: 'Perplexity', value: 'perplexity' },
  { label: 'Groq', value: 'groq' },
  { label: 'Grok', value: 'grok' },
  { label: 'OpenRouter', value: 'openrouter' },
  { label: 'Fireworks', value: 'fireworks' },
  { label: 'Ollama', value: 'ollama' },
  { label: 'KoboldCPP', value: 'koboldcpp' },
  { label: 'Llama.cpp', value: 'llamacpp' },
  { label: 'SGLang', value: 'sglang' },
];

const ADAPTER_MODES: { label: string; value: AIMode; hint: string }[] = [
  { label: 'Direct API', value: 'api', hint: 'Calls provider APIs directly using your API keys' },
  { label: 'Prism Server', value: 'server', hint: 'Routes all AI requests through your Prism backend server' },
  { label: 'Local Inference', value: 'local', hint: 'Connects to a local inference server (Ollama, llama.cpp, etc.)' },
];

const CAPABILITIES: AICapability[] = ['llm', 'ocr', 'stt', 'tts', 'inpaint', 'model-gen', 'audio-gen', 'video-gen', 'agent'];

interface Settings {
  apiUrl: string;
  darkMode: boolean;
  autoSave: boolean;
}

interface SettingsScreenProps {
  navigateToChat?: () => void;
}

export function SettingsScreen({ navigateToChat }: SettingsScreenProps = {}) {
  const [settings, setSettings] = useState<Settings>({
    apiUrl: 'http://localhost:3000/api',
    darkMode: true,
    autoSave: true,
  });

  const [aiConfig, setAiConfig] = useState<AIConfig>({
    provider: 'prism-api',
    apiUrl: 'http://localhost:3000/api',
    model: 'gpt-3.5-turbo',
  });

  const [tempApiUrl, setTempApiUrl] = useState('');
  const [tempApiKey, setTempApiKey] = useState('');
  const [adapterMode, setAdapterMode] = useState<AIMode>('api');
  const [capabilityModes, setCapabilityModes] = useState<Partial<Record<AICapability, AIMode>>>({});
  const [prismApiUrl, setPrismApiUrl] = useState('http://localhost:3000/api');
  const [prismApiKey, setPrismApiKey] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const storedConfig = await storage.getItem('aiConfig');
      if (storedConfig) {
        try {
          const config = JSON.parse(storedConfig) as AIConfig;
          setAiConfig(config);
          setTempApiUrl(config.apiUrl || '');
          setTempApiKey(config.apiKey || '');
        } catch (error) {
          console.error('Failed to parse AI config, using default:', error);
        }
      }

      const darkModeStr = await storage.getItem('darkMode');
      if (darkModeStr) {
        setSettings(prev => ({ ...prev, darkMode: darkModeStr === 'true' }));
      }

        const autoSaveStr = await storage.getItem('autoSave');
        if (autoSaveStr) {
          setSettings(prev => ({ ...prev, autoSave: autoSaveStr === 'true' }));
        }

        const storedMode = await storage.getItem('adapterMode');
        if (storedMode) {
          setAdapterMode(storedMode as AIMode);
        }

        const storedCapModes = await storage.getItem('capabilityModes');
        if (storedCapModes) {
          try {
            setCapabilityModes(JSON.parse(storedCapModes));
          } catch {}
        }

        const storedPrismUrl = await storage.getItem('prismApiUrl');
        if (storedPrismUrl) {
          setPrismApiUrl(storedPrismUrl);
        }

        const storedPrismKey = await storage.getItem('prismApiKey');
        if (storedPrismKey) {
          setPrismApiKey(storedPrismKey);
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
  };

  const saveSettings = async () => {
    try {
      const updatedConfig: AIConfig = {
        ...aiConfig,
        apiUrl: tempApiUrl || aiConfig.apiUrl,
        apiKey: tempApiKey || aiConfig.apiKey,
        mode: adapterMode,
        capabilityModes,
      };

      await storage.setItem('aiConfig', JSON.stringify(updatedConfig));
      await storage.setItem('darkMode', settings.darkMode.toString());
      await storage.setItem('autoSave', settings.autoSave.toString());
      await storage.setItem('adapterMode', adapterMode);
      await storage.setItem('capabilityModes', JSON.stringify(capabilityModes));
      if (adapterMode === 'server') {
        await storage.setItem('prismApiUrl', prismApiUrl);
        await storage.setItem('prismApiKey', prismApiKey);
      }

      setAiConfig(updatedConfig);
      Alert.alert('Success', 'Settings saved successfully!');
    } catch (error) {
      console.error('Failed to save settings:', error);
      Alert.alert('Error', 'Failed to save settings. Please try again.');
    }
  };

  const updateAiProvider = (provider: AIProvider) => {
    setAiConfig(prev => ({ ...prev, provider }));
  };

  const updateSetting = (key: keyof Settings, value: boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        {navigateToChat && (
          <TouchableOpacity style={styles.backButton} onPress={navigateToChat}>
            <Text style={styles.backButtonText}>Chat</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>Settings</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionHeader}>{'AI PROVIDER'}</Text>
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.label}>Provider</Text>
            <View style={styles.chipRow}>
              {PROVIDERS.map((p) => (
                <TouchableOpacity
                  key={p.value}
                  style={[styles.chip, aiConfig.provider === p.value && styles.chipSelected]}
                  onPress={() => updateAiProvider(p.value)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, aiConfig.provider === p.value && styles.chipTextSelected]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {aiConfig.provider !== 'prism-api' && (
            <>
              <View style={styles.card}>
                <Text style={styles.label}>API Key</Text>
                <TextInput
                  style={styles.textInput}
                  value={tempApiKey}
                  onChangeText={setTempApiKey}
                  placeholder={`Enter ${aiConfig.provider} API key`}
                  placeholderTextColor={colors.on_surface_variant}
                  secureTextEntry
                />
              </View>
              <View style={styles.card}>
                <Text style={styles.label}>Model</Text>
                <TextInput
                  style={styles.textInput}
                  value={aiConfig.model || ''}
                  onChangeText={(value) => setAiConfig(prev => ({ ...prev, model: value }))}
                  placeholder="e.g., gpt-3.5-turbo, gemini-pro, qwen-max"
                  placeholderTextColor={colors.on_surface_variant}
                />
              </View>
            </>
          )}

          {aiConfig.provider === 'prism-api' && (
            <View style={styles.card}>
              <Text style={styles.label}>API URL</Text>
              <TextInput
                style={styles.textInput}
                value={tempApiUrl}
                onChangeText={setTempApiUrl}
                placeholder="Enter Prism API URL"
                placeholderTextColor={colors.on_surface_variant}
              />
            </View>
          )}
        </View>

        <Text style={styles.sectionHeader}>{'ADAPTER MODE'}</Text>
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.label}>Routing Mode</Text>
            <View style={styles.chipRow}>
              {ADAPTER_MODES.map((m) => (
                <TouchableOpacity
                  key={m.value}
                  style={[styles.chip, adapterMode === m.value && styles.chipSelected]}
                  onPress={() => setAdapterMode(m.value)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, adapterMode === m.value && styles.chipTextSelected]}>
                    {m.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.hint}>
              {ADAPTER_MODES.find(m => m.value === adapterMode)?.hint}
            </Text>
          </View>

          {adapterMode === 'server' && (
            <>
              <View style={styles.card}>
                <Text style={styles.label}>Prism Server URL</Text>
                <TextInput
                  style={styles.textInput}
                  value={prismApiUrl}
                  onChangeText={setPrismApiUrl}
                  placeholder="http://localhost:3000/api"
                  placeholderTextColor={colors.on_surface_variant}
                />
              </View>
              <View style={styles.card}>
                <Text style={styles.label}>Prism Server API Key</Text>
                <TextInput
                  style={styles.textInput}
                  value={prismApiKey}
                  onChangeText={setPrismApiKey}
                  placeholder="Enter your Prism server API key"
                  placeholderTextColor={colors.on_surface_variant}
                  secureTextEntry
                />
              </View>
            </>
          )}

          {adapterMode === 'local' && (
            <View style={styles.card}>
              <Text style={styles.label}>Local Inference URL</Text>
              <TextInput
                style={styles.textInput}
                value={aiConfig.localApiUrl || ''}
                onChangeText={(v) => setAiConfig(prev => ({ ...prev, localApiUrl: v }))}
                placeholder="http://localhost:11434"
                placeholderTextColor={colors.on_surface_variant}
              />
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.label}>Per-Capability Overrides</Text>
            <Text style={styles.hint}>Override global mode for specific AI capabilities</Text>
            {CAPABILITIES.map(cap => (
              <View key={cap} style={styles.capabilityRow}>
                <Text style={styles.capabilityLabel}>{cap.toUpperCase()}</Text>
                <View style={styles.chipRow}>
                  {ADAPTER_MODES.filter(m => m.value !== 'local' || cap === 'llm').map((m) => (
                    <TouchableOpacity
                      key={m.value}
                      style={[styles.chip, (capabilityModes[cap] || adapterMode) === m.value && styles.chipSelected]}
                      onPress={() => setCapabilityModes(prev => ({ ...prev, [cap]: m.value }))}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.chipText, (capabilityModes[cap] || adapterMode) === m.value && styles.chipTextSelected]}>
                        {m.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
          </View>
        </View>

        <Text style={styles.sectionHeader}>{'PREFERENCES'}</Text>
        <View style={styles.section}>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>Dark Mode</Text>
              <Switch
                value={settings.darkMode}
                onValueChange={(value) => updateSetting('darkMode', value)}
                trackColor={{ false: colors.surface_container, true: colors.primary }}
                thumbColor={colors.on_primary}
              />
            </View>
          </View>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.label}>Auto-save Chat History</Text>
              <Switch
                value={settings.autoSave}
                onValueChange={(value) => updateSetting('autoSave', value)}
                trackColor={{ false: colors.surface_container, true: colors.primary }}
                thumbColor={colors.on_primary}
              />
            </View>
          </View>
        </View>

        <TouchableOpacity style={styles.saveButton} onPress={saveSettings} activeOpacity={0.7}>
          <Text style={styles.saveButtonText}>Save Settings</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    backgroundColor: colors.surface_container_low,
    gap: spacing.md,
  },
  backButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  backButtonText: {
    ...typography.label_sm,
    color: colors.on_tertiary_container,
    letterSpacing: 0.1,
    textTransform: 'uppercase',
  },
  headerTitle: {
    ...typography.headline_md,
    color: colors.primary,
    letterSpacing: -0.5,
  },
  content: {
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  sectionHeader: {
    ...typography.label_sm,
    color: colors.on_surface_variant,
    letterSpacing: 0.1,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    marginLeft: spacing.xs,
  },
  section: {
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface_container_high,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
  },
  label: {
    ...typography.label_md,
    color: colors.on_surface_variant,
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  textInput: {
    backgroundColor: colors.surface_container_lowest,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    fontSize: typography.body_lg.fontSize,
    color: colors.on_surface,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    backgroundColor: colors.surface_container,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.pill,
  },
  chipSelected: {
    backgroundColor: colors.primary_fixed_dim,
  },
  chipText: {
    ...typography.label_sm,
    color: colors.on_surface_variant,
  },
  chipTextSelected: {
    color: colors.on_primary_fixed,
  },
  saveButton: {
    backgroundColor: colors.primary,
    padding: spacing.xl,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    marginTop: spacing.xxl,
  },
  saveButtonText: {
    color: colors.on_primary,
    fontSize: typography.label_lg.fontSize,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  hint: {
    ...typography.body_sm,
    color: colors.on_surface_variant,
    marginTop: spacing.xs,
  },
  capabilityRow: {
    marginBottom: spacing.md,
  },
  capabilityLabel: {
    ...typography.label_sm,
    color: colors.on_surface_variant,
    marginBottom: spacing.xs,
    letterSpacing: 0.1,
  },
});
