import React, { useState, useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { MermaidRenderer, Icon } from '@prism/ui-components';
import { UnifiedAIClient } from '@prism/api-client';
import { selectAutoModel } from '@prism/ai-adapters';
import {
  saveChatHistory,
  loadChatHistory,
  getChatSessions,
  deleteChatSession,
} from '@prism/shared-db';
import type { Message, AIConfig } from '@prism/shared-types';
import {
  setMessages,
  addMessage,
  setLoading,
  setCurrentSessionId,
  setSessions,
  setChatSelectedProvider as setSelectedProvider,
  updateAIConfig as updateAIConfigAction,
  setAIConfig,
  setGroupChatActive,
  setSpeakingCharacter,
  setAddressedCharacters,
  clearPendingCharacters,
  advanceGroupChatTurn,
  RootState,
} from '@prism/redux-store';
import { ChatInputBar } from '../components/ChatInputBar';
import { ChatMessageEnhanced } from '../components/ChatMessageEnhanced';
import { assembleContext } from '@prism/context-manager';
import { CharacterSelector } from '../components/CharacterSelector';
import { PersonaSelector } from '../components/PersonaSelector';
import { PromptPresetManager } from '../components/PromptPresetManager';
import { WorldInfoManager } from '../components/WorldInfoManager';
import { WebSearchPanel } from '../components/WebSearchPanel';
import { ErrorModalHost } from '../components/ErrorModal';
import { CouncilPanel } from '../components/CouncilPanel';
import { MultiSendPanel } from '../components/MultiSendPanel';
import { DebatePanel } from '../components/DebatePanel';
import { AgentRunnerPanel } from '../components/AgentRunnerPanel';
import type {
  WebSearchResultItem,
  DeepSearchPhase,
  CouncilMember,
  CouncilResponse,
  MultiSendTarget,
  MultiSendResponse,
  DebateParticipant,
  DebateResult,
  AgentResult,
} from '@prism/shared-types';
import './ChatPage.scss';
import '../components/WebSearchPanel.scss';

// Initialize with default settings - will be overridden by stored settings
const defaultAIConfig: AIConfig = {
  provider: 'openai',
  apiUrl: 'http://localhost:3000/api',
};

let client = new UnifiedAIClient({ aiConfig: defaultAIConfig });

export function ChatPage() {
  const dispatch = useDispatch();
  const {
    messages,
    loading,
    currentSessionId,
    sessions,
    selectedProvider: reduxSelectedProvider,
  } = useSelector((state: RootState) => state.chat);
  const { config: reduxAIConfig } = useSelector(
    (state: RootState) => state.aiConfig,
  );
  const lowSpecMode = reduxAIConfig.lowSpecMode === true;
  const { context: reduxContext } = useSelector(
    (state: RootState) => state.context,
  );
  const {
    characters,
    activeCharacterId,
    activeCharacterIds,
    groupChatMode,
    groupChatTurnOrder,
    groupChatCurrentTurnIndex,
  } = useSelector((state: RootState) => state.characters);
  const { personas, activePersonaId } = useSelector(
    (state: RootState) => state.personas,
  );
  const { presets, activePresetId } = useSelector(
    (state: RootState) => state.presets,
  );
  const { worldInfoList, activeWorldInfoId, entries } = useSelector(
    (state: RootState) => state.worldInfo,
  );
  const groupChatState = useSelector((state: RootState) => state.groupChat);

  const [input, setInput] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showCharacterSelector, setShowCharacterSelector] = useState(false);
  const [showPersonaSelector, setShowPersonaSelector] = useState(false);
  const [showPresetManager, setShowPresetManager] = useState(false);
  const [showWorldInfoManager, setShowWorldInfoManager] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [deepSearchEnabled, setDeepSearchEnabled] = useState(false);
  const [searchResults, setSearchResults] = useState<WebSearchResultItem[]>([]);
  const [deepSearchPhases, setDeepSearchPhases] = useState<DeepSearchPhase[]>(
    [],
  );
  const [deepSearchInProgress, setDeepSearchInProgress] = useState(false);
  const [councilEnabled, setCouncilEnabled] = useState(false);
  const [councilInProgress, setCouncilInProgress] = useState(false);
  const [councilResponse, setCouncilResponse] =
    useState<CouncilResponse | null>(null);
  const [multiSendEnabled, setMultiSendEnabled] = useState(false);
  const [multiSendInProgress, setMultiSendInProgress] = useState(false);
  const [multiSendResponse, setMultiSendResponse] =
    useState<MultiSendResponse | null>(null);
  const [debateEnabled, setDebateEnabled] = useState(false);
  const [debateInProgress, setDebateInProgress] = useState(false);
  const [debateResult, setDebateResult] = useState<DebateResult | null>(null);
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const { agents: customAgents, activeAgentId } = useSelector(
    (state: RootState) => state.agents,
  );
  const [theme, setTheme] = useState<
    'dark' | 'light' | 'high-contrast' | 'monokai' | 'material' | 'github'
  >('dark');

  // Load persisted theme from display settings
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const { getSetting } = await import('@prism/shared-db');
        const settings = await getSetting<{
          theme?:
            | 'dark'
            | 'light'
            | 'high-contrast'
            | 'monokai'
            | 'material'
            | 'github';
        }>('displaySettings');
        if (settings?.theme) setTheme(settings.theme);
      } catch {
        /* keep default dark theme */
      }
    };
    loadTheme();
  }, []);
  const [agentInProgress, setAgentInProgress] = useState(false);
  const [agentResult, setAgentResult] = useState<AgentResult | null>(null);
  const [agentStep, setAgentStep] = useState<number>(0);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const selectedProvider = reduxSelectedProvider;

  const [historyMissing, setHistoryMissing] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load AI configuration from chrome storage
    chrome.storage.local.get(['aiConfig'], (result) => {
      if (result.aiConfig) {
        try {
          const config = result.aiConfig as AIConfig;
          dispatch(setAIConfig(config));
          dispatch(setSelectedProvider(config.provider));
          client = new UnifiedAIClient({
            aiConfig: config,
            prismApiUrl: config.apiUrl,
          });
        } catch (error) {
          console.error('Failed to load AI config, using default:', error);
          dispatch(setAIConfig(defaultAIConfig));
          dispatch(setSelectedProvider(defaultAIConfig.provider));
          client = new UnifiedAIClient({ aiConfig: defaultAIConfig });
        }
      } else {
        dispatch(setAIConfig(defaultAIConfig));
        dispatch(setSelectedProvider(defaultAIConfig.provider));
        client = new UnifiedAIClient({ aiConfig: defaultAIConfig });
      }
    });

    // Load chat sessions
    loadChatSessionsFromDB();

    // Load current chat history
    loadChatHistoryFromDB();
  }, [dispatch]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadChatHistoryFromDB = async () => {
    try {
      const history = await loadChatHistory(currentSessionId);
      dispatch(setMessages(history));
    } catch (error) {
      console.error('Failed to load chat history from database:', error);
      dispatch(setMessages([]));
      setHistoryMissing(true);
    }
  };

  const loadChatSessionsFromDB = async () => {
    try {
      const sessions = await getChatSessions();
      dispatch(
        setSessions(
          sessions.map((s) => ({
            id: s.id,
            userId: '',
            title: s.title,
            messages: [],
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          })),
        ),
      );
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
      dispatch(setSessions([]));
    }
  };

  const saveCurrentChatToDB = async (newMessages: Message[]) => {
    try {
      await saveChatHistory(currentSessionId, newMessages);
      // Refresh sessions list after saving
      loadChatSessionsFromDB();
    } catch (error) {
      console.error('Failed to save chat to database:', error);
    }
  };

  const switchToSession = async (sessionId: string) => {
    dispatch(setCurrentSessionId(sessionId));
    try {
      const history = await loadChatHistory(sessionId);
      if (history && Array.isArray(history)) {
        dispatch(setMessages(history));
      } else {
        dispatch(setMessages([]));
        setHistoryMissing(true);
      }
    } catch (error) {
      console.error('Failed to load session:', error);
      dispatch(setMessages([]));
      setHistoryMissing(true);
    }
  };

  const createNewSession = () => {
    const newSessionId = `session_${Date.now()}`;
    dispatch(setCurrentSessionId(newSessionId));
    dispatch(setMessages([]));
  };

  const deleteSession = async (sessionId: string) => {
    if (window.confirm('Are you sure you want to delete this chat session?')) {
      try {
        await deleteChatSession(sessionId);
        loadChatSessionsFromDB();
        // If we're deleting the current session, create a new one
        if (sessionId === currentSessionId) {
          createNewSession();
        }
      } catch (error) {
        console.error('Failed to delete session:', error);
      }
    }
  };

  // Simple token estimation function (roughly 1 token = 4 characters or 1 word)
  const estimateTokenCount = (text: string): number => {
    if (!text || text.length === 0) return 0;

    // Simple estimation: split by whitespace
    const words = text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0);
    // Rough estimation: about 1 token per word, but longer words might be multiple tokens
    let tokenCount = 0;
    for (const word of words) {
      // For longer words, count as multiple tokens (common in tokenizers)
      if (word.length <= 4) {
        tokenCount += 1;
      } else {
        // Estimate: 1 token per 4-5 characters
        tokenCount += Math.ceil(word.length / 4);
      }
    }
    return Math.max(1, tokenCount);
  };

  const performWebSearch = async (query: string): Promise<string | null> => {
    try {
      const searchResponse = await client.webSearch({ query, maxResults: 5 });
      if (searchResponse.success && searchResponse.data) {
        setSearchResults(searchResponse.data.results);
        setShowSearchPanel(true);
        if (searchResponse.data.results.length === 0) return null;
        return searchResponse.data.results
          .map((r, i) => `[${i + 1}] ${r.title}: ${r.snippet}`)
          .join('\n');
      }
    } catch (e) {
      console.error('Web search failed:', e);
    }
    return null;
  };

  const performDeepSearch = async (query: string): Promise<string | null> => {
    setDeepSearchInProgress(true);
    setDeepSearchPhases([]);
    try {
      const response = await client.deepSearch({
        query,
        maxDepth: 3,
        maxSearches: 5,
        maxExtractions: 8,
        onPhaseUpdate: (phase) => {
          setDeepSearchPhases((prev) => [...prev, phase]);
        },
      });
      if (response.success && response.data) {
        setSearchResults(response.data.sources);
        setShowSearchPanel(true);
        return response.data.answer;
      }
    } catch (e) {
      console.error('Deep search failed:', e);
    } finally {
      setDeepSearchInProgress(false);
    }
    return null;
  };

  const performCouncil = async (
    query: string,
  ): Promise<CouncilResponse | null> => {
    setCouncilInProgress(true);
    try {
      const members: CouncilMember[] = [
        { provider: 'openai', model: 'gpt-4o', label: 'GPT-4o' },
        {
          provider: 'claude',
          model: 'claude-sonnet-4-20250514',
          label: 'Claude',
        },
        { provider: 'gemini', model: 'gemini-2.0-flash', label: 'Gemini' },
      ];
      const response = await client.council({
        prompt: query,
        members,
        votingStrategy: 'single-judge',
        judgeProvider: selectedProvider || 'openai',
        systemPrompt: reduxAIConfig.systemPrompt,
        onMemberUpdate: (member, status) => {
          console.log(
            `[Council] ${member.label || member.provider}: ${status}`,
          );
        },
      });
      if (response.success && response.data) {
        setCouncilResponse(response.data);
        return response.data;
      }
    } catch (e) {
      console.error('Council deliberation failed:', e);
    } finally {
      setCouncilInProgress(false);
    }
    return null;
  };

  const performMultiSend = async (
    query: string,
  ): Promise<MultiSendResponse | null> => {
    setMultiSendInProgress(true);
    try {
      const targets: MultiSendTarget[] = [
        { provider: 'openai', model: 'gpt-4o', label: 'GPT-4o' },
        {
          provider: 'claude',
          model: 'claude-sonnet-4-20250514',
          label: 'Claude',
        },
        { provider: 'gemini', model: 'gemini-2.0-flash', label: 'Gemini' },
      ];
      const response = await client.multiSend({
        prompt: query,
        targets,
        systemPrompt: reduxAIConfig.systemPrompt,
        onTargetUpdate: (target, status) => {
          console.log(
            `[MultiSend] ${target.label || target.provider}: ${status}`,
          );
        },
      });
      if (response.success && response.data) {
        setMultiSendResponse(response.data);
        return response.data;
      }
    } catch (e) {
      console.error('Multi-send failed:', e);
    } finally {
      setMultiSendInProgress(false);
    }
    return null;
  };

  const performDebate = async (topic: string): Promise<DebateResult | null> => {
    setDebateInProgress(true);
    try {
      const participants: DebateParticipant[] = [
        {
          provider: 'openai',
          model: 'gpt-4o',
          label: 'GPT-4o',
          stance: 'support',
        },
        {
          provider: 'claude',
          model: 'claude-sonnet-4-20250514',
          label: 'Claude',
          stance: 'oppose',
        },
      ];
      const response = await client.debate({
        topic,
        participants,
        mode: 'dual',
        maxTurns: 6,
        systemPrompt: reduxAIConfig.systemPrompt,
        onTurnUpdate: (turn, turnIndex, totalTurns) => {
          console.log(
            `[Debate] Turn ${turnIndex}/${totalTurns}: ${turn.participant.label || turn.participant.provider} - ${turn.error ? 'Error' : 'Done'}`,
          );
        },
      });
      if (response.success && response.data) {
        setDebateResult(response.data);
        return response.data;
      }
    } catch (e) {
      console.error('Debate failed:', e);
    } finally {
      setDebateInProgress(false);
    }
    return null;
  };

  const performAgent = async (task: string): Promise<AgentResult | null> => {
    setAgentInProgress(true);
    setAgentResult(null);
    setAgentStep(0);
    try {
      // Carry the active custom agent's personality + core memories
      const activeAgent = customAgents.find((a) => a.id === activeAgentId);
      const request: Parameters<typeof client.agent>[0] = {
        task,
        maxSteps: 10,
        personality: activeAgent?.personality,
        memories: activeAgent?.coreMemories,
      };
      const response = await client.agent(request);
      if (response.success && response.data) {
        setAgentResult(response.data);
        setAgentStep(response.data.steps.length);
        return response.data;
      }
    } catch (e) {
      console.error('Agent run failed:', e);
    } finally {
      setAgentInProgress(false);
    }
    return null;
  };

  const sendMessage = async () => {
    if (!input.trim()) return;

    const result = await chrome.storage.local.get(['displaySettings']);
    const settings = result.displaySettings;
    const totalMessageTokenLimit = settings?.totalMessageTokenLimit || 20000;

    const totalTokens = estimateTokenCount(input);

    if (totalTokens > totalMessageTokenLimit) {
      alert(
        `Message exceeds token limit. Current: ${totalTokens} tokens, Limit: ${totalMessageTokenLimit} tokens. Please reduce the message size.`,
      );
      return;
    }

    const activeCharacter =
      characters.find((c) => c.id === activeCharacterId) ?? undefined;
    const activePersona =
      personas.find((p) => p.id === activePersonaId) ?? undefined;
    const activePreset =
      presets.find((p) => p.id === activePresetId) ?? undefined;
    const activeWorldInfo =
      worldInfoList.find((w) => w.id === activeWorldInfoId) ?? undefined;
    void activeWorldInfo;
    const activeEntries = activeWorldInfoId
      ? (entries[activeWorldInfoId] ?? [])
      : [];

    // Determine if we're in group chat mode
    const isGroupChat = activeCharacterIds.length > 1 && groupChatMode !== null;

    // Resolve characters for group chat
    const groupCharacters = isGroupChat
      ? (activeCharacterIds
          .map((id) => characters.find((c) => c.id === id))
          .filter(Boolean) as typeof characters)
      : [];

    const assembled = assembleContext({
      systemPrompt: '',
      messages,
      character: isGroupChat ? undefined : activeCharacter,
      characters: isGroupChat ? groupCharacters : undefined,
      persona: activePersona,
      preset: activePreset,
      worldInfoEntries: activeEntries,
      userMessage: input,
      config: {
        maxTokens: 4096,
        worldInfoTokenBudget: 2048,
        worldInfoScanDepth: 50,
        worldInfoRecursive: true,
        groupChat: isGroupChat
          ? {
              includeAllCharacters: groupChatMode === 'round-robin',
              characterSeparator: '\n---\n',
              characterTokenBudget: 1024,
            }
          : undefined,
      },
    });

    const systemPrompt = assembled.systemPrompt;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
      tokens: totalTokens,
      context: reduxContext ?? undefined,
    };

    dispatch(addMessage(userMessage));
    setInput('');
    dispatch(setLoading(true));

    try {
      const tempConfig = {
        ...reduxAIConfig,
        provider: selectedProvider,
        thinkingMode: { enabled: thinkingEnabled },
      };
      client.updateAIConfig(tempConfig);

      if (isGroupChat) {
        // Group chat send flow
        dispatch(setGroupChatActive(true));

        // Determine speaking character for round-robin
        const speakingCharacterId =
          groupChatMode === 'round-robin'
            ? groupChatTurnOrder[groupChatCurrentTurnIndex]
            : undefined;

        dispatch(setSpeakingCharacter(speakingCharacterId ?? null));

        // For selective mode, set addressed characters
        const addressedIds =
          groupChatMode === 'selective'
            ? groupChatState.addressedCharacterIds
            : undefined;

        const groupResponse = await client.sendGroupMessage(
          input,
          groupChatMode!,
          groupCharacters,
          assembled,
          currentSessionId,
          undefined, // images
          {
            speakingCharacterId,
            addressedCharacterIds: addressedIds,
            maxResponsesPerTurn: groupCharacters.length,
          },
        );

        if (groupResponse.success && groupResponse.data) {
          const groupMessages = groupResponse.data.messages;
          for (const msg of groupMessages) {
            dispatch(addMessage(msg));
          }

          // Advance round-robin turn after successful response
          if (groupChatMode === 'round-robin') {
            dispatch(advanceGroupChatTurn());
          }

          await saveCurrentChatToDB([
            ...messages,
            userMessage,
            ...groupMessages,
          ]);
        }

        dispatch(clearPendingCharacters());
      } else if (councilEnabled) {
        // Council deliberation flow
        const councilResult = await performCouncil(input);
        if (councilResult) {
          const councilMessage: Message = {
            id: Date.now().toString(),
            role: 'assistant',
            content: `**Council Verdict** (${councilResult.verdict.strategy})\n\n**Winner: ${councilResult.verdict.winnerProvider}${councilResult.verdict.winnerModel ? `/${councilResult.verdict.winnerModel}` : ''}**\n\n${councilResult.verdict.winnerContent}\n\n---\n${councilResult.verdict.reasoning}`,
            timestamp: Date.now(),
          };
          dispatch(addMessage(councilMessage));
          await saveCurrentChatToDB([...messages, userMessage, councilMessage]);
        }
      } else if (multiSendEnabled) {
        // Multi-send flow
        const msResult = await performMultiSend(input);
        if (msResult) {
          const swipes = client.multiSendToSwipes(msResult);
          const msMessage: Message = {
            id: Date.now().toString(),
            role: 'assistant',
            content: swipes[0]?.content || msResult.responses[0]?.content || '',
            timestamp: Date.now(),
          };
          dispatch(addMessage(msMessage));
          await saveCurrentChatToDB([...messages, userMessage, msMessage]);
        }
      } else if (debateEnabled) {
        // AI debate flow
        const debateData = await performDebate(input);
        if (debateData) {
          const parts: string[] = [];
          for (const turn of debateData.turns) {
            if (!turn.error && turn.content) {
              parts.push(
                `**${turn.participant.label || turn.participant.provider}**: ${turn.content}`,
              );
            }
          }
          if (debateData.summary) {
            parts.push(`\n--- **Summary** ---\n${debateData.summary}`);
          }
          const debateMessage: Message = {
            id: Date.now().toString(),
            role: 'assistant',
            content: parts.join('\n\n'),
            timestamp: Date.now(),
          };
          dispatch(addMessage(debateMessage));
          await saveCurrentChatToDB([...messages, userMessage, debateMessage]);
        }
      } else if (agentEnabled) {
        // Custom agent flow
        const agentData = await performAgent(input);
        if (agentData) {
          const stepsSummary =
            agentData.steps.length > 0
              ? `\n\n<details><summary>${agentData.steps.length} reasoning steps</summary>\n${agentData.steps.map((s, i) => `**Step ${i + 1}**: ${s.thought}\nAction: ${s.action}\n${s.action !== 'Final Answer' ? 'Observation: ' + s.observation : ''}`).join('\n\n')}\n</details>`
              : '';
          const agentMessage: Message = {
            id: Date.now().toString(),
            role: 'assistant',
            content: agentData.answer + stepsSummary,
            timestamp: Date.now(),
          };
          dispatch(addMessage(agentMessage));
          await saveCurrentChatToDB([...messages, userMessage, agentMessage]);
        }
      } else {
        // Web search or deep search injection
        let searchContext = '';
        if (deepSearchEnabled) {
          const deepResult = await performDeepSearch(input);
          if (deepResult) {
            searchContext = `\n\n[Research Findings]\n${deepResult}\n\nBased on the research above, respond to the user's query:`;
          }
        } else if (webSearchEnabled) {
          const searchResult = await performWebSearch(input);
          if (searchResult) {
            searchContext = `\n\n[Web Search Results]\n${searchResult}\n\nUsing the search results above, respond to the user's query:`;
          }
        }

        const enhancedInput = searchContext ? input + searchContext : input;

        // Single character send flow (original behavior)
        const response = await client.sendMessage(
          enhancedInput,
          {
            ...(reduxContext ?? { type: 'page' as const }),
            systemPrompt,
          },
          currentSessionId,
        );

        if (response.success && response.data) {
          dispatch(addMessage(response.data));

          await saveCurrentChatToDB([...messages, userMessage, response.data]);

          if (reduxAIConfig.provider !== selectedProvider) {
            client.updateAIConfig(reduxAIConfig);
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      dispatch(setLoading(false));
    }
  };

  const clearHistory = async () => {
    dispatch(setMessages([]));
    await saveCurrentChatToDB([]);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({
      behavior: lowSpecMode ? 'auto' : 'smooth',
    });
  };

  const copyMessageToClipboard = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      // Optionally show a toast notification or visual feedback
      console.log('Message copied to clipboard');
    } catch (err) {
      console.error('Failed to copy message:', err);
    }
  };

  const copyCodeToClipboard = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      // Optionally show a toast notification or visual feedback
      console.log('Code copied to clipboard');
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const resendMessage = async (message: Message) => {
    if (message.role === 'user') {
      // Resend the user's message by putting it in the input field
      setInput(message.content);
    } else if (message.role === 'assistant') {
      // Find the corresponding user message and resend it
      const userMessageIndex = messages.findIndex(
        (msg, idx) => idx < messages.indexOf(message) && msg.role === 'user',
      );
      if (userMessageIndex !== -1) {
        setInput(messages[userMessageIndex].content);
      }
    }
  };

  const getRelativeTime = (timestamp: number): string => {
    const now = Date.now();
    const diffInSeconds = Math.floor((now - timestamp) / 1000);

    if (diffInSeconds < 60) {
      return 'just now';
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes}m ago`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours}h ago`;
    } else {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days}d ago`;
    }
  };

  const getTimeSinceLastMessage = (currentIndex: number): string | null => {
    if (currentIndex === 0) return null; // First message has no previous message

    const currentTimestamp = messages[currentIndex].timestamp;
    const previousTimestamp = messages[currentIndex - 1].timestamp;

    const diffInSeconds = Math.floor(
      (currentTimestamp - previousTimestamp) / 1000,
    );

    if (diffInSeconds < 60) {
      return `sent ${diffInSeconds}s after previous message`;
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `sent ${minutes}m after previous message`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `sent ${hours}h after previous message`;
    } else {
      const days = Math.floor(diffInSeconds / 86400);
      return `sent ${days}d after previous message`;
    }
  };

  // Render menu for switching sessions
  const renderMenu = () => (
    <div className="menu-overlay">
      <div className="menu-panel">
        <div className="menu-header">
          <h2>Chat Sessions</h2>
          <button onClick={() => setShowMenu(false)} className="close-btn">
            ✕
          </button>
        </div>

        <div className="menu-content">
          <div className="menu-section">
            <div className="session-actions">
              <button
                className="session-item new-session-btn"
                onClick={() => {
                  createNewSession();
                  setShowMenu(false);
                }}
              >
                + New Chat
              </button>
            </div>

            <div className="session-list">
              {sessions.map((session) => (
                <div key={session.id} className="session-item">
                  <button
                    onClick={() => {
                      switchToSession(session.id);
                      setShowMenu(false);
                    }}
                    className={session.id === currentSessionId ? 'active' : ''}
                  >
                    <div className="session-title">
                      {session.title || 'Untitled Chat'}
                    </div>
                    <div className="session-date">
                      {new Date(session.updatedAt).toLocaleDateString()}
                    </div>
                  </button>
                  <button
                    onClick={() => deleteSession(session.id)}
                    className="delete-session-btn"
                  >
                    🗑️
                  </button>
                </div>
              ))}

              {sessions.length === 0 && (
                <div className="no-sessions">No chat sessions yet</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={
        lowSpecMode ? 'chat-page-container low-spec' : 'chat-page-container'
      }
      data-theme={theme}
    >
      <div className="chat-header">
        <h1>💎 Prism Chat</h1>
        <div className="header-actions">
          <button
            onClick={() => {
              // Automatic model selection: pick a model from the provider's
              // cache (or the built-in known list) based on the current input.
              const auto = selectAutoModel(
                {
                  provider: selectedProvider,
                  inputTokens: estimateTokenCount(input),
                  hasImages: false,
                  capability: webSearchEnabled
                    ? 'web-search'
                    : deepSearchEnabled
                      ? 'deepsearch'
                      : councilEnabled
                        ? 'council'
                        : agentEnabled
                          ? 'agent'
                          : 'chat',
                },
                reduxAIConfig.modelCache,
              );
              if (auto) {
                dispatch(
                  updateAIConfigAction({
                    ...reduxAIConfig,
                    provider: selectedProvider,
                    model: auto,
                  }),
                );
              }
            }}
            className="provider-selector"
            title="Auto-select model for the current task"
          >
            <Icon name="bolt" title="Auto model" /> Auto
          </button>
          <select
            value={selectedProvider}
            onChange={(e) =>
              dispatch(
                setSelectedProvider(e.target.value as AIConfig['provider']),
              )
            }
            className="provider-selector"
          >
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
            <option value="claude">Claude</option>
            <option value="qwen">Qwen</option>
            <option value="prism-api">Prism API</option>
            <option value="koboldcpp">KoboldCPP</option>
            <option value="llamacpp">Llama.cpp</option>
            <option value="ollama">Ollama</option>
            <option value="sglang">SGLang</option>
            <option value="transformers">Transformers</option>
            <option value="deepseek">DeepSeek</option>
            <option value="grok">Grok</option>
            <option value="openrouter">OpenRouter</option>
            <option value="poe">Poe</option>
          </select>

          <button onClick={() => setShowMenu(true)} className="menu-btn">
            <Icon name="menu" title="Menu" />
          </button>
          <button onClick={clearHistory} className="clear-btn">
            <Icon name="delete" title="Clear chat" />
          </button>
        </div>
      </div>

      <div className="metrics-bar" data-testid="metrics-bar">
        <span className="metrics-item">
          {reduxAIConfig.provider}
          {reduxAIConfig.model ? ` · ${reduxAIConfig.model}` : ''}
        </span>
        {(() => {
          const tpsSamples = messages
            .map((m) => m.metrics?.tokensPerSecond)
            .filter((t): t is number => typeof t === 'number' && t > 0);
          if (tpsSamples.length === 0) return null;
          const avg = tpsSamples.reduce((a, b) => a + b, 0) / tpsSamples.length;
          return <span className="metrics-item">{avg.toFixed(1)} tok/s</span>;
        })()}
        {(() => {
          const last = [...messages]
            .reverse()
            .find((m) => m.role === 'assistant' && m.metrics);
          if (!last?.metrics) return null;
          return (
            <>
              {last.metrics.latencyMs ? (
                <span className="metrics-item">
                  {(last.metrics.latencyMs / 1000).toFixed(2)}s
                </span>
              ) : null}
              {last.metrics.totalTokens ? (
                <span className="metrics-item">
                  {last.metrics.totalTokens} tok
                </span>
              ) : null}
              {last.metrics.contextSize ? (
                <span className="metrics-item">
                  ctx {last.metrics.contextSize}
                </span>
              ) : null}
            </>
          );
        })()}
        {(() => {
          const sessionTokens = messages.reduce(
            (sum, m) => sum + (m.tokens ?? Math.ceil(m.content.length / 4)),
            0,
          );
          if (sessionTokens === 0) return null;
          return (
            <span className="metrics-item">session {sessionTokens} tok</span>
          );
        })()}
      </div>

      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="empty-state">
            <p>👋 Start a new conversation!</p>
            <p>Choose a provider and send your first message.</p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const currentMsgDate = new Date(msg.timestamp);
            const previousMsgDate =
              index > 0 ? new Date(messages[index - 1].timestamp) : null;
            const showDateSeparator =
              !previousMsgDate ||
              currentMsgDate.toDateString() !== previousMsgDate.toDateString();

            const timeString = currentMsgDate.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            });

            return (
              <React.Fragment key={msg.id}>
                {showDateSeparator && (
                  <div className="date-separator">
                    {currentMsgDate.toLocaleDateString([], {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </div>
                )}
                <div
                  className={`message ${msg.role === 'user' ? 'user' : 'assistant'}`}
                >
                  <div className="message-header">
                    <div className="timestamp-container">
                      <span className="message-timestamp">{timeString}</span>
                      <span className="relative-time">
                        {getRelativeTime(msg.timestamp)}
                      </span>
                    </div>
                    {msg.role === 'user' ? (
                      <button
                        className="copy-message-btn"
                        onClick={() => copyMessageToClipboard(msg.content)}
                        title="Copy message"
                      >
                        📋
                      </button>
                    ) : (
                      <>
                        <button
                          className="copy-message-btn"
                          onClick={() => copyMessageToClipboard(msg.content)}
                          title="Copy message"
                        >
                          📋
                        </button>
                        <button
                          className="resend-message-btn"
                          onClick={() => resendMessage(msg)}
                          title="Resend message"
                        >
                          ↪️
                        </button>
                      </>
                    )}
                  </div>
                  {index > 0 && (
                    <div className="time-since-previous">
                      {getTimeSinceLastMessage(index)}
                    </div>
                  )}
                  <div className="message-content">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({
                          inline,
                          className,
                          children,
                          ...props
                        }: {
                          inline?: boolean;
                          className?: string;
                          children?: React.ReactNode;
                        } & React.HTMLAttributes<HTMLElement>) {
                          const match = /language-(\w+)/.exec(className || '');
                          if (!inline && match && match[1] === 'mermaid') {
                            return (
                              <MermaidRenderer
                                chart={String(children).replace(/\n$/, '')}
                              />
                            );
                          }
                          return !inline && match ? (
                            <div className="code-block-wrapper">
                              <div className="code-header">
                                <span>{match[1]}</span>
                                <button
                                  className="copy-code-btn"
                                  onClick={() =>
                                    copyCodeToClipboard(String(children))
                                  }
                                  title="Copy code"
                                >
                                  📋
                                </button>
                              </div>
                              <SyntaxHighlighter
                                style={atomDark}
                                language={match[1]}
                                PreTag="div"
                                {...props}
                              >
                                {String(children).replace(/\n$/, '')}
                              </SyntaxHighlighter>
                            </div>
                          ) : (
                            <code className={className} {...props}>
                              {children}
                            </code>
                          );
                        },
                        table({ children, ...props }) {
                          const handleExport = () => {
                            const tableElement =
                              props as unknown as HTMLTableElement;
                            if (!tableElement) return;
                            const rows = Array.from(
                              tableElement.querySelectorAll('tr'),
                            );
                            const csv = rows
                              .map((row) =>
                                Array.from(row.querySelectorAll('td, th'))
                                  .map(
                                    (cell) =>
                                      `"${cell.textContent?.replace(/"/g, '""')}"`,
                                  )
                                  .join(','),
                              )
                              .join('\n');

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
                            <div className="table-container">
                              <div className="table-actions">
                                <button
                                  onClick={handleExport}
                                  title="Export CSV"
                                >
                                  📥 Export CSV
                                </button>
                              </div>
                              <table {...props}>{children}</table>
                            </div>
                          );
                        },
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                  <ChatMessageEnhanced
                    message={msg}
                    characterId={msg.characterId}
                    onRegenerate={() => resendMessage(msg)}
                    onContinue={() => {
                      const lastAssistant = [...messages]
                        .reverse()
                        .find((m) => m.role === 'assistant');
                      if (lastAssistant) resendMessage(lastAssistant);
                    }}
                  />
                  {msg.context && (
                    <div className="message-context">
                      🔗 {msg.context.title || msg.context.url}
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          })
        )}

        <div ref={messagesEndRef} />
      </div>

      {councilResponse && (
        <CouncilPanel
          response={councilResponse}
          inProgress={councilInProgress}
          onClose={() => setCouncilResponse(null)}
        />
      )}

      {multiSendResponse && (
        <MultiSendPanel
          response={multiSendResponse}
          inProgress={multiSendInProgress}
          onClose={() => setMultiSendResponse(null)}
        />
      )}

      {debateResult && (
        <DebatePanel
          result={debateResult}
          inProgress={debateInProgress}
          onClose={() => setDebateResult(null)}
        />
      )}

      {(agentResult || agentInProgress) && (
        <AgentRunnerPanel
          result={agentResult}
          inProgress={agentInProgress}
          currentStep={agentStep}
          maxSteps={undefined}
          onClose={() => {
            setAgentResult(null);
            setAgentStep(0);
          }}
        />
      )}

      {showSearchPanel &&
        (searchResults.length > 0 || deepSearchInProgress) && (
          <WebSearchPanel
            results={searchResults}
            deepSearchPhases={deepSearchPhases}
            deepSearchInProgress={deepSearchInProgress}
            onClose={() => setShowSearchPanel(false)}
          />
        )}

      <div className="input-container">
        <ChatInputBar
          onOpenCharacterSelector={() => setShowCharacterSelector(true)}
          onOpenPersonaSelector={() => setShowPersonaSelector(true)}
          onOpenPresetManager={() => setShowPresetManager(true)}
          onOpenWorldInfoManager={() => setShowWorldInfoManager(true)}
          onMentionCharacter={(characterId: string) => {
            // Toggle character in addressed list for selective mode
            const current = groupChatState.addressedCharacterIds;
            if (current.includes(characterId)) {
              dispatch(
                setAddressedCharacters(
                  current.filter((id) => id !== characterId),
                ),
              );
            } else {
              dispatch(setAddressedCharacters([...current, characterId]));
            }
          }}
        />
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="Type your message here..."
          disabled={loading}
          rows={3}
        />
        <div className="input-footer">
          <button
            onClick={() => {
              setWebSearchEnabled(!webSearchEnabled);
              if (!webSearchEnabled) {
                setDeepSearchEnabled(false);
                setCouncilEnabled(false);
                setMultiSendEnabled(false);
                setDebateEnabled(false);
                setAgentEnabled(false);
              }
            }}
            className={`mode-toggle-btn ${webSearchEnabled ? 'active' : ''}`}
            title="Web Search"
          >
            <Icon name="search" title="Web Search" />
          </button>
          <button
            onClick={() => {
              setDeepSearchEnabled(!deepSearchEnabled);
              if (!deepSearchEnabled) {
                setWebSearchEnabled(false);
                setCouncilEnabled(false);
                setMultiSendEnabled(false);
                setDebateEnabled(false);
                setAgentEnabled(false);
              }
            }}
            className={`mode-toggle-btn ${deepSearchEnabled ? 'active' : ''}`}
            title="Deep Research"
          >
            <Icon name="science" title="Deep Research" />
          </button>
          <button
            onClick={() => {
              setCouncilEnabled(!councilEnabled);
              if (!councilEnabled) {
                setWebSearchEnabled(false);
                setDeepSearchEnabled(false);
                setMultiSendEnabled(false);
                setDebateEnabled(false);
              }
            }}
            className={`mode-toggle-btn ${councilEnabled ? 'active' : ''}`}
            title="AI Council (multi-model voting)"
          >
            <Icon name="balance" title="AI Council" />
          </button>
          <button
            onClick={() => setThinkingEnabled(!thinkingEnabled)}
            className={`mode-toggle-btn ${thinkingEnabled ? 'active' : ''}`}
            title="Thinking mode (step-by-step reasoning; provider-native where supported)"
          >
            <Icon name="psychology" title="Thinking mode" />
          </button>
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="send-btn"
          >
            {agentInProgress
              ? 'Agent…'
              : debateInProgress
                ? 'Debate…'
                : multiSendInProgress
                  ? 'Multi…'
                  : councilInProgress
                    ? 'Council…'
                    : loading
                      ? '…'
                      : 'Send'}
          </button>
        </div>
      </div>

      {showMenu && renderMenu()}

      {showCharacterSelector && (
        <div
          className="st-editor-overlay"
          onClick={() => setShowCharacterSelector(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <CharacterSelector />
          </div>
        </div>
      )}

      {showPersonaSelector && (
        <div
          className="st-editor-overlay"
          onClick={() => setShowPersonaSelector(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <PersonaSelector />
          </div>
        </div>
      )}

      {showPresetManager && (
        <div
          className="st-editor-overlay"
          onClick={() => setShowPresetManager(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <PromptPresetManager />
          </div>
        </div>
      )}

      {showWorldInfoManager && (
        <div
          className="st-editor-overlay"
          onClick={() => setShowWorldInfoManager(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <WorldInfoManager />
          </div>
        </div>
      )}

      {historyMissing && (
        <ErrorModalHost onClose={() => setHistoryMissing(false)} />
      )}
    </div>
  );
}
