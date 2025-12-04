// Export shared database functionality
export * from './db';
export * from './online-db';

// Export the local ChatSession type for use in the extension
export type { DBChatSession as ChatSession } from './db';