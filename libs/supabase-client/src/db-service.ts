import { supabaseClient } from './config';
import {
  User,
  Session,
  Message,
  PromptShortcut,
  NewUser,
  NewSession,
  NewMessage,
  NewPromptShortcut,
  UpdateUser,
  UpdateSession,
  UpdateMessage,
  UpdatePromptShortcut
} from './database.types';

// Define response interfaces
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  count: number;
  error?: string;
}

export interface ChatHistory {
  id: string;
  userId: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

class SupabaseDbService {
  // User operations
  async getUserById(id: string): Promise<ApiResponse<User>> {
    try {
      const { data, error } = await supabaseClient
        .from('users')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        throw error;
      }

      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getUserByEmail(email: string): Promise<ApiResponse<User>> {
    try {
      const { data, error } = await supabaseClient
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

      if (error) {
        throw error;
      }

      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async createUser(userData: NewUser): Promise<ApiResponse<User>> {
    try {
      const { data, error } = await supabaseClient
        .from('users')
        .insert([userData])
        .select()
        .single();

      if (error) {
        throw error;
      }

      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async updateUser(id: string, updates: UpdateUser): Promise<ApiResponse<User>> {
    try {
      const { data, error } = await supabaseClient
        .from('users')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // Session operations
  async getSessionById(id: string): Promise<ApiResponse<Session>> {
    try {
      const { data, error } = await supabaseClient
        .from('sessions')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        throw error;
      }

      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getSessionsByUserId(userId: string, limit = 50): Promise<ApiResponse<Session[]>> {
    try {
      const { data, error } = await supabaseClient
        .from('sessions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        throw error;
      }

      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async createSession(sessionData: NewSession): Promise<ApiResponse<Session>> {
    try {
      const { data, error } = await supabaseClient
        .from('sessions')
        .insert([sessionData])
        .select()
        .single();

      if (error) {
        throw error;
      }

      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async updateSession(id: string, updates: UpdateSession): Promise<ApiResponse<Session>> {
    try {
      const { data, error } = await supabaseClient
        .from('sessions')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async deleteSession(id: string): Promise<ApiResponse<boolean>> {
    try {
      const { error } = await supabaseClient
        .from('sessions')
        .delete()
        .eq('id', id);

      if (error) {
        throw error;
      }

      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // Message operations
  async getMessageById(id: string): Promise<ApiResponse<Message>> {
    try {
      const { data, error } = await supabaseClient
        .from('messages')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        throw error;
      }

      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getMessagesBySessionId(
    sessionId: string,
    limit = 100,
    offset = 0
  ): Promise<ApiResponse<PaginatedResponse<Message>>> {
    try {
      const { data, error, count } = await supabaseClient
        .from('messages')
        .select('*', { count: 'exact' })
        .eq('session_id', sessionId)
        .order('timestamp', { ascending: true })
        .range(offset, offset + limit - 1);

      if (error) {
        throw error;
      }

      return { success: true, data: { data, count: count || 0 } };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async createMessage(messageData: NewMessage): Promise<ApiResponse<Message>> {
    try {
      const { data, error } = await supabaseClient
        .from('messages')
        .insert([messageData])
        .select()
        .single();

      if (error) {
        throw error;
      }

      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async updateMessage(id: string, updates: UpdateMessage): Promise<ApiResponse<Message>> {
    try {
      const { data, error } = await supabaseClient
        .from('messages')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async deleteMessage(id: string): Promise<ApiResponse<boolean>> {
    try {
      const { error } = await supabaseClient
        .from('messages')
        .delete()
        .eq('id', id);

      if (error) {
        throw error;
      }

      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // Bulk operations for messages
  async createMessages(messages: NewMessage[]): Promise<ApiResponse<Message[]>> {
    try {
      const { data, error } = await supabaseClient
        .from('messages')
        .insert(messages)
        .select();

      if (error) {
        throw error;
      }

      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // Prompt shortcuts operations
  async getPromptShortcutsByUserId(
    userId: string,
    category?: string,
    limit = 50
  ): Promise<ApiResponse<PromptShortcut[]>> {
    try {
      let query = supabaseClient
        .from('prompt_shortcuts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (category) {
        query = query.eq('category', category);
      }

      if (limit > 0) {
        query = query.limit(limit);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async createPromptShortcut(promptData: NewPromptShortcut): Promise<ApiResponse<PromptShortcut>> {
    try {
      const { data, error } = await supabaseClient
        .from('prompt_shortcuts')
        .insert([promptData])
        .select()
        .single();

      if (error) {
        throw error;
      }

      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async updatePromptShortcut(id: string, updates: UpdatePromptShortcut): Promise<ApiResponse<PromptShortcut>> {
    try {
      const { data, error } = await supabaseClient
        .from('prompt_shortcuts')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return { success: true, data };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async deletePromptShortcut(id: string): Promise<ApiResponse<boolean>> {
    try {
      const { error } = await supabaseClient
        .from('prompt_shortcuts')
        .delete()
        .eq('id', id);

      if (error) {
        throw error;
      }

      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // Chat history operations
  async getChatHistory(userId: string, sessionId: string): Promise<ApiResponse<ChatHistory>> {
    try {
      // Get the session
      const session = await this.getSessionById(sessionId);
      if (!session.success || !session.data) {
        return { success: false, error: 'Session not found' };
      }

      // Get all messages for this session
      const messages = await this.getMessagesBySessionId(sessionId);
      if (!messages.success) {
        return { success: false, error: messages.error };
      }

      const chatHistory: ChatHistory = {
        id: session.data.id,
        userId: session.data.user_id,
        messages: messages.data?.data || [],
        createdAt: session.data.created_at,
        updatedAt: session.data.updated_at
      };

      return { success: true, data: chatHistory };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async saveChatHistory(sessionId: string, messages: NewMessage[]): Promise<ApiResponse<boolean>> {
    try {
      // Delete existing messages for this session
      await supabaseClient.from('messages').delete().eq('session_id', sessionId);

      // Insert new messages
      if (messages.length > 0) {
        const messageResults = await this.createMessages(messages);
        if (!messageResults.success) {
          return { success: false, error: messageResults.error };
        }
      }

      return { success: true, data: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

// Export a singleton instance
export const supabaseDbService = new SupabaseDbService();
export default supabaseDbService;