import { v4 as uuidv4 } from 'uuid';

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

// Data access layer interface
interface IDataAccess {
  createSession(session: Omit<ChatSession, 'id' | 'createdAt' | 'updatedAt'>): Promise<ChatSession>;
  findSessionById(id: string): Promise<ChatSession | null>;
  findSessionsByUserId(userId: string): Promise<ChatSession[]>;
  updateSession(id: string, updates: Partial<ChatSession>): Promise<ChatSession | null>;
  deleteSession(id: string): Promise<boolean>;
  createMessage(sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): Promise<Message>;
  findMessagesBySessionId(sessionId: string): Promise<Message[]>;
  addMessageToSession(sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): Promise<Message>;
}

// In-memory implementation for development
class InMemoryDataAccess implements IDataAccess {
  private sessions: Map<string, ChatSession> = new Map();
  private messages: Map<string, Message[]> = new Map();

  async createSession(session: Omit<ChatSession, 'id' | 'createdAt' | 'updatedAt'>): Promise<ChatSession> {
    const newSession: ChatSession = {
      id: uuidv4(),
      ...session,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.sessions.set(newSession.id, newSession);
    this.messages.set(newSession.id, []);
    return newSession;
  }

  async findSessionById(id: string): Promise<ChatSession | null> {
    return this.sessions.get(id) || null;
  }

  async findSessionsByUserId(userId: string): Promise<ChatSession[]> {
    const sessions: ChatSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        sessions.push(session);
      }
    }
    return sessions;
  }

  async updateSession(id: string, updates: Partial<ChatSession>): Promise<ChatSession | null> {
    const session = this.sessions.get(id);
    if (!session) return null;

    const updatedSession: ChatSession = {
      ...session,
      ...updates,
      updatedAt: Date.now()
    };
    this.sessions.set(id, updatedSession);
    return updatedSession;
  }

  async deleteSession(id: string): Promise<boolean> {
    const deletedSession = this.sessions.delete(id);
    this.messages.delete(id);
    return deletedSession;
  }

  async createMessage(sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): Promise<Message> {
    if (!this.messages.has(sessionId)) {
      this.messages.set(sessionId, []);
    }

    const newMessage: Message = {
      id: uuidv4(),
      ...message,
      timestamp: Date.now()
    };
    this.messages.get(sessionId)!.push(newMessage);
    return newMessage;
  }

  async findMessagesBySessionId(sessionId: string): Promise<Message[]> {
    return this.messages.get(sessionId) || [];
  }

  async addMessageToSession(sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): Promise<Message> {
    return this.createMessage(sessionId, message);
  }
}

// Create singleton instance
const dataAccess: IDataAccess = new InMemoryDataAccess();

export { dataAccess };
export type { IDataAccess };