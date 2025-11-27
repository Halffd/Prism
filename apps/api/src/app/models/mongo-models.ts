import { Document, Schema, model, connect, Model, Types } from 'mongoose';
import { Message, ContextData, ChatSession } from '@prism/shared-types';

// Connect to MongoDB (in production, use connection pooling)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/prism';
connect(MONGODB_URI).catch(console.error);

// Message Schema
interface IMessage extends Omit<Message, 'id'> {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
}

const messageSchema: Schema = new Schema<IMessage>(
  {
    role: { type: String, required: true, enum: ['user', 'assistant', 'system'] },
    content: { type: String, required: true },
    context: {
      type: {
        type: String,
        enum: ['page', 'screen', 'selection']
      },
      url: String,
      title: String,
      selectedText: String,
      fullText: String,
      appName: String,
      metadata: Schema.Types.Mixed
    },
    timestamp: { type: Number, default: Date.now },
    tokens: Number,
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true }
  },
  { timestamps: true }
);

messageSchema.index({ sessionId: 1, timestamp: 1 });

const MessageModel: Model<IMessage> = model<IMessage>('Message', messageSchema);

// Session Schema
interface ISession extends Omit<ChatSession, 'id' | 'messages'> {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
}

const sessionSchema: Schema = new Schema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    messages: [{ type: Schema.Types.ObjectId, ref: 'Message' }]
  },
  { timestamps: true }
);

sessionSchema.index({ userId: 1, createdAt: -1 });

const SessionModel: Model<ISession> = model<ISession>('Session', sessionSchema);

// User Schema
interface IUser {
  _id: Types.ObjectId;
  externalId: string; // ID from auth provider
  email?: string;
  name?: string;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema: Schema = new Schema<IUser>(
  {
    externalId: { type: String, required: true, unique: true },
    email: String,
    name: String
  },
  { timestamps: true }
);

userSchema.index({ externalId: 1 });

const UserModel: Model<IUser> = model<IUser>('User', userSchema);

// Repository classes for data access
class SessionRepository {
  async create(userId: string, messages: string[] = []): Promise<ChatSession> {
    // In a real implementation, we'd create a new session with message references
    // Here we're simplifying for demo purposes
    const session = new SessionModel({
      userId: new Types.ObjectId(userId),
      messages: messages.map(id => new Types.ObjectId(id))
    });
    
    const savedSession = await session.save();
    
    // Convert to the expected ChatSession format
    return {
      id: savedSession._id.toString(),
      userId: savedSession.userId.toString(),
      messages: [], // We'll populate this on retrieval
      createdAt: savedSession.createdAt.getTime(),
      updatedAt: savedSession.updatedAt.getTime()
    };
  }

  async findById(id: string): Promise<ChatSession | null> {
    const session = await SessionModel.findById(id).populate('messages');
    if (!session) return null;

    // Convert to the expected ChatSession format
    return {
      id: session._id.toString(),
      userId: session.userId.toString(),
      messages: session.messages as any, // Simplified for demo
      createdAt: session.createdAt.getTime(),
      updatedAt: session.updatedAt.getTime()
    };
  }

  async findByUserId(userId: string): Promise<ChatSession[]> {
    const sessions = await SessionModel.find({ userId: new Types.ObjectId(userId) }).populate('messages');
    
    return sessions.map(session => ({
      id: session._id.toString(),
      userId: session.userId.toString(),
      messages: session.messages as any, // Simplified for demo
      createdAt: session.createdAt.getTime(),
      updatedAt: session.updatedAt.getTime()
    }));
  }

  async update(id: string, updates: Partial<ChatSession>): Promise<ChatSession | null> {
    const updatedSession = await SessionModel.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: new Date() },
      { new: true }
    ).populate('messages');

    if (!updatedSession) return null;

    return {
      id: updatedSession._id.toString(),
      userId: updatedSession.userId.toString(),
      messages: updatedSession.messages as any, // Simplified for demo
      createdAt: updatedSession.createdAt.getTime(),
      updatedAt: updatedSession.updatedAt.getTime()
    };
  }

  async delete(id: string): Promise<boolean> {
    const result = await SessionModel.findByIdAndDelete(id);
    return !!result;
  }
}

class MessageRepository {
  async create(sessionId: string, message: Omit<Message, 'id' | 'timestamp'>): Promise<Message> {
    const newMessage = new MessageModel({
      ...message,
      sessionId: new Types.ObjectId(sessionId),
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

  async findBySessionId(sessionId: string): Promise<Message[]> {
    const messages = await MessageModel.find({ sessionId: new Types.ObjectId(sessionId) })
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
    return this.create(sessionId, message);
  }
}

// Export repositories and base models
export { SessionRepository, MessageRepository, UserModel, SessionModel, MessageModel };
export default { SessionRepository, MessageRepository };