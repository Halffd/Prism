import { Message, ChatSession } from '@prism/shared-types';
import { PromptShortcut } from './db';
import { supabaseDbService } from '@prism/supabase-client';

// This is a compatibility layer to gradually migrate from MongoDB to Supabase
export interface IDbService {
  saveChatHistory(sessionId: string, messages: Message[]): Promise<void>;
  loadChatHistory(sessionId: string): Promise<Message[]>;
  getChatSessions(): Promise<ChatSession[]>;
  deleteChatSession(sessionId: string): Promise<void>;
  savePromptShortcut(prompt: PromptShortcut): Promise<void>;
  getPromptShortcuts(category?: string): Promise<PromptShortcut[]>;
  deletePromptShortcut(promptId: string): Promise<void>;
  setCache(key: string, value: any, ttl?: number): Promise<void>;
  getCache<T>(key: string): Promise<T | null>;
}

export class SupabaseDbAdapter implements IDbService {
  async saveChatHistory(sessionId: string, messages: Message[]): Promise<void> {
    // Create or update session
    await supabaseDbService.createSession({
      id: sessionId,
      title: messages[0]?.content?.substring(0, 100) || `Chat ${Date.now()}`,
      user_id: 'temporary_user_id' // Will be replaced with actual user ID when auth is fully implemented
    });

    // Delete existing messages for this session and add new ones
    await supabaseDbService.deleteMessage(sessionId); // This won't work directly - need to delete by session_id
    
    // Actually, let's use bulk create
    const newMessages = messages.map(msg => ({
      session_id: sessionId,
      role: msg.role,
      content: msg.content,
      context: msg.context ? msg.context as any : null, // Convert ContextData to Json-compatible format
      tokens: msg.tokens,
      timestamp: new Date(msg.timestamp).toISOString()
    }));

    await supabaseDbService.createMessages(newMessages);
  }

  async loadChatHistory(sessionId: string): Promise<Message[]> {
    const result = await supabaseDbService.getMessagesBySessionId(sessionId);
    if (!result.success) {
      console.error('Failed to load chat history:', result.error);
      return [];
    }
    
    return (result.data?.data || []).map(dbMsg => ({
      id: dbMsg.id,
      role: dbMsg.role as 'user' | 'assistant' | 'system',
      content: dbMsg.content,
      context: dbMsg.context as any, // Type assertion
      timestamp: new Date(dbMsg.timestamp).getTime(),
      tokens: dbMsg.tokens || undefined
    }));
  }

  async getChatSessions(): Promise<ChatSession[]> {
    // For now, we'll return empty array since we need authenticated user ID
    // In a real implementation, we'd get the user from the request context
    return [];
  }

  async deleteChatSession(sessionId: string): Promise<void> {
    await supabaseDbService.deleteSession(sessionId);
  }

  async savePromptShortcut(prompt: PromptShortcut): Promise<void> {
    // For now, we're not implementing user-specific prompts in the adapter
    // This would require the user ID from the auth context
    console.warn('Prompt shortcuts not implemented in Supabase adapter - requires user ID');
  }

  async getPromptShortcuts(category?: string): Promise<PromptShortcut[]> {
    // For now, we're not implementing user-specific prompts in the adapter
    // This would require the user ID from the auth context
    console.warn('Prompt shortcuts not implemented in Supabase adapter - requires user ID');
    return [];
  }

  async deletePromptShortcut(promptId: string): Promise<void> {
    // For now, we're not implementing user-specific prompts in the adapter
    // This would require the user ID from the auth context
    console.warn('Prompt shortcuts not implemented in Supabase adapter - requires user ID');
  }

  async setCache(key: string, value: any, ttl?: number): Promise<void> {
    // Supabase doesn't have a built-in cache like Redis
    // We could implement a simple cache table but for now we'll skip
    console.warn('Caching not implemented in Supabase adapter');
  }

  async getCache<T>(key: string): Promise<T | null> {
    // Supabase doesn't have built-in cache
    return null;
  }
}