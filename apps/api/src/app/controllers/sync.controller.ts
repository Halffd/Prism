import { Request, Response } from 'express';
import { getDb } from '../services/db.service';
import type { Message, ChatSession } from '@prism/shared-types';

// Define PromptShortcut interface since it's not in shared-types
interface PromptShortcut {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  category?: string;
  shortcutKey?: string; // Optional keyboard shortcut (e.g., "/fix")
  keyboardShortcut?: string; // Full keyboard shortcut (e.g., "Ctrl+Shift+F")
}

// Sync messages to user's account
export const syncMessages = async (req: Request, res: Response) => {
  try {
    const { messages } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages must be an array' });
    }

    const db = await getDb();
    
    // Clear existing messages for this user
    await db.collection('syncedMessages').deleteMany({ userId });
    
    // Add user ID to each message and save
    const messagesWithUserId = messages.map(msg => ({
      ...msg,
      userId,
      syncedAt: new Date()
    }));
    
    await db.collection('syncedMessages').insertMany(messagesWithUserId);

    res.status(200).json({ 
      message: 'Messages synced successfully', 
      count: messages.length 
    });
  } catch (error) {
    console.error('Error syncing messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Sync sessions to user's account
export const syncSessions = async (req: Request, res: Response) => {
  try {
    const { sessions } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!Array.isArray(sessions)) {
      return res.status(400).json({ error: 'Sessions must be an array' });
    }

    const db = await getDb();
    
    // Clear existing sessions for this user
    await db.collection('syncedSessions').deleteMany({ userId });
    
    // Add user ID to each session and save
    const sessionsWithUserId = sessions.map(session => ({
      ...session,
      userId,
      syncedAt: new Date()
    }));
    
    await db.collection('syncedSessions').insertMany(sessionsWithUserId);

    res.status(200).json({ 
      message: 'Sessions synced successfully', 
      count: sessions.length 
    });
  } catch (error) {
    console.error('Error syncing sessions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Sync prompts to user's account
export const syncPrompts = async (req: Request, res: Response) => {
  try {
    const { prompts } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!Array.isArray(prompts)) {
      return res.status(400).json({ error: 'Prompts must be an array' });
    }

    const db = await getDb();
    
    // Clear existing prompts for this user
    await db.collection('syncedPrompts').deleteMany({ userId });
    
    // Add user ID to each prompt and save
    const promptsWithUserId = prompts.map(prompt => ({
      ...prompt,
      userId,
      syncedAt: new Date()
    }));
    
    await db.collection('syncedPrompts').insertMany(promptsWithUserId);

    res.status(200).json({ 
      message: 'Prompts synced successfully', 
      count: prompts.length 
    });
  } catch (error) {
    console.error('Error syncing prompts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get all synced data for user
export const getSyncedData = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = await getDb();

    // Get synced messages
    const messages = await db.collection('syncedMessages')
      .find({ userId })
      .sort({ timestamp: 1 })
      .toArray();
    
    // Get synced sessions
    const sessions = await db.collection('syncedSessions')
      .find({ userId })
      .toArray();
    
    // Get synced prompts
    const prompts = await db.collection('syncedPrompts')
      .find({ userId })
      .toArray();

    res.status(200).json({
      messages: messages.map(({ _id, userId, syncedAt, ...rest }) => rest as Message),
      sessions: sessions.map(({ _id, userId, syncedAt, ...rest }) => rest as ChatSession),
      prompts: prompts.map(({ _id, userId, syncedAt, ...rest }) => rest as PromptShortcut)
    });
  } catch (error) {
    console.error('Error getting synced data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Clear synced data for user
export const clearSyncedData = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = await getDb();

    // Delete all synced data for the user
    await db.collection('syncedMessages').deleteMany({ userId });
    await db.collection('syncedSessions').deleteMany({ userId });
    await db.collection('syncedPrompts').deleteMany({ userId });

    res.status(200).json({ message: 'Synced data cleared successfully' });
  } catch (error) {
    console.error('Error clearing synced data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};