import { Message, ChatSession } from '@prism/shared-types';
import { User, Session, MessageModel, IUser, ISession, IMessage } from './mongo-schemas';
import mongoose from 'mongoose';

// Initialize connection
import connectToDatabase from '../utils/db';
connectToDatabase().catch(console.error);

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

// MongoDB implementation
class MongoDataAccess implements IDataAccess {
  async createSession(session: Omit<ChatSession, 'id' | 'createdAt' | 'updatedAt'>): Promise<ChatSession> {
    
    
    // Create the session
    const newSession = new Session({
      userId: new mongoose.Types.ObjectId(session.userId),
      messages: []
    });
    
    const savedSession = await newSession.save();
    
    return {
      id: savedSession._id.toString(),
      userId: session.userId,
      messages: [],
      createdAt: savedSession.createdAt.getTime(),
      updatedAt: savedSession.updatedAt.getTime()
    };
  }

  async findSessionById(id: string): Promise<ChatSession | null> {
    
    
    const session = await Session.findById(id).populate('messages');
    if (!session) return null;

    return {
      id: session._id.toString(),
      userId: session.userId.toString(),
      messages: [], // We'll populate messages separately if needed
      createdAt: session.createdAt.getTime(),
      updatedAt: session.updatedAt.getTime()
    };
  }

  async findSessionsByUserId(userId: string): Promise<ChatSession[]> {
    
    
    const sessions = await Session.find({ userId: new mongoose.Types.ObjectId(userId) });
    
    return sessions.map(session => ({
      id: session._id.toString(),
      userId: session.userId.toString(),
      messages: [], // We'll populate messages separately if needed
      createdAt: session.createdAt.getTime(),
      updatedAt: session.updatedAt.getTime()
    }));
  }

  async updateSession(id: string, updates: Partial<ChatSession>): Promise<ChatSession | null> {
    
    
    const updatedSession = await Session.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: new Date() },
      { new: true }
    );
    
    if (!updatedSession) return null;

    return {
      id: updatedSession._id.toString(),
      userId: updatedSession.userId.toString(),
      messages: [], // We'll populate messages separately if needed
      createdAt: updatedSession.createdAt.getTime(),
      updatedAt: updatedSession.updatedAt.getTime()
    };
  }

  async deleteSession(id: string): Promise<boolean> {
    
    
    const result = await Session.findByIdAndDelete(id);
    return !!result;
  }

  async createMessage(sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): Promise<Message> {
    
    
    const newMessage = new MessageModel({
      ...message,
      sessionId: new mongoose.Types.ObjectId(sessionId),
      timestamp: Date.now()
    });
    
    const savedMessage = await newMessage.save();
    
    return {
      id: savedMessage._id.toString(),
      role: savedMessage.role,
      content: savedMessage.content,
      context: savedMessage.context,
      timestamp: savedMessage.timestamp,
      tokens: savedMessage.tokens
    };
  }

  async findMessagesBySessionId(sessionId: string): Promise<Message[]> {
    
    
    const messages = await MessageModel.find({ sessionId: new mongoose.Types.ObjectId(sessionId) })
      .sort({ timestamp: 1 });
    
    return messages.map(msg => ({
      id: msg._id.toString(),
      role: msg.role,
      content: msg.content,
      context: msg.context,
      timestamp: msg.timestamp,
      tokens: msg.tokens
    }));
  }

  async addMessageToSession(sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): Promise<Message> {
    return this.createMessage(sessionId, message);
  }
}

// Create singleton instance
const dataAccess: IDataAccess = new MongoDataAccess();

export { dataAccess, IDataAccess };