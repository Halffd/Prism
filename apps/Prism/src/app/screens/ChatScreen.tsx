
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
} from 'react-native';
import { UnifiedAIClient } from '@prism/api-client';
import type { Message, AIConfig } from '@prism/shared-types';

// Web-compatible storage solution
export const storage = {
  getItem: async (key: string): Promise<string | null> => {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
    try {
      // Fallback to AsyncStorage for native platforms
      const AsyncStorage = await import('@react-native-async-storage/async-storage').then(m => m.default);
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
      // Fallback to AsyncStorage for native platforms
      const AsyncStorage = await import('@react-native-async-storage/async-storage').then(m => m.default);
      await AsyncStorage.setItem(key, value);
    } catch (error) {
      console.error('Storage set error:', error);
    }
  }
};

// Get current AI configuration from storage
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
    apiUrl: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api'
  };
};

// Create client with the stored AI configuration
const createClient = async (): Promise<UnifiedAIClient> => {
  const aiConfig = await getAIConfig();
  return new UnifiedAIClient({
    aiConfig: aiConfig,
    prismApiUrl: aiConfig.apiUrl
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
      // Try to use Clipboard API if available, otherwise use React Native Clipboard
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(content);
      } else {
        const Clipboard = await import('expo-clipboard').then(m => m.default || m);
        await Clipboard.setStringAsync(content);
      }
    } catch (err) {
      console.error('Failed to copy message:', err);
    }
  };

  const resendMessage = async (message: Message) => {
    if (message.role === 'user') {
      // Resend the user's message by putting it in the input field
      setInput(message.content);
    } else if (message.role === 'assistant') {
      // Find the corresponding user message and resend it
      const userMessageIndex = messages.findIndex(
        (msg, idx) => idx < messages.indexOf(message) && msg.role === 'user'
      );
      if (userMessageIndex !== -1) {
        setInput(messages[userMessageIndex].content);
      }
    }
  };

  const getRelativeTime = (timestamp: number): string => {
    const now = Date.now();
    const diffInSeconds = Math.floor((now - timestamp) / 1000);

    if (diffInSeconds < 60) {
      return 'just now';
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes}m ago`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours}h ago`;
    } else {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days}d ago`;
    }
  };

  const getTimeSinceLastMessage = (currentIndex: number): string | null => {
    if (currentIndex === 0) return null; // First message has no previous message

    const currentTimestamp = messages[currentIndex].timestamp;
    const previousTimestamp = messages[currentIndex - 1].timestamp;

    const diffInSeconds = Math.floor((currentTimestamp - previousTimestamp) / 1000);

    if (diffInSeconds < 60) {
      return `${diffInSeconds}s after`;
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes}m after`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours}h after`;
    } else {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days}d after`;
    }
  };

  const loadHistory = async () => {
    try {
      const savedMessages = await storage.getItem('chatHistory');
      if (savedMessages) {
        setMessages(JSON.parse(savedMessages));
      }
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
      const client = await createClient(); // Create client with current AI settings
      const response = await client.sendMessage(input);
      if (response.success && response.data) {
        setMessages((prev) => [...prev, response.data!]);
      } else {
        // If API call fails, add an error message to the chat
        const errorMessage: Message = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: response.error || 'Failed to get response. Please try again later.',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      }
    } catch (error: any) {
      console.error('Error sending message:', error);
      // Add an error message to the chat in case of network errors
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: error.message || 'Network error. Please check your connection.',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Prism Chat</Text>
        {navigateToSettings && (
          <TouchableOpacity style={styles.settingsButton} onPress={navigateToSettings}>
            <Text style={styles.settingsButtonText}>⚙️</Text>
          </TouchableOpacity>
        )}
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item, index) => `${item.id}-${index}`}
          renderItem={({ item, index }) => {
            const currentMsgDate = new Date(item.timestamp);
            const previousMsgDate = index > 0 ? new Date(messages[index - 1].timestamp) : null;
            const showDateSeparator = !previousMsgDate ||
              currentMsgDate.toDateString() !== previousMsgDate.toDateString();

            const timeString = currentMsgDate.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            });

            const relativeTime = getRelativeTime(item.timestamp);

            return (
              <React.Fragment>
                {showDateSeparator && (
                  <View style={styles.dateSeparator}>
                    <Text style={styles.dateSeparatorText}>
                      {currentMsgDate.toLocaleDateString([], {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </Text>
                  </View>
                )}
                <View
                  style={[
                    styles.messageContainer,
                    item.role === 'user' ? styles.userMessage : styles.assistantMessage,
                  ]}
                >
                  <View style={styles.messageHeader}>
                    <View style={styles.timestampContainer}>
                      <Text style={item.role === 'user' ? styles.userTimestamp : styles.assistantTimestamp}>
                        {timeString}
                      </Text>
                      <Text style={styles.relativeTime}>
                        {relativeTime}
                      </Text>
                    </View>
                    <View style={styles.buttonContainer}>
                      <TouchableOpacity
                        style={styles.copyButton}
                        onPress={() => copyMessageToClipboard(item.content)}
                      >
                        <Text style={styles.copyButtonText}>📋</Text>
                      </TouchableOpacity>
                      {item.role === 'assistant' && (
                        <TouchableOpacity
                          style={styles.resendButton}
                          onPress={() => resendMessage(item)}
                        >
                          <Text style={styles.resendButtonText}>↪️</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                  {index > 0 && (
                    <Text style={styles.timeSincePrevious}>
                      {getTimeSinceLastMessage(index)}
                    </Text>
                  )}
                  <Text style={item.role === 'user' ? styles.userText : styles.assistantText}>
                    {item.content}
                  </Text>
                </View>
              </React.Fragment>
            );
          }}
          contentContainerStyle={styles.messagesList}
        />
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask anything..."
            editable={!loading}
          />
          <TouchableOpacity
            style={[styles.sendButton, (loading || !input.trim()) && styles.disabledButton]}
            onPress={sendMessage}
            disabled={loading || !input.trim()}
          >
            <Text style={styles.sendButtonText}>{loading ? '...' : 'Send'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
    backgroundColor: '#007bff',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  settingsButton: {
    padding: 5,
  },
  settingsButtonText: {
    fontSize: 20,
  },
  messagesList: {
    padding: 10,
  },
  messageContainer: {
    borderRadius: 10,
    padding: 10,
    marginVertical: 5,
    maxWidth: '80%',
  },
  userMessage: {
    backgroundColor: '#007bff',
    alignSelf: 'flex-end',
  },
  assistantMessage: {
    backgroundColor: '#e0e0e0',
    alignSelf: 'flex-start',
  },
  messageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  timestampContainer: {
    flexDirection: 'column',
  },
  buttonContainer: {
    flexDirection: 'row',
  },
  userTimestamp: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: 2,
  },
  assistantTimestamp: {
    fontSize: 12,
    color: 'rgba(0, 0, 0, 0.6)',
    marginBottom: 2,
  },
  relativeTime: {
    fontSize: 10,
    fontStyle: 'italic',
    color: 'rgba(0, 0, 0, 0.6)',
  },
  copyButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  copyButtonText: {
    fontSize: 14,
  },
  resendButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  resendButtonText: {
    fontSize: 14,
  },
  timeSincePrevious: {
    fontSize: 10,
    fontStyle: 'italic',
    color: 'rgba(0, 0, 0, 0.5)',
    marginBottom: 5,
    paddingLeft: 15,
    borderLeftWidth: 1,
    borderLeftColor: '#ccc',
  },
  dateSeparator: {
    alignItems: 'center',
    marginVertical: 10,
  },
  dateSeparatorText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: 'rgba(0, 0, 0, 0.6)',
    backgroundColor: '#e0e0e0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  userText: {
    color: 'white',
  },
  assistantText: {
    color: 'black',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 10,
    borderTopWidth: 1,
    borderColor: '#ccc',
    backgroundColor: 'white',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginRight: 10,
  },
  sendButton: {
    backgroundColor: '#007bff',
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
});
