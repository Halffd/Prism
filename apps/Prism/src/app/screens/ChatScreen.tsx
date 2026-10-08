/* eslint-disable no-restricted-globals */
/// <reference lib="dom" />
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import { UnifiedAIClient } from '@prism/api-client';
import type { Message, AIConfig } from '@prism/shared-types';
import {
  colors,
  typography,
  spacing,
  elevation,
  borderRadius,
} from '../theme/nocturnal-editorial';

export const storage = {
  getItem: async (key: string): Promise<string | null> => {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
    try {
      const AsyncStorage =
        await import('@react-native-async-storage/async-storage').then(
          (m) => m.default,
        );
      return await AsyncStorage.getItem(key);
    } catch (error) {
      console.error('Storage get error:', error);
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
      return;
    }
    try {
      const AsyncStorage =
        await import('@react-native-async-storage/async-storage').then(
          (m) => m.default,
        );
      await AsyncStorage.setItem(key, value);
    } catch (error) {
      console.error('Storage set error:', error);
    }
  },
};

const getAIConfig = async (): Promise<AIConfig> => {
  const storedConfig = await storage.getItem('aiConfig');
  if (storedConfig) {
    try {
      return JSON.parse(storedConfig);
    } catch (error) {
      console.error('Failed to parse AI config, using default:', error);
    }
  }
  return {
    provider: 'prism-api',
    apiUrl: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api',
  };
};

const createClient = async (): Promise<UnifiedAIClient> => {
  const aiConfig = await getAIConfig();
  return new UnifiedAIClient({
    aiConfig: aiConfig,
    prismApiUrl: aiConfig.apiUrl,
  });
};

interface ChatScreenProps {
  navigateToSettings?: () => void;
}

