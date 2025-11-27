import { Message, ChatSession } from '@prism/shared-types';
import { dataAccess } from './mongo-data-access';

export const SessionModel = {
  create: async (session: Omit<ChatSession, 'id' | 'createdAt' | 'updatedAt'>): Promise<ChatSession> => {
    return dataAccess.createSession(session);
  },

  findById: async (id: string): Promise<ChatSession | null> => {
    return dataAccess.findSessionById(id);
  },

  findAll: async (userId: string): Promise<ChatSession[]> => {
    return dataAccess.findSessionsByUserId(userId);
  },

  update: async (id: string, updates: Partial<ChatSession>): Promise<ChatSession | null> => {
    return dataAccess.updateSession(id, updates);
  },

  delete: async (id: string): Promise<boolean> => {
    return dataAccess.deleteSession(id);
  }
};

export const MessageModel = {
  create: async (sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): Promise<Message> => {
    return dataAccess.createMessage(sessionId, message);
  },

  findBySessionId: async (sessionId: string): Promise<Message[]> => {
    return dataAccess.findMessagesBySessionId(sessionId);
  },

  addMessageToSession: async (sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): Promise<Message> => {
    return dataAccess.addMessageToSession(sessionId, message);
  }
};