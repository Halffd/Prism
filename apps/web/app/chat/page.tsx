'use client';

import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { UnifiedAIClient } from '@prism/api-client';
import {
  saveChatHistory,
  loadChatHistory,
  getChatSessions,
  deleteChatSession,
  setCache,
  getCache,
  ChatSession
} from '@prism/shared-db';
import { ImageGenerationService } from '@prism/image-gen';
import type { Message, ContextData, AIConfig } from '@prism/shared-types';

// Initialize with default settings - will be overridden by stored settings
const defaultAIConfig: AIConfig = {
  provider: 'prism-api',
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api'
};

let client: UnifiedAIClient;

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiConfig, setAiConfig] = useState<AIConfig>(defaultAIConfig);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => {
    // Generate a default session ID based on timestamp
    return `session_${Date.now()}`;
  });

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
        setAiConfig(config);
        client = new UnifiedAIClient({
          aiConfig: config,
          prismApiUrl: config.apiUrl
        });
      } catch (error) {
        console.error('Failed to load AI config, using default:', error);
        client = new UnifiedAIClient({ aiConfig: defaultAIConfig });
      }
    } else {
      client = new UnifiedAIClient({ aiConfig: defaultAIConfig });
    }

    // Load chat history from database
    loadChatHistoryFromDB();
  }, []);

  useEffect(() => {
    // Save chat to database when messages change
    if (messages.length > 0) {
      saveCurrentChatToDB(messages);
    }
  }, [messages]);

  const loadChatHistoryFromDB = async () => {
    try {
      const history = await loadChatHistory(currentSessionId);
      setMessages(history);
    } catch (error) {
      console.error('Failed to load chat history from database:', error);
      // Fallback to localStorage if database fails
      const savedMessages = localStorage.getItem('chatHistory');
      if (savedMessages) {
        setMessages(JSON.parse(savedMessages));
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
      const newMessages = [...messages, imageMessage];
      setMessages(newMessages);
      saveCurrentChatToDB(newMessages);

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

  const updateAIConfig = (config: AIConfig) => {
    setAiConfig(config);
    localStorage.setItem('aiConfig', JSON.stringify(config));
    client = new UnifiedAIClient({
      aiConfig: config,
      prismApiUrl: config.apiUrl
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

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      // Check if we have a cached response
      const cachedResponse = await getCachedResponse(input);
      if (cachedResponse) {
        setMessages(prev => [...prev, cachedResponse]);
        return;
      }

      // Get page context from browser
      const pageContext: ContextData = {
        type: 'page',
        url: window.location.href,
        title: document.title,
        selectedText: window.getSelection()?.toString()
      };

      const response = await client.sendMessage(input, pageContext);

      if (response.success && response.data) {
        setMessages(prev => [...prev, response.data!]);
        // Cache the response
        await setCachedResponse(input, response.data!);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const [showSettings, setShowSettings] = useState(false);

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
            onChange={(e) => updateAIConfig({ ...aiConfig, provider: e.target.value as any })}
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
                onChange={(e) => updateAIConfig({ ...aiConfig, apiKey: e.target.value })}
                placeholder={`Enter ${aiConfig.provider} API key`}
                className="w-full p-2 border rounded"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <input
                type="text"
                value={aiConfig.model || ''}
                onChange={(e) => updateAIConfig({ ...aiConfig, model: e.target.value })}
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
              onChange={(e) => updateAIConfig({ ...aiConfig, apiUrl: e.target.value })}
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
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="text-blue-500 hover:text-blue-700"
        >
          ⚙️ Settings
        </button>
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
                  return !inline && match ? (
                    <SyntaxHighlighter
                      style={atomDark}
                      language={match[1]}
                      PreTag="div"
                      {...props}
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                  ) : (
                    <code className={className} {...props}>
                      {children}
                    </code>
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