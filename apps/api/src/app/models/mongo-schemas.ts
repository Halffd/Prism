import mongoose, { Schema, Document } from 'mongoose';
import { Message, ContextData, ChatSession } from '@prism/shared-types';

// User Schema
export interface IUser extends Document {
  externalId: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema({
  externalId: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true }
}, {
  timestamps: true
});

export const User = mongoose.model<IUser>('User', UserSchema);

// Message Schema
export interface IMessage extends Document {
  role: 'user' | 'assistant' | 'system';
  content: string;
  context?: ContextData;
  timestamp: number;
  tokens?: number;
  sessionId: mongoose.Types.ObjectId;
}

const MessageSchema: Schema = new Schema({
  role: { 
    type: String, 
    required: true, 
    enum: ['user', 'assistant', 'system'] 
  },
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
  sessionId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Session', 
    required: true 
  }
}, {
  timestamps: true
});

MessageSchema.index({ sessionId: 1, timestamp: 1 });

export const MessageModel = mongoose.model<IMessage>('Message', MessageSchema);

// Session Schema
export interface ISession extends Document {
  userId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  messages: mongoose.Types.ObjectId[];
}

const SessionSchema: Schema = new Schema({
  userId: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  messages: [{ 
    type: Schema.Types.ObjectId, 
    ref: 'Message' 
  }]
}, {
  timestamps: true
});

SessionSchema.index({ userId: 1, createdAt: -1 });

export const Session = mongoose.model<ISession>('Session', SessionSchema);