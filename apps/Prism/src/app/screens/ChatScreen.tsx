
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
import { PrismClient } from '@prism/api-client';
import type { Message } from '@prism/shared-types';
import AsyncStorage from '@react-native-async-storage/async-storage';

const client = new PrismClient(process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api');

export function ChatScreen() {
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

  const loadHistory = async () => {
    try {
      const savedMessages = await AsyncStorage.getItem('chatHistory');
      if (savedMessages) {
        setMessages(JSON.parse(savedMessages));
      }
    } catch (error) {
      console.error('Failed to load chat history:', error);
    }
  };

  const saveHistory = async (msgs: Message[]) => {
    try {
      await AsyncStorage.setItem('chatHistory', JSON.stringify(msgs));
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
      const response = await client.sendMessage(input);
      if (response.success && response.data) {
        setMessages((prev) => [...prev, response.data!]);
      }
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View
              style={[
                styles.messageContainer,
                item.role === 'user' ? styles.userMessage : styles.assistantMessage,
              ]}
            >
              <Text style={item.role === 'user' ? styles.userText : styles.assistantText}>
                {item.content}
              </Text>
            </View>
          )}
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