export function ChatScreen({ navigateToSettings }: ChatScreenProps = {}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      saveHistory(messages);
    }
    if (flatListRef.current) {
      flatListRef.current.scrollToEnd();
    }
  }, [messages]);

  const copyMessageToClipboard = async (content: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(content);
      } else {
        const Clipboard = await import('expo-clipboard').then(
          (m) => m.default || m,
        );
        await Clipboard.setStringAsync(content);
      }
    } catch (err) {
      console.error('Failed to copy message:', err);
    }
  };

  const resendMessage = async (message: Message) => {
    if (message.role === 'user') {
      setInput(message.content);
    } else if (message.role === 'assistant') {
      const userMessageIndex = messages.findIndex(
        (msg, idx) => idx < messages.indexOf(message) && msg.role === 'user',
      );
      if (userMessageIndex !== -1) {
        setInput(messages[userMessageIndex].content);
      }
    }
  };

  const getRelativeTime = (timestamp: number): string => {
    const now = Date.now();
    const diffInSeconds = Math.floor((now - timestamp) / 1000);
    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400)
      return `${Math.floor(diffInSeconds / 3600)}h ago`;
    return `${Math.floor(diffInSeconds / 86400)}d ago`;
  };

  const getTimeSinceLastMessage = (currentIndex: number): string | null => {
    if (currentIndex === 0) return null;
    const diffInSeconds = Math.floor(
      (messages[currentIndex].timestamp -
        messages[currentIndex - 1].timestamp) /
        1000,
    );
    if (diffInSeconds < 60) return `${diffInSeconds}s after`;
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m after`;
    if (diffInSeconds < 86400)
      return `${Math.floor(diffInSeconds / 3600)}h after`;
    return `${Math.floor(diffInSeconds / 86400)}d after`;
  };

  const loadHistory = async () => {
    try {
      const savedMessages = await storage.getItem('chatHistory');
      if (savedMessages) setMessages(JSON.parse(savedMessages));
    } catch (error) {
      console.error('Failed to load chat history:', error);
    }
  };

  const saveHistory = async (msgs: Message[]) => {
    try {
      await storage.setItem('chatHistory', JSON.stringify(msgs));
    } catch (error) {
      console.error('Failed to save chat history:', error);
    }
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    try {
      const client = await createClient();
      const response = await client.sendMessage(input);
      if (response.success && response.data) {
        setMessages((prev) => [...prev, response.data!]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content:
              response.error ||
              'Failed to get response. Please try again later.',
            timestamp: Date.now(),
          },
        ]);
      }
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content:
            error.message || 'Network error. Please check your connection.',
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const currentMsgDate = new Date(item.timestamp);
    const previousMsgDate =
      index > 0 ? new Date(messages[index - 1].timestamp) : null;
    const showDateSeparator =
      !previousMsgDate ||
      currentMsgDate.toDateString() !== previousMsgDate.toDateString();
    const timeString = currentMsgDate.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const relativeTime = getRelativeTime(item.timestamp);
    const isUser = item.role === 'user';

    return (
      <React.Fragment>
        {showDateSeparator && (
          <View style={styles.dateSeparator}>
            <Text style={styles.dateSeparatorText}>
              {currentMsgDate
                .toLocaleDateString([], {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })
                .toUpperCase()}
            </Text>
          </View>
        )}
        <View
          style={[
            styles.messageContainer,
            isUser ? styles.userMessage : styles.assistantMessage,
          ]}
        >
          <View style={styles.messageHeader}>
            <View style={styles.timestampContainer}>
              <Text
                style={[
                  styles.timestamp,
                  isUser ? styles.userTimestamp : styles.assistantTimestamp,
                ]}
              >
                {timeString}
              </Text>
              <Text style={styles.relativeTime}>{relativeTime}</Text>
            </View>
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => copyMessageToClipboard(item.content)}
              >
                <Text style={styles.iconButtonText}>Copy</Text>
              </TouchableOpacity>
              {item.role === 'assistant' && (
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() => resendMessage(item)}
                >
                  <Text style={styles.iconButtonText}>Retry</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          {index > 0 && getTimeSinceLastMessage(index) && (
            <Text style={styles.timeSincePrevious}>
              {getTimeSinceLastMessage(index)}
            </Text>
          )}
          <View style={styles.messageBody}>
            <Markdown
              style={{
                body: {
                  color: isUser ? colors.on_primary : colors.on_surface,
                  fontSize: typography.body_lg.fontSize,
                  lineHeight: typography.body_lg.lineHeight,
                },
                heading1: {
                  color: isUser ? colors.on_primary : colors.on_surface,
                  fontSize: typography.headline_lg.fontSize,
                  fontWeight: '700' as const,
                },
                heading2: {
                  color: isUser ? colors.on_primary : colors.on_surface,
                  fontSize: typography.headline_md.fontSize,
                  fontWeight: '700' as const,
                },
                heading3: {
                  color: isUser ? colors.on_primary : colors.on_surface,
                  fontSize: typography.title_lg.fontSize,
                  fontWeight: '600' as const,
                },
                code_block: {
                  backgroundColor: colors.surface_container_lowest,
                  padding: spacing.md,
                  borderRadius: borderRadius.md,
                  color: colors.on_surface_variant,
                },
                code_inline: {
                  backgroundColor: colors.surface_container,
                  padding: 2,
                  borderRadius: borderRadius.sm,
                  color: colors.tertiary,
                },
                table: { borderWidth: 0 },
                th: {
                  backgroundColor: colors.surface_container,
                  padding: spacing.sm,
                  fontWeight: '600' as const,
                  color: colors.on_surface,
                },
                td: { padding: spacing.sm, color: colors.on_surface_variant },
              }}
              onLinkPress={(url) => {
                console.log('Link pressed:', url);
                return false;
              }}
            >
              {item.content}
            </Markdown>
            {!isUser && item.metrics && (
              <View style={styles.metricsRow}>
                {item.metrics.model && (
                  <Text style={styles.metricsText}>{item.metrics.model}</Text>
                )}
                {item.metrics.tokensPerSecond ? (
                  <Text style={styles.metricsText}>
                    {item.metrics.tokensPerSecond.toFixed(1)} tok/s
                  </Text>
                ) : null}
                {item.metrics.latencyMs ? (
                  <Text style={styles.metricsText}>
                    {(item.metrics.latencyMs / 1000).toFixed(2)}s
                  </Text>
                ) : null}
                {item.metrics.totalTokens ? (
                  <Text style={styles.metricsText}>
                    {item.metrics.totalTokens} tok
                  </Text>
                ) : null}
                {item.metrics.contextSize ? (
                  <Text style={styles.metricsText}>
                    ctx {item.metrics.contextSize}
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        </View>
      </React.Fragment>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Prism</Text>
        {navigateToSettings && (
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={navigateToSettings}
          >
            <Text style={styles.settingsButtonText}>Settings</Text>
          </TouchableOpacity>
        )}
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardContainer}
        keyboardVerticalOffset={90}
      >
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Prism</Text>
            <Text style={styles.emptySubtitle}>Ask anything to begin</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item, index) => `${item.id}-${index}`}
            renderItem={renderMessage}
            contentContainerStyle={styles.messagesList}
          />
        )}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask anything..."
            placeholderTextColor={colors.on_surface_variant}
            editable={!loading}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              (loading || !input.trim()) && styles.disabledButton,
            ]}
            onPress={sendMessage}
            disabled={loading || !input.trim()}
            activeOpacity={0.7}
          >
            <Text style={styles.sendButtonText}>
              {loading ? '...' : 'Send'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  keyboardContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    backgroundColor: colors.surface_container_low,
  },
  headerTitle: {
    ...typography.headline_md,
    color: colors.primary,
    letterSpacing: -0.5,
  },
  settingsButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  settingsButtonText: {
    ...typography.label_sm,
    color: colors.on_surface_variant,
    letterSpacing: 0.1,
    textTransform: 'uppercase',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.xxl,
  },
  emptyTitle: {
    ...typography.display_lg,
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    ...typography.body_lg,
    color: colors.on_surface_variant,
  },
  messagesList: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  dateSeparator: {
    alignItems: 'center',
    marginVertical: spacing.xl,
  },
  dateSeparatorText: {
    ...typography.label_sm,
    color: colors.on_surface_variant,
    backgroundColor: colors.surface_container_low,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.pill,
    letterSpacing: 0.1,
    textTransform: 'uppercase',
  },
  messageContainer: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginVertical: spacing.sm,
    maxWidth: '85%',
  },
  userMessage: {
    backgroundColor: colors.primary_container,
    alignSelf: 'flex-end',
  },
  assistantMessage: {
    backgroundColor: colors.surface_container_high,
    alignSelf: 'flex-start',
  },
  messageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  timestampContainer: {
    flexDirection: 'column',
  },
  timestamp: {
    ...typography.label_sm,
    letterSpacing: 0.1,
    textTransform: 'uppercase',
  },
  userTimestamp: {
    color: colors.on_surface_variant,
  },
  assistantTimestamp: {
    color: colors.on_surface_variant,
  },
  relativeTime: {
    ...typography.body_sm,
    color: colors.on_surface_variant,
    fontStyle: 'italic',
    marginTop: 1,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.pill,
    backgroundColor: colors.surface_container_low,
  },
  iconButtonText: {
    ...typography.label_sm,
    color: colors.on_surface_variant,
    textTransform: 'uppercase',
    letterSpacing: 0.1,
  },
  timeSincePrevious: {
    ...typography.body_sm,
    color: colors.on_surface_variant,
    fontStyle: 'italic',
    marginBottom: spacing.sm,
    paddingLeft: spacing.lg,
  },
  messageBody: {},
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.outline_variant ?? 'rgba(255,255,255,0.08)',
  },
  metricsText: {
    fontSize: 10,
    color: colors.on_surface_variant,
    opacity: 0.85,
    fontVariant: ['tabular-nums' as const],
  },
  inputBar: {
    flexDirection: 'row',
    padding: spacing.lg,
    backgroundColor: colors.surface_container_low,
    alignItems: 'center',
    gap: spacing.md,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface_container_lowest,
    borderRadius: borderRadius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    color: colors.on_surface,
    fontSize: typography.body_lg.fontSize,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sendButton: {
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  disabledButton: {
    opacity: 0.4,
  },
  sendButtonText: {
    color: colors.on_primary,
    fontWeight: '600',
    fontSize: typography.label_lg.fontSize,
    letterSpacing: 0.5,
  },
});
