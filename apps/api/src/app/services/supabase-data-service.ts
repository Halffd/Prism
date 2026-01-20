import { createClient } from '@supabase/supabase-js';
import { Database } from '@prism/supabase-client';
import { Message, ContextData } from '@prism/shared-types';
import { PromptShortcut } from '@prism/shared-db';
import { nanoid } from 'nanoid';

// Initialize Supabase client
const supabaseClient = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Define interfaces
export interface DBChatSession {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface DBMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  context?: ContextData;
  timestamp: number;
  tokens?: number;
}

// Chat history functions
export async function saveChatHistory(sessionId: string, messages: Message[]): Promise<void> {
  try {
    // First, get the session to update its title if it exists, or create a new one
    let session = await getSessionById(sessionId);
    
    if (!session) {
      // Create new session with the first message as title (as before)
      await supabaseClient
        .from('sessions')
        .insert([{
          id: sessionId,
          user_id: 'anonymous_user', // This would be replaced with actual user ID when auth is properly implemented
          title: messages[0]?.content?.substring(0, 100) || `Chat ${Date.now()}`
        }]);
    } else {
      // Update session if needed
      await supabaseClient
        .from('sessions')
        .update({
          updated_at: new Date().toISOString(),
          title: session.title // Keep existing title
        })
        .eq('id', sessionId);
    }

    // Delete existing messages for this session
    const { error: deleteError } = await supabaseClient
      .from('messages')
      .delete()
      .eq('session_id', sessionId);

    if (deleteError) {
      console.error('Error deleting existing messages:', deleteError);
      throw new Error(`Failed to delete existing messages: ${deleteError.message}`);
    }

    // Prepare messages for insertion
    const messagesToInsert = messages.map(msg => ({
      id: msg.id || nanoid(10), // Use existing ID or generate new one
      session_id: sessionId,
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
      context: msg.context || null,
      tokens: msg.tokens || null,
      timestamp: new Date(msg.timestamp).toISOString()
    }));

    // Insert new messages
    if (messagesToInsert.length > 0) {
      const { error: insertError } = await supabaseClient
        .from('messages')
        .insert(messagesToInsert);
        
      if (insertError) {
        console.error('Error inserting messages:', insertError);
        throw new Error(`Failed to insert messages: ${insertError.message}`);
      }
    }
  } catch (error) {
    console.error('Error saving chat history:', error);
    throw error;
  }
}

export async function loadChatHistory(sessionId: string): Promise<Message[]> {
  try {
    const { data, error } = await supabaseClient
      .from('messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('Error loading chat history:', error);
      return [];
    }

    // Transform Supabase messages to our Message format
    const messages = data.map(dbMsg => ({
      id: dbMsg.id,
      role: dbMsg.role as 'user' | 'assistant' | 'system',
      content: dbMsg.content,
      context: dbMsg.context as ContextData | undefined,
      timestamp: new Date(dbMsg.timestamp).getTime(),
      tokens: dbMsg.tokens || undefined
    }));

    return messages;
  } catch (error) {
    console.error('Error loading chat history:', error);
    return [];
  }
}

// Session functions
export async function getChatSessions(userId: string): Promise<DBChatSession[]> {
  try {
    const { data, error } = await supabaseClient
      .from('sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading chat sessions:', error);
      return [];
    }

    // Transform Supabase sessions to our format
    return data.map(dbSession => ({
      id: dbSession.id,
      userId: dbSession.user_id,
      title: dbSession.title,
      createdAt: dbSession.created_at,
      updatedAt: dbSession.updated_at
    }));
  } catch (error) {
    console.error('Error loading chat sessions:', error);
    return [];
  }
}

export async function getSessionById(id: string): Promise<DBChatSession | null> {
  try {
    const { data, error } = await supabaseClient
      .from('sessions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // Record not found
        return null;
      }
      console.error('Error loading session:', error);
      return null;
    }

    return {
      id: data.id,
      userId: data.user_id,
      title: data.title,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  } catch (error) {
    console.error('Error loading session:', error);
    return null;
  }
}

export async function createSession(sessionData: Omit<DBChatSession, 'id' | 'createdAt' | 'updatedAt'>): Promise<DBChatSession> {
  try {
    const newSessionData = {
      id: nanoid(10), // Generate new session ID
      user_id: sessionData.userId,
      title: sessionData.title
    };

    const { data, error } = await supabaseClient
      .from('sessions')
      .insert([newSessionData])
      .select()
      .single();

    if (error) {
      console.error('Error creating session:', error);
      throw new Error(`Failed to create session: ${error.message}`);
    }

    return {
      id: data.id,
      userId: data.user_id,
      title: data.title,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  } catch (error) {
    console.error('Error creating session:', error);
    throw error;
  }
}

export async function deleteChatSession(sessionId: string): Promise<boolean> {
  try {
    const { error } = await supabaseClient
      .from('sessions')
      .delete()
      .eq('id', sessionId);

    if (error) {
      console.error('Error deleting chat session:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error deleting chat session:', error);
    return false;
  }
}

// Prompt shortcuts functions
export async function savePromptShortcut(prompt: PromptShortcut): Promise<void> {
  try {
    // If prompt doesn't have an ID, generate one
    if (!prompt.id) {
      prompt.id = `prompt_${Date.now()}`;
    }

    const promptData = {
      id: prompt.id,
      user_id: 'anonymous_user', // This would be replaced with actual user ID when auth is properly implemented
      name: prompt.name,
      content: prompt.content,
      category: prompt.category,
      shortcut_key: prompt.shortcutKey,
      keyboard_shortcut: prompt.keyboardShortcut
    };

    // Use upsert to update if exists, insert if not
    const { error } = await supabaseClient
      .from('prompt_shortcuts')
      .upsert([promptData]);

    if (error) {
      console.error('Error saving prompt shortcut:', error);
      throw new Error(`Failed to save prompt shortcut: ${error.message}`);
    }
  } catch (error) {
    console.error('Error saving prompt shortcut:', error);
    throw error;
  }
}

export async function getPromptShortcuts(userId: string, category?: string): Promise<PromptShortcut[]> {
  try {
    let query = supabaseClient
      .from('prompt_shortcuts')
      .select('*')
      .eq('user_id', userId);

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error loading prompt shortcuts:', error);
      return [];
    }

    return data.map(dbPrompt => ({
      id: dbPrompt.id,
      name: dbPrompt.name,
      content: dbPrompt.content,
      category: dbPrompt.category || undefined,
      shortcutKey: dbPrompt.shortcut_key || undefined,
      keyboardShortcut: dbPrompt.keyboard_shortcut || undefined
    }));
  } catch (error) {
    console.error('Error loading prompt shortcuts:', error);
    return [];
  }
}

export async function deletePromptShortcut(promptId: string): Promise<boolean> {
  try {
    const { error } = await supabaseClient
      .from('prompt_shortcuts')
      .delete()
      .eq('id', promptId);

    if (error) {
      console.error('Error deleting prompt shortcut:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error deleting prompt shortcut:', error);
    return false;
  }
}