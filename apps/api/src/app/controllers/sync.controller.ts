import { Request, Response } from 'express';
import { MessageModel, SessionModel } from '../models';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../middleware/auth';

// Define interfaces locally since imports are having issues
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
  context?: ContextData;
  timestamp: number;
  tokens?: number;
}

interface ContextData {
  type: 'page' | 'screen' | 'selection';
  url?: string;
  title?: string;
  selectedText?: string;
  fullText?: string;
  appName?: string;
  metadata?: Record<string, unknown>;
}

interface ChatSession {
  id: string;
  userId: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

interface PromptShortcut {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  category?: string;
  shortcutKey?: string;
  keyboardShortcut?: string;
}

// For sync purposes, create a simple collection to store prompt shortcuts
import { Schema, model } from 'mongoose';

interface ISyncPrompt {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  category?: string;
  shortcutKey?: string;
  keyboardShortcut?: string;
  userId: mongoose.Types.ObjectId;
  syncedAt: Date;
}

const SyncPromptSchema: Schema = new Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  content: { type: String, required: true },
  createdAt: { type: Number, required: true },
  category: String,
  shortcutKey: String,
  keyboardShortcut: String,
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  syncedAt: { type: Date, default: Date.now }
});

const SyncPromptModel = model<ISyncPrompt>('SyncPrompt', SyncPromptSchema);

// Sync messages to user's account
export const syncMessages = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { messages } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages must be an array' });
    }

    // For sync messages, we'll update our existing sessions model to handle this appropriately
    // First clear existing sessions for this user (these would contain messages)
    const existingSessions = await SessionModel.findAll(userId);
    for (const session of existingSessions) {
      await SessionModel.delete(session.id); // Use the model's delete method
    }

    // Create a new session to store the synced messages
    // Since the sync data might be from different sessions, we'll create a combined session
    const newSession = await SessionModel.create({
      userId: userId,
      messages: []
    });

    // Add all messages to the new session
    for (const msg of messages) {
      await MessageModel.addMessageToSession(newSession.id, {
        role: msg.role,
        content: msg.content,
        context: msg.context,
        tokens: msg.tokens
      });
    }

    return res.status(200).json({
      message: 'Messages synced successfully',
      count: messages.length
    });
  } catch (error) {
    console.error('Error syncing messages:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Sync sessions to user's account
export const syncSessions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessions } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!Array.isArray(sessions)) {
      return res.status(400).json({ error: 'Sessions must be an array' });
    }

    // Clear existing sessions for this user
    const existingSessions = await SessionModel.findAll(userId);
    for (const session of existingSessions) {
      await SessionModel.delete(session.id); // Use the model's delete method
    }

    // Add each session with its messages
    for (const session of sessions) {
      const newSession = await SessionModel.create({
        userId: userId,
        messages: []
      });

      // Add messages to the session
      for (const msg of session.messages || []) {
        await MessageModel.addMessageToSession(newSession.id, {
          role: msg.role,
          content: msg.content,
          context: msg.context,
          tokens: msg.tokens
        });
      }
    }

    return res.status(200).json({
      message: 'Sessions synced successfully',
      count: sessions.length
    });
  } catch (error) {
    console.error('Error syncing sessions:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Sync prompts to user's account
export const syncPrompts = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { prompts } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!Array.isArray(prompts)) {
      return res.status(400).json({ error: 'Prompts must be an array' });
    }

    // Clear existing prompts for this user
    await SyncPromptModel.deleteMany({ userId: new mongoose.Types.ObjectId(userId) });

    // Add user ID to each prompt and save
    for (const prompt of prompts) {
      await SyncPromptModel.create({
        ...prompt,
        userId: new mongoose.Types.ObjectId(userId),
        syncedAt: new Date()
      });
    }

    return res.status(200).json({
      message: 'Prompts synced successfully',
      count: prompts.length
    });
  } catch (error) {
    console.error('Error syncing prompts:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Get all synced data for user
export const getSyncedData = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get synced messages from user's sessions
    const sessions = await SessionModel.findAll(userId);

    // Get all messages from all sessions
    let allMessages: any[] = [];
    for (const session of sessions) {
      const messages = await MessageModel.findBySessionId(session.id);
      allMessages = allMessages.concat(messages.map(msg => ({
        ...msg,
        sessionId: session.id // Add session ID to track which session the message belongs to
      })));
    }

    // Sort messages by timestamp
    allMessages.sort((a, b) => a.timestamp - b.timestamp);

    // Get synced prompts
    const prompts = await SyncPromptModel.find({ userId: new mongoose.Types.ObjectId(userId) });

    return res.status(200).json({
      messages: allMessages.map(({ _id, userId, syncedAt, ...rest }) => rest as any),
      sessions: sessions,
      prompts: prompts.map(({ _id, userId, syncedAt, ...rest }) => rest as PromptShortcut)
    });
  } catch (error) {
    console.error('Error getting synced data:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Clear synced data for user
export const clearSyncedData = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Delete all synced data for the user
    const existingSessions = await SessionModel.findAll(userId);
    for (const session of existingSessions) {
      await SessionModel.delete(session.id);
    }

    await SyncPromptModel.deleteMany({ userId: new mongoose.Types.ObjectId(userId) });

    return res.status(200).json({ message: 'Synced data cleared successfully' });
  } catch (error) {
    console.error('Error clearing synced data:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};