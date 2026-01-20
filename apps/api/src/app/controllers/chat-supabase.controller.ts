import { Response } from 'express';
import { Message, ContextData, AIConfig } from '@prism/shared-types';
import { saveChatHistory as saveMongoChatHistory, loadChatHistory as loadMongoChatHistory } from '@prism/shared-db';
import { saveChatHistory as saveSupabaseChatHistory, loadChatHistory as loadSupabaseChatHistory } from '../services/supabase-data-service';
import { UnifiedAIClient } from '@prism/api-client';
import { AuthenticatedRequest } from '../middleware/auth';
import { ChatSession } from '../models/mongo-schemas';

export const sendMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { content, context, sessionId, images } = req.body || {};

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Content is required'
      });
    }

    // Use authenticated user ID or default to anonymous
    const userId = req.user?.id || 'anonymous';
    const currentSessionId = sessionId || `session_${Date.now()}`;

    // Create the user message
    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content,
      images,
      context,
      timestamp: Date.now()
    };

    // Create AI client and get response
    const aiConfig: AIConfig = {
      provider: req.body.provider || 'openai',
      apiKey: process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '',
      model: process.env.LLM_MODEL || 'gpt-3.5-turbo'
    };

    const client = new UnifiedAIClient({ aiConfig });
    const response = await client.sendMessage(content, context, currentSessionId, images);

    if (!response.success || !response.data) {
      return res.status(500).json({
        success: false,
        error: response.error || 'Failed to get AI response'
      });
    }

    // Save both messages to the appropriate database
    const messagesToSave = [userMessage, response.data];

    if (req.user?.email && req.headers.authorization?.includes('sb-')) {
      // Save to Supabase
      await saveSupabaseChatHistory(currentSessionId, messagesToSave);
    } else {
      // Save to MongoDB
      await saveMongoChatHistory(currentSessionId, messagesToSave);
    }

    return res.json({
      success: true,
      data: response.data
    });
  } catch (error: any) {
    console.error('Error in sendMessage:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send message'
    });
  }
};

export const getHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID is required'
      });
    }

    // Determine which database to use based on auth type
    let messages: Message[];
    if (req.user?.email && req.headers.authorization?.includes('sb-')) {
      messages = await loadSupabaseChatHistory(sessionId);
    } else {
      messages = await loadMongoChatHistory(sessionId);
    }

    if (!messages || messages.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No chat history found'
      });
    }

    return res.json({
      success: true,
      data: messages
    });
  } catch (error: unknown) {
    console.error('Error in getHistory:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve history'
    });
  }
};

// Export the context processor for use in routes
export { UnifiedAIClient };