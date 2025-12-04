// Create a service for online database synchronization
import type { Message, ChatSession } from '@prism/shared-types';
import { PromptShortcut } from './db';

export interface OnlineSyncConfig {
  apiUrl: string;
  apiKey: string;
  userId: string;
}

export interface SyncResult {
  success: boolean;
  message?: string;
  lastSync?: number;
}

class OnlineDatabaseService {
  private config: OnlineSyncConfig | null = null;

  initialize(config: OnlineSyncConfig) {
    this.config = config;
  }

  async syncMessages(messages: Message[]): Promise<SyncResult> {
    if (!this.config) {
      return { success: false, message: 'Online database not configured' };
    }

    try {
      const response = await fetch(`${this.config.apiUrl}/sync/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-User-ID': this.config.userId,
        },
        body: JSON.stringify({ messages })
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return { success: true, lastSync: Date.now(), ...result };
    } catch (error) {
      console.error('Error syncing messages:', error);
      return { success: false, message: (error as Error).message };
    }
  }

  async syncSessions(sessions: ChatSession[]): Promise<SyncResult> {
    if (!this.config) {
      return { success: false, message: 'Online database not configured' };
    }

    try {
      const response = await fetch(`${this.config.apiUrl}/sync/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-User-ID': this.config.userId,
        },
        body: JSON.stringify({ sessions })
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status} ${response.statusText}`);
      }

      await response.json();
      return { success: true, lastSync: Date.now() };
    } catch (error) {
      console.error('Error syncing sessions:', error);
      return { success: false, message: (error as Error).message };
    }
  }

  async syncPrompts(prompts: PromptShortcut[]): Promise<SyncResult> {
    if (!this.config) {
      return { success: false, message: 'Online database not configured' };
    }

    try {
      const response = await fetch(`${this.config.apiUrl}/sync/prompts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-User-ID': this.config.userId,
        },
        body: JSON.stringify({ prompts })
      });

      if (!response.ok) {
        throw new Error(`Sync failed: ${response.status} ${response.statusText}`);
      }

      await response.json();
      return { success: true, lastSync: Date.now() };
    } catch (error) {
      console.error('Error syncing prompts:', error);
      return { success: false, message: (error as Error).message };
    }
  }

  async downloadSyncedData(): Promise<{ messages: Message[], sessions: ChatSession[], prompts: PromptShortcut[] }> {
    if (!this.config) {
      return { messages: [], sessions: [], prompts: [] };
    }

    try {
      const response = await fetch(`${this.config.apiUrl}/sync/data`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-User-ID': this.config.userId,
        }
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return {
        messages: result.messages || [],
        sessions: result.sessions || [],
        prompts: result.prompts || []
      };
    } catch (error) {
      console.error('Error downloading synced data:', error);
      return { messages: [], sessions: [], prompts: [] };
    }
  }

  async clearSyncedData(): Promise<SyncResult> {
    if (!this.config) {
      return { success: false, message: 'Online database not configured' };
    }

    try {
      const response = await fetch(`${this.config.apiUrl}/sync/clear`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'X-User-ID': this.config.userId,
        }
      });

      if (!response.ok) {
        throw new Error(`Clear failed: ${response.status} ${response.statusText}`);
      }

      return { success: true, lastSync: Date.now() };
    } catch (error) {
      console.error('Error clearing synced data:', error);
      return { success: false, message: (error as Error).message };
    }
  }
}

// Export a singleton instance
export const onlineDbService = new OnlineDatabaseService();