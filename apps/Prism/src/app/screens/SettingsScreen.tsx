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
  Picker,
} from 'react-native';
import { storage } from './ChatScreen';
import type { AIConfig, AIProvider } from '@prism/shared-types';

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
    darkMode: false,
    autoSave: true,
  });

  const [aiConfig, setAiConfig] = useState<AIConfig>({
    provider: 'prism-api',
    apiUrl: 'http://localhost:3000/api',
    model: 'gpt-3.5-turbo', // Default model for OpenAI
  });

  const [tempApiUrl, setTempApiUrl] = useState('');
  const [tempApiKey, setTempApiKey] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      // Load AI configuration from storage
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

      // Load other settings
      const darkModeStr = await storage.getItem('darkMode');
      if (darkModeStr) {
        setSettings(prev => ({ ...prev, darkMode: darkModeStr === 'true' }));
      }

      const autoSaveStr = await storage.getItem('autoSave');
      if (autoSaveStr) {
        setSettings(prev => ({ ...prev, autoSave: autoSaveStr === 'true' }));
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const saveSettings = async () => {
    try {
      // Update AI config with current values
      const updatedConfig: AIConfig = {
        ...aiConfig,
        apiUrl: tempApiUrl || aiConfig.apiUrl,
        apiKey: tempApiKey || aiConfig.apiKey,
      };

      await storage.setItem('aiConfig', JSON.stringify(updatedConfig));
      await storage.setItem('darkMode', settings.darkMode.toString());
      await storage.setItem('autoSave', settings.autoSave.toString());

      setAiConfig(updatedConfig);

      // Show success message
      Alert.alert('Success', 'Settings saved successfully! Note: You may need to restart the app for API URL changes to take effect.');
    } catch (error) {
      console.error('Failed to save settings:', error);
      Alert.alert('Error', 'Failed to save settings. Please try again.');
    }
  };

  const updateAiProvider = (provider: AIProvider) => {
    setAiConfig(prev => ({ ...prev, provider }));
  };

  const updateSetting = (key: keyof Settings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>

        <View style={styles.settingItem}>
          <Text style={styles.label}>AI Provider</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={aiConfig.provider}
              onValueChange={(value) => updateAiProvider(value as AIProvider)}
              style={styles.picker}
            >
              <Picker.Item label="Prism API" value="prism-api" />
              <Picker.Item label="OpenAI (ChatGPT)" value="openai" />
              <Picker.Item label="Google Gemini" value="gemini" />
              <Picker.Item label="Alibaba Qwen" value="qwen" />
            </Picker>
          </View>
        </View>

        {aiConfig.provider !== 'prism-api' && (
          <>
            <View style={styles.settingItem}>
              <Text style={styles.label}>API Key</Text>
              <TextInput
                style={styles.textInput}
                value={tempApiKey}
                onChangeText={setTempApiKey}
                placeholder={`Enter ${aiConfig.provider} API key`}
                secureTextEntry
              />
            </View>

            <View style={styles.settingItem}>
              <Text style={styles.label}>Model</Text>
              <TextInput
                style={styles.textInput}
                value={aiConfig.model || ''}
                onChangeText={(value) => setAiConfig(prev => ({ ...prev, model: value }))}
                placeholder="e.g., gpt-3.5-turbo, gemini-pro, qwen-max"
              />
            </View>
          </>
        )}

        {aiConfig.provider === 'prism-api' && (
          <View style={styles.settingItem}>
            <Text style={styles.label}>Prism API URL</Text>
            <TextInput
              style={styles.textInput}
              value={tempApiUrl}
              onChangeText={setTempApiUrl}
              placeholder="Enter Prism API URL"
            />
          </View>
        )}

        <View style={styles.settingItem}>
          <View style={styles.row}>
            <Text style={styles.label}>Dark Mode</Text>
            <Switch
              value={settings.darkMode}
              onValueChange={(value) => updateSetting('darkMode', value)}
            />
          </View>
        </View>

        <View style={styles.settingItem}>
          <View style={styles.row}>
            <Text style={styles.label}>Auto-save Chat History</Text>
            <Switch
              value={settings.autoSave}
              onValueChange={(value) => updateSetting('autoSave', value)}
            />
          </View>
        </View>

        <TouchableOpacity style={styles.saveButton} onPress={saveSettings}>
          <Text style={styles.saveButtonText}>Save Settings</Text>
        </TouchableOpacity>

        {navigateToChat && (
          <TouchableOpacity
            style={[styles.saveButton, styles.cancelButton]}
            onPress={navigateToChat}
          >
            <Text style={styles.saveButtonText}>Back to Chat</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  settingItem: {
    backgroundColor: 'white',
    padding: 15,
    marginBottom: 15,
    borderRadius: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 5,
    padding: 10,
    fontSize: 16,
    marginBottom: 10,
  },
  urlContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  urlValue: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  updateButton: {
    backgroundColor: '#007bff',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 5,
    marginLeft: 10,
  },
  updateButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  saveButton: {
    backgroundColor: '#28a745',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  cancelButton: {
    backgroundColor: '#6c757d',
    marginTop: 10,
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 5,
    backgroundColor: 'white',
    marginTop: 8,
  },
  picker: {
    height: 50,
  },
});