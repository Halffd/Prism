import { useState, useCallback } from 'react';
import type {
  Message,
  WebSearchResultItem,
  DeepSearchPhase,
  CouncilResponse,
  MultiSendResponse,
  DebateResult,
  DebateTurn,
  AgentResult,
} from '@prism/shared-types';

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  currentSessionId: string;
  input: string;
  webSearchEnabled: boolean;
  deepSearchEnabled: boolean;
  searchResults: WebSearchResultItem[];
  deepSearchPhases: DeepSearchPhase[];
  deepSearchInProgress: boolean;
  councilEnabled: boolean;
  councilInProgress: boolean;
  councilResponse: CouncilResponse | null;
  multiSendEnabled: boolean;
  multiSendInProgress: boolean;
  multiSendResponse: MultiSendResponse | null;
  debateEnabled: boolean;
  debateInProgress: boolean;
  debateResult: DebateResult | null;
  debateTurns: DebateTurn[];
  agentEnabled: boolean;
  agentInProgress: boolean;
  agentResult: AgentResult | null;
}

export function useChat() {
  const [state, setState] = useState<ChatState>({
    messages: [],
    isLoading: false,
    currentSessionId: `tui_session_${Date.now()}`,
    input: '',
    webSearchEnabled: false,
    deepSearchEnabled: false,
    searchResults: [],
    deepSearchPhases: [],
    deepSearchInProgress: false,
    councilEnabled: false,
    councilInProgress: false,
    councilResponse: null,
    multiSendEnabled: false,
    multiSendInProgress: false,
    multiSendResponse: null,
    debateEnabled: false,
    debateInProgress: false,
    debateResult: null,
    debateTurns: [],
    agentEnabled: false,
    agentInProgress: false,
    agentResult: null,
  });

  const addMessage = useCallback((message: Message) => {
    setState((prev) => ({ ...prev, messages: [...prev.messages, message] }));
  }, []);

  const updateLastAssistantMessage = useCallback((content: string) => {
    setState((prev) => {
      const msgs = [...prev.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          msgs[i] = { ...msgs[i], content };
          break;
        }
      }
      return { ...prev, messages: msgs };
    });
  }, []);

  const setLoading = useCallback((isLoading: boolean) => {
    setState((prev) => ({ ...prev, isLoading }));
  }, []);

  const setInput = useCallback((input: string) => {
    setState((prev) => ({ ...prev, input }));
  }, []);

  const clearMessages = useCallback(() => {
    setState((prev) => ({ ...prev, messages: [] }));
  }, []);

  const newSession = useCallback(() => {
    setState({
      messages: [],
      isLoading: false,
      currentSessionId: `tui_session_${Date.now()}`,
      input: '',
      webSearchEnabled: false,
      deepSearchEnabled: false,
      searchResults: [],
      deepSearchPhases: [],
      deepSearchInProgress: false,
      councilEnabled: false,
      councilInProgress: false,
      councilResponse: null,
      multiSendEnabled: false,
      multiSendInProgress: false,
      multiSendResponse: null,
      debateEnabled: false,
      debateInProgress: false,
      debateResult: null,
      debateTurns: [],
      agentEnabled: false,
      agentInProgress: false,
      agentResult: null,
    });
  }, []);

  const toggleWebSearch = useCallback(() => {
    setState((prev) => ({
      ...prev,
      webSearchEnabled: !prev.webSearchEnabled,
      deepSearchEnabled: false,
      councilEnabled: false,
      multiSendEnabled: false,
      debateEnabled: false,
      agentEnabled: false,
      searchResults: [],
      deepSearchPhases: [],
    }));
  }, []);

  const toggleDeepSearch = useCallback(() => {
    setState((prev) => ({
      ...prev,
      deepSearchEnabled: !prev.deepSearchEnabled,
      webSearchEnabled: false,
      councilEnabled: false,
      multiSendEnabled: false,
      debateEnabled: false,
      agentEnabled: false,
      searchResults: [],
      deepSearchPhases: [],
    }));
  }, []);

  const toggleCouncil = useCallback(() => {
    setState((prev) => ({
      ...prev,
      councilEnabled: !prev.councilEnabled,
      webSearchEnabled: false,
      deepSearchEnabled: false,
      multiSendEnabled: false,
      debateEnabled: false,
      agentEnabled: false,
      searchResults: [],
      deepSearchPhases: [],
    }));
  }, []);

  const setCouncilInProgress = useCallback((inProgress: boolean) => {
    setState((prev) => ({ ...prev, councilInProgress: inProgress }));
  }, []);

  const setCouncilResponse = useCallback((response: CouncilResponse | null) => {
    setState((prev) => ({ ...prev, councilResponse: response }));
  }, []);

  const toggleMultiSend = useCallback(() => {
    setState((prev) => ({
      ...prev,
      multiSendEnabled: !prev.multiSendEnabled,
      webSearchEnabled: false,
      deepSearchEnabled: false,
      councilEnabled: false,
      debateEnabled: false,
      agentEnabled: false,
      searchResults: [],
      deepSearchPhases: [],
    }));
  }, []);

  const toggleDebate = useCallback(() => {
    setState((prev) => ({
      ...prev,
      debateEnabled: !prev.debateEnabled,
      webSearchEnabled: false,
      deepSearchEnabled: false,
      councilEnabled: false,
      multiSendEnabled: false,
      agentEnabled: false,
      searchResults: [],
      deepSearchPhases: [],
    }));
  }, []);

  const toggleAgent = useCallback(() => {
    setState((prev) => ({
      ...prev,
      agentEnabled: !prev.agentEnabled,
      webSearchEnabled: false,
      deepSearchEnabled: false,
      councilEnabled: false,
      multiSendEnabled: false,
      debateEnabled: false,
      searchResults: [],
      deepSearchPhases: [],
    }));
  }, []);

  const setDebateInProgress = useCallback((inProgress: boolean) => {
    setState((prev) => ({ ...prev, debateInProgress: inProgress }));
  }, []);

  const setDebateResult = useCallback((result: DebateResult | null) => {
    setState((prev) => ({ ...prev, debateResult: result }));
  }, []);

  const addDebateTurn = useCallback((turn: DebateTurn) => {
    setState((prev) => ({ ...prev, debateTurns: [...prev.debateTurns, turn] }));
  }, []);

  const setAgentInProgress = useCallback((inProgress: boolean) => {
    setState((prev) => ({ ...prev, agentInProgress: inProgress }));
  }, []);

  const setAgentResult = useCallback((result: AgentResult | null) => {
    setState((prev) => ({ ...prev, agentResult: result }));
  }, []);

  const setMultiSendInProgress = useCallback((inProgress: boolean) => {
    setState((prev) => ({ ...prev, multiSendInProgress: inProgress }));
  }, []);

  const setMultiSendResponse = useCallback(
    (response: MultiSendResponse | null) => {
      setState((prev) => ({ ...prev, multiSendResponse: response }));
    },
    [],
  );

  const setSearchResults = useCallback((results: WebSearchResultItem[]) => {
    setState((prev) => ({ ...prev, searchResults: results }));
  }, []);

  const addDeepSearchPhase = useCallback((phase: DeepSearchPhase) => {
    setState((prev) => ({
      ...prev,
      deepSearchPhases: [...prev.deepSearchPhases, phase],
    }));
  }, []);

  const setDeepSearchInProgress = useCallback((inProgress: boolean) => {
    setState((prev) => ({ ...prev, deepSearchInProgress: inProgress }));
  }, []);

  const clearSearchResults = useCallback(() => {
    setState((prev) => ({ ...prev, searchResults: [], deepSearchPhases: [] }));
  }, []);

  return {
    ...state,
    addMessage,
    updateLastAssistantMessage,
    setLoading,
    setInput,
    clearMessages,
    newSession,
    toggleWebSearch,
    toggleDeepSearch,
    setSearchResults,
    addDeepSearchPhase,
    setDeepSearchInProgress,
    clearSearchResults,
    toggleCouncil,
    setCouncilInProgress,
    setCouncilResponse,
    toggleMultiSend,
    setMultiSendInProgress,
    setMultiSendResponse,
    toggleDebate,
    setDebateInProgress,
    setDebateResult,
    addDebateTurn,
    toggleAgent,
    setAgentInProgress,
    setAgentResult,
  };
}
