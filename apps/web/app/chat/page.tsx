'use client';

import { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { MermaidRenderer } from '@prism/ui-components';
import { UnifiedAIClient } from '@prism/api-client';
import {
  saveChatHistory,
  loadChatHistory,
  getChatSessions,
  deleteChatSession,
  setCache,
  getCache,
  ChatSession,
  savePromptShortcut,
  getPromptShortcuts,
  deletePromptShortcut,
  PromptShortcut
} from '@prism/shared-db';
import { ImageGenerationService } from '@prism/image-gen';
import type { Message, ContextData, AIConfig } from '@prism/shared-types';
import {
  setMessages,
  addMessage,
  setLoading,
  setCurrentSessionId,
  setAIConfig,
  updateAIConfig,
  RootState
} from '../../../libs/redux-store/src/store';
import { useAuth } from '@/src/auth-provider';
import { networkStatusService } from '@prism/api-client';

// Initialize with default settings - will be overridden by stored settings
const defaultAIConfig: AIConfig = {
  provider: 'prism-api',
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api'
};

let client: UnifiedAIClient;

export default function ChatPage() {
  const dispatch = useDispatch();
  const { messages, loading, currentSessionId } = useSelector((state: RootState) => state.chat);
  const { config: aiConfig } = useSelector((state: RootState) => state.aiConfig);
  const { user, isAuthenticated, loading: authLoading, signInWithGoogle, signOut } = useAuth();
  const [input, setInput] = useState('');

  // Image generation state
  const [imageGenerationPrompt, setImageGenerationPrompt] = useState<string>('');
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState<boolean>(false);
  const [imageGenerationModel, setImageGenerationModel] = useState<string>('stabilityai/stable-diffusion-2-1');
  const [imageGenerationApiKey, setImageGenerationApiKey] = useState<string>('');

  useEffect(() => {
    // Load saved AI configuration
    const savedConfig = localStorage.getItem('aiConfig');
    if (savedConfig) {
      try {
        const config = JSON.parse(savedConfig) as AIConfig;
        dispatch(setAIConfig(config));
        client = new UnifiedAIClient({
          aiConfig: config,
          prismApiUrl: config.apiUrl
        });
      } catch (error) {
        console.error('Failed to load AI config, using default:', error);
        dispatch(setAIConfig(defaultAIConfig));
        client = new UnifiedAIClient({ aiConfig: defaultAIConfig });
      }
    } else {
      dispatch(setAIConfig(defaultAIConfig));
      client = new UnifiedAIClient({ aiConfig: defaultAIConfig });
    }

    // Load chat history from database
    loadChatHistoryFromDB();
  }, [dispatch]);

  useEffect(() => {
    // Save chat to database when messages change
    if (messages.length > 0) {
      saveCurrentChatToDB(messages);
    }
  }, [messages]);

  const loadChatHistoryFromDB = async () => {
    try {
      const history = await loadChatHistory(currentSessionId);
      dispatch(setMessages(history));
    } catch (error) {
      console.error('Failed to load chat history from database:', error);
      // Fallback to localStorage if database fails
      const savedMessages = localStorage.getItem('chatHistory');
      if (savedMessages) {
        dispatch(setMessages(JSON.parse(savedMessages)));
      }
    }
  };

  const saveCurrentChatToDB = async (newMessages: Message[]) => {
    try {
      await saveChatHistory(currentSessionId, newMessages);
    } catch (error) {
      console.error('Failed to save chat to database:', error);
      // Fallback to localStorage if database fails
      localStorage.setItem('chatHistory', JSON.stringify(newMessages));
    }
  };

  // Caching function for API responses
  const getCachedResponse = async (input: string): Promise<Message | null> => {
    try {
      const cacheKey = `ai_response_${input.substring(0, 50)}`;
      const cached = await getCache<Message>(cacheKey);
      return cached;
    } catch (error) {
      console.error('Error getting cached response:', error);
      return null;
    }
  };

  const setCachedResponse = async (input: string, response: Message) => {
    try {
      const cacheKey = `ai_response_${input.substring(0, 50)}`;
      // Cache for 1 hour (3600 seconds)
      await setCache(cacheKey, response, 3600);
    } catch (error) {
      console.error('Error setting cached response:', error);
    }
  };

  // Image generation functions for web app
  useEffect(() => {
    // Load image generation config from localStorage
    const savedApiKey = localStorage.getItem('imageGenApiKey');
    const savedModel = localStorage.getItem('imageGenModel');
    if (savedApiKey) setImageGenerationApiKey(savedApiKey);
    if (savedModel) setImageGenerationModel(savedModel);
  }, []);

  const generateImage = async () => {
    if (!imageGenerationPrompt.trim() || !imageGenerationApiKey) {
      alert('Please enter a prompt and API key');
      return;
    }

    setIsGeneratingImage(true);
    setGeneratedImage(null);

    try {
      const service = new ImageGenerationService({
        model: imageGenerationModel,
        apiKey: imageGenerationApiKey
      });

      const result = await service.generateImage(imageGenerationPrompt);
      setGeneratedImage(result.imageUrl);

      // Add the generated image to the chat as a message
      const imageMessage: Message = {
        id: `img_${Date.now()}`,
        role: 'assistant',
        content: `Generated image for: "${imageGenerationPrompt}"`,
        timestamp: Date.now()
      };

      // Add the image as a new message in the chat
      dispatch(addMessage(imageMessage));
      saveCurrentChatToDB([...messages, imageMessage]);

      // Save the image generation config
      localStorage.setItem('imageGenApiKey', imageGenerationApiKey);
      localStorage.setItem('imageGenModel', imageGenerationModel);
    } catch (error) {
      console.error('Error generating image:', error);
      alert('Error generating image: ' + (error as Error).message);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const saveImageGenerationConfig = () => {
    localStorage.setItem('imageGenApiKey', imageGenerationApiKey);
    localStorage.setItem('imageGenModel', imageGenerationModel);
  };

  const handleUpdateAIConfig = (config: AIConfig) => {
    dispatch(updateAIConfig(config));
    localStorage.setItem('aiConfig', JSON.stringify(config));
    client = new UnifiedAIClient({
      aiConfig: { ...aiConfig, ...config },
      prismApiUrl: config.apiUrl || aiConfig.apiUrl
    });
  };

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now()
    };

    dispatch(addMessage(userMessage));
    setInput('');
    dispatch(setLoading(true));

    try {
      // Check if we have a cached response
      const cachedResponse = await getCachedResponse(input);
      if (cachedResponse) {
        dispatch(addMessage(cachedResponse));
        return;
      }

      // Get page context from browser
      const pageContext: ContextData = {
        type: 'page',
        url: window.location.href,
        title: document.title,
        selectedText: window.getSelection()?.toString()
      };

      // Before sending the message, save to database in case we go offline
      await saveCurrentChatToDB([...messages, userMessage]);

      const response = await client.sendMessage(input, pageContext);

      if (response.success && response.data) {
        dispatch(addMessage(response.data!));
        // Cache the response
        await setCachedResponse(input, response.data!);
      } else {
        // If response failed, show error message in chat
        const errorMessage: Message = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: response.error || 'Failed to get response from AI',
          timestamp: Date.now()
        };
        dispatch(addMessage(errorMessage));
      }
    } catch (error) {
      console.error('Error:', error);
      // Show error message if network request failed
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${error.message || 'Failed to connect to AI service'}`,
        timestamp: Date.now()
      };
      dispatch(addMessage(errorMessage));

      // Also try to use a local model as fallback if the primary one failed
      const fallbackConfig = { ...aiConfig };
      if (!networkStatusService.isCurrentlyOnline() && fallbackConfig.provider === 'prism-api') {
        // If offline and using prism-api, try to switch to a local model temporarily
        // Note: In a real implementation, user preferences would determine which local model to use
        console.info('Currently offline, using local model if available...');
      }
    } finally {
      dispatch(setLoading(false));
    }
  };

  const [showSettings, setShowSettings] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [syncIntervalId, setSyncIntervalId] = useState<NodeJS.Timeout | null>(null);
  const [isOnline, setIsOnline] = useState(true); // Track network status

  // Monitor network status
  useEffect(() => {
    const handleNetworkStatus = (status: { online: boolean }) => {
      setIsOnline(status.online);
    };

    networkStatusService.addNetworkStatusListener(handleNetworkStatus);

    // Set initial status
    setIsOnline(networkStatusService.isCurrentlyOnline());

    return () => {
      networkStatusService.removeNetworkStatusListener(handleNetworkStatus);
    };
  }, []);

  // Auto-sync functionality
  useEffect(() => {
    if (autoSyncEnabled) {
      // Sync every 30 seconds but only when online
      const interval = setInterval(() => {
        if (networkStatusService.isCurrentlyOnline()) {
          syncFromAPI().catch(console.error);
        }
      }, 30000);

      setSyncIntervalId(interval);

      return () => {
        if (interval) {
          clearInterval(interval);
        }
      };
    } else if (syncIntervalId) {
      clearInterval(syncIntervalId);
      setSyncIntervalId(null);
    }
  }, [autoSyncEnabled, messages]);

  const toggleAutoSync = () => {
    setAutoSyncEnabled(!autoSyncEnabled);
  };

  const syncFromAPI = async () => {
    try {
      setSyncing(true);

      // Set up API client
      const apiClient = new UnifiedAIClient({
        aiConfig: aiConfig,
        prismApiUrl: aiConfig?.apiUrl || process.env.NEXT_PUBLIC_API_URL
      });

      // Get synced data from API
      const syncedDataResult = await apiClient.getSyncedData();
      if (!syncedDataResult.success) {
        console.error('Failed to get synced data:', syncedDataResult.error);
        alert(`Failed to get synced data: ${syncedDataResult.error}`);
        return;
      }

      // Update messages
      if (syncedDataResult.data?.messages) {
        dispatch(setMessages(syncedDataResult.data.messages));
      }

      // Update sessions
      if (syncedDataResult.data?.sessions) {
        dispatch(setSessions(syncedDataResult.data.sessions));
      }

      // Note: The API currently doesn't sync AI config, only messages, sessions, and prompts

      // Update prompt shortcuts if available
      if (syncedDataResult.data?.prompts) {
        // Process and save prompts to local storage or DB
        for (const prompt of syncedDataResult.data.prompts) {
          await savePromptShortcut(prompt);
        }
      }

      alert('Successfully synced from API!');
    } catch (error) {
      console.error('Error syncing from API:', error);
      alert(`Error syncing from API: ${error}`);
    } finally {
      setSyncing(false);
    }
  };

  const syncToAPI = async () => {
    try {
      setSyncing(true);

      // Set up API client
      const apiClient = new UnifiedAIClient({
        aiConfig: aiConfig,
        prismApiUrl: aiConfig?.apiUrl || process.env.NEXT_PUBLIC_API_URL
      });

      // Sync current messages
      const syncMessagesResult = await apiClient.syncMessages(messages);
      if (!syncMessagesResult.success) {
        console.error('Failed to sync messages:', syncMessagesResult.error);
        alert(`Failed to sync messages: ${syncMessagesResult.error}`);
        return;
      }

      // Sync current sessions
      const syncSessionsResult = await apiClient.syncSessions([
        {
          id: currentSessionId,
          userId: '', // This will be set by the server
          messages: messages,
          createdAt: Date.now(), // This will also be set by the server
          updatedAt: Date.now()
        }
      ]);
      if (!syncSessionsResult.success) {
        console.error('Failed to sync sessions:', syncSessionsResult.error);
        alert(`Failed to sync sessions: ${syncSessionsResult.error}`);
        return;
      }

      // Sync prompt shortcuts
      const promptShortcuts = await getPromptShortcuts();
      const syncPromptsResult = await apiClient.syncPrompts(promptShortcuts);
      if (!syncPromptsResult.success) {
        console.error('Failed to sync prompts:', syncPromptsResult.error);
        alert(`Failed to sync prompts: ${syncPromptsResult.error}`);
        return;
      }

      alert('Successfully synced to API!');
    } catch (error) {
      console.error('Error syncing to API:', error);
      alert(`Error syncing to API: ${error}`);
    } finally {
      setSyncing(false);
    }
  };

  const renderSettings = () => (
    <div className="mb-6 p-4 bg-gray-100 rounded-lg">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">AI Settings</h2>
        <button
          onClick={() => setShowSettings(false)}
          className="text-gray-500 hover:text-gray-700"
        >
          ✕
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">AI Provider</label>
          <select
            value={aiConfig.provider}
            onChange={(e) => handleUpdateAIConfig({ provider: e.target.value as any })}
            className="w-full p-2 border rounded"
          >
            <option value="prism-api">Prism API</option>
            <option value="openai">OpenAI (ChatGPT)</option>
            <option value="gemini">Google Gemini</option>
            <option value="qwen">Alibaba Qwen</option>
          </select>
        </div>

        {aiConfig.provider !== 'prism-api' && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">API Key</label>
              <input
                type="password"
                value={aiConfig.apiKey || ''}
                onChange={(e) => handleUpdateAIConfig({ apiKey: e.target.value })}
                placeholder={`Enter ${aiConfig.provider} API key`}
                className="w-full p-2 border rounded"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <input
                type="text"
                value={aiConfig.model || ''}
                onChange={(e) => handleUpdateAIConfig({ model: e.target.value })}
                placeholder="e.g., gpt-3.5-turbo, gemini-pro, qwen-max"
                className="w-full p-2 border rounded"
              />
            </div>
          </>
        )}

        {aiConfig.provider === 'prism-api' && (
          <div>
            <label className="block text-sm font-medium mb-1">Prism API URL</label>
            <input
              type="text"
              value={aiConfig.apiUrl || ''}
              onChange={(e) => handleUpdateAIConfig({ apiUrl: e.target.value })}
              placeholder="Enter Prism API URL"
              className="w-full p-2 border rounded"
            />
          </div>
        )}

        {/* Image Generation Settings */}
        <div>
          <label className="block text-sm font-medium mb-1">Hugging Face API Key</label>
          <input
            type="password"
            value={imageGenerationApiKey}
            onChange={(e) => setImageGenerationApiKey(e.target.value)}
            placeholder="Enter your Hugging Face API key"
            className="w-full p-2 border rounded"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Image Generation Model</label>
          <select
            value={imageGenerationModel}
            onChange={(e) => setImageGenerationModel(e.target.value)}
            className="w-full p-2 border rounded"
          >
            <option value="stabilityai/stable-diffusion-2-1">Stable Diffusion 2.1</option>
            <option value="runwayml/stable-diffusion-v1-5">Stable Diffusion 1.5</option>
            <option value="stabilityai/stable-diffusion-xl-base-1.0">SDXL</option>
            <option value="black-forest-labs/FLUX.1-schnell">FLUX Schnell</option>
            <option value="black-forest-labs/FLUX.1-dev">FLUX Dev</option>
          </select>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4">
      <div className="mb-2 flex justify-between items-center">
        <h1 className="text-2xl font-bold">Prism AI</h1>
        <div className="flex gap-2 items-center">
          <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span className="text-sm">{isOnline ? 'Online' : 'Offline'}</span>
          <button
            onClick={syncFromAPI}
            disabled={syncing || !isOnline}
            className="text-green-500 hover:text-green-700 disabled:opacity-50"
          >
            {syncing ? 'Syncing...' : '🔄 Sync from Extension'}
          </button>
          <button
            onClick={syncToAPI}
            disabled={syncing || !isOnline}
            className="text-blue-500 hover:text-blue-700 disabled:opacity-50"
          >
            {syncing ? 'Syncing...' : '📤 Sync to Extension'}
          </button>
          <button
            onClick={toggleAutoSync}
            disabled={!isOnline}
            className={`${autoSyncEnabled ? 'text-red-500' : 'text-gray-500'} hover:text-blue-700 disabled:opacity-50`}
          >
            {autoSyncEnabled ? '⏸️ Stop Auto-Sync' : '▶️ Start Auto-Sync'}
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="text-blue-500 hover:text-blue-700"
          >
            ⚙️ Settings
          </button>
          {isAuthenticated ? (
            <div className="flex items-center gap-2">
              <span className="text-sm">Welcome, {user?.displayName || user?.email}</span>
              <button
                onClick={signOut}
                className="text-red-500 hover:text-red-700"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              onClick={signInWithGoogle}
              className="text-blue-500 hover:text-blue-700"
            >
              Sign In with Google
            </button>
          )}
        </div>
      </div>

      {showSettings && renderSettings()}

      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`p-4 rounded-lg max-w-[80%] ${
              msg.role === 'user'
                ? 'ml-auto bg-blue-500 text-white'
                : 'mr-auto bg-gray-200'
            }`}
          >
             <ReactMarkdown
               remarkPlugins={[remarkGfm]}
               components={{
                 code({node, inline, className, children, ...props}) {
                   const match = /language-(\w+)/.exec(className || '');
                   if (!inline && match && match[1] === 'mermaid') {
                     return (
                       <div className="mermaid-container my-2 p-4 bg-gray-800 rounded-lg border border-gray-600 overflow-x-auto">
                         <MermaidRenderer chart={String(children).replace(/\n$/, '')} />
                       </div>
                     );
                   }
                   return !inline && match ? (
                     <SyntaxHighlighter
                       style={atomDark}
                       language={match[1]}
                       PreTag="div"
                       className="rounded-lg my-2"
                       {...props}
                     >
                       {String(children).replace(/\n$/, '')}
                     </SyntaxHighlighter>
                   ) : (
                     <code className={className} {...props}>
                       {children}
                     </code>
                   );
                 },
                 table({children, ...props}) {
                   const handleExport = () => {
                     const table = props as unknown as HTMLTableElement;
                     if (!table) return;
                     const rows = Array.from(table.querySelectorAll('tr'));
                     const csv = rows.map(row =>
                       Array.from(row.querySelectorAll('td, th'))
                         .map(cell => `"${cell.textContent?.replace(/"/g, '""')}"`)
                         .join(',')
                     ).join('\n');
                     
                     const blob = new Blob([csv], { type: 'text/csv' });
                     const url = URL.createObjectURL(blob);
                     const a = document.createElement('a');
                     a.href = url;
                     a.download = `table-${Date.now()}.csv`;
                     document.body.appendChild(a);
                     a.click();
                     document.body.removeChild(a);
                     URL.revokeObjectURL(url);
                   };

                   return (
                     <div className="table-container my-2 overflow-x-auto">
                       <div className="flex justify-end mb-1">
                         <button onClick={handleExport} className="px-2 py-1 bg-gray-700 text-white text-xs rounded hover:bg-gray-600">
                           📥 Export CSV
                         </button>
                       </div>
                       <table className="w-full border-collapse text-sm" {...props}>
                         {children}
                       </table>
                     </div>
                   );
                 }
               }}
             >
               {msg.content}
             </ReactMarkdown>
          </div>
        ))}
      </div>

      {generatedImage ? (
        <div className="mb-4 p-4 bg-gray-100 rounded-lg flex flex-col items-center">
          <h3 className="text-lg font-medium mb-2">Generated Image</h3>
          <img
            src={generatedImage}
            alt="Generated"
            className="max-w-full h-auto rounded-lg border border-gray-300 mb-2"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setGeneratedImage(null)}
              className="bg-gray-500 text-white px-4 py-2 rounded-lg"
            >
              Generate New
            </button>
            <button
              onClick={() => {
                // Create a download link for the image
                const link = document.createElement('a');
                link.href = generatedImage;
                link.download = `generated-image-${Date.now()}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
              className="bg-blue-500 text-white px-4 py-2 rounded-lg"
            >
              Download
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-4 p-4 bg-gray-100 rounded-lg">
          <div className="flex gap-2">
            <input
              type="text"
              value={imageGenerationPrompt}
              onChange={(e) => setImageGenerationPrompt(e.target.value)}
              placeholder="Enter image generation prompt..."
              className="flex-1 border rounded-lg px-4 py-2"
              disabled={isGeneratingImage}
            />
            <button
              onClick={generateImage}
              disabled={isGeneratingImage || !imageGenerationPrompt.trim() || !imageGenerationApiKey}
              className="bg-purple-500 text-white px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {isGeneratingImage ? 'Generating...' : 'Generate Image'}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder="Ask anything..."
          className="flex-1 border rounded-lg px-4 py-2"
          disabled={loading}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="bg-blue-500 text-white px-6 py-2 rounded-lg disabled:opacity-50"
        >
          {loading ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}