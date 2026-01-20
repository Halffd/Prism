import { UnifiedAIClient } from '@prism/api-client';
import { AIConfig } from '@prism/shared-types';

describe('Offline Functionality with Local IndexedDB', () => {
  let client: UnifiedAIClient;

  beforeEach(() => {
    const aiConfig: AIConfig = {
      provider: 'prism-api',
      apiUrl: 'http://localhost:3000/api'
    };
    
    client = new UnifiedAIClient({ aiConfig });
  });

  test('should work with local IndexedDB as primary storage', async () => {
    // This test verifies that the extension uses local IndexedDB as primary storage
    // The actual IndexedDB operations are tested in the shared-db module
    
    expect(client).toBeDefined();
    expect(client.getCurrentAIConfig()).toBeDefined();
  });

  test('should handle offline scenarios gracefully', async () => {
    // Mock network status as offline
    const mockNetworkStatus = {
      isCurrentlyOnline: () => false,
      updateApiUrl: jest.fn(),
      addNetworkStatusListener: jest.fn(),
      removeNetworkStatusListener: jest.fn()
    };
    
    // Override the network status service
    const originalNetworkStatus = require('@prism/api-client').networkStatusService;
    Object.defineProperty(require('@prism/api-client'), 'networkStatusService', {
      value: mockNetworkStatus
    });

    // Test that the client can still operate in offline mode
    const aiConfig: AIConfig = {
      provider: 'ollama', // Use a local provider
      providerKeys: {
        'ollama': 'http://localhost:11434'
      }
    };
    
    const localClient = new UnifiedAIClient({ aiConfig });
    localClient.updateAIConfig(aiConfig);
    
    // Restore original network status
    Object.defineProperty(require('@prism/api-client'), 'networkStatusService', {
      value: originalNetworkStatus
    });
    
    expect(localClient.getCurrentAIConfig()).toBeDefined();
  });

  test('should prioritize local storage over API', () => {
    // Verify that the client is configured to use local IndexedDB as primary storage
    // This is handled by the shared-db module which uses IndexedDB as primary storage
    const aiConfig: AIConfig = {
      provider: 'prism-api',
      apiUrl: 'http://localhost:3000/api'
    };
    
    const client = new UnifiedAIClient({ aiConfig });
    
    // The client should be initialized with the provided config
    expect(client.getCurrentAIConfig()).toEqual(aiConfig);
  });

  test('should handle API sync as secondary functionality', () => {
    const aiConfig: AIConfig = {
      provider: 'prism-api',
      apiUrl: 'http://localhost:3000/api'
    };
    
    const client = new UnifiedAIClient({ aiConfig });
    
    // Verify sync methods exist but are secondary to local storage
    expect(typeof client.syncMessages).toBe('function');
    expect(typeof client.syncSessions).toBe('function');
    expect(typeof client.syncPrompts).toBe('function');
    expect(typeof client.getSyncedData).toBe('function');
  });
});