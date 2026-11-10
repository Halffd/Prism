import { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { colors, spacing } from '../theme/nocturnal-editorial';
import { StatusBar } from '../components/status-bar';
import { MessageList } from '../components/message-list';
import { ChatInput } from '../components/chat-input';
import { Spinner } from '../components/spinner';
import { SettingsScreen } from '../screens/settings-screen';
import { CharacterSelect } from '../screens/character-select';
import { useChat } from '../hooks/use-chat';
import { useSettings } from '../hooks/use-settings';
import { useSillyTavern } from '../hooks/use-silly-tavern';
import { TUIClient } from '../lib/tui-client';
import { runTUIAgent } from '../lib/tui-agent';
import { TUIRagSession } from '../lib/tui-rag';
import {
  conversationsDir,
  deleteConversation,
  listConversations,
  loadConversation,
  persistChat,
} from '../lib/core-store';
import { mcpConfigPath, mcpSessionOnce } from '../lib/mcp';
import { nanoid } from 'nanoid';
import type {
  Message,
  CouncilMember,
  MultiSendTarget,
  DebateParticipant,
} from '@prism/shared-types';

type Screen = 'chat' | 'settings' | 'characters';

export function ChatScreen() {
  const { exit } = useApp();
  const chat = useChat();
  const settings = useSettings();
  const st = useSillyTavern();
  const [screen, setScreen] = useState<Screen>('chat');

  const clientRef = useRef<TUIClient | null>(null);
  // Session-scoped RAG store (ingest via /rag <path>, retrieval on send)
  const ragSessionRef = useRef<TUIRagSession>(
    new TUIRagSession(settings.aiConfig),
  );
  // Shared conversation vault (core's store — the Slint app and the CLI
  // read the same files). Vault id grows with the chat; /vault commands
  // manage listing/loading/saving by hand.
  const vaultDirRef = useRef<string | null>(conversationsDir());
  const vaultIdRef = useRef<string | null>(null);
  const [vaultLabel, setVaultLabel] = useState<string>('');
  if (!clientRef.current) {
    clientRef.current = new TUIClient({
      aiConfig: settings.aiConfig,
      adapterMode: settings.adapterMode,
      capabilityModes: settings.capabilityModes,
      localApiUrl: settings.localApiUrl,
      localSearchProvider: settings.localSearchProvider,
      searxngUrl: settings.searxngUrl,
      hardware: settings.aiConfig.hardware,
    });
  }

  useEffect(() => {
    clientRef.current?.updateConfig({
      aiConfig: settings.aiConfig,
      adapterMode: settings.adapterMode,
      capabilityModes: settings.capabilityModes,
      localApiUrl: settings.localApiUrl,
      localSearchProvider: settings.localSearchProvider,
      searxngUrl: settings.searxngUrl,
      hardware: settings.aiConfig.hardware,
    });
  }, [
    settings.aiConfig,
    settings.adapterMode,
    settings.capabilityModes,
    settings.localApiUrl,
    settings.localSearchProvider,
    settings.searxngUrl,
  ]);

  const performWebSearch = useCallback(
    async (query: string): Promise<string | null> => {
      const result = await clientRef.current!.webSearch(query, 5);
      if (result.ok && result.value.results.length > 0) {
        chat.setSearchResults(result.value.results);
        return result.value.results
          .map((r, i) => `[${i + 1}] ${r.title}: ${r.snippet}`)
          .join('\n');
      }
      return null;
    },
    [chat],
  );

  const performDeepSearch = useCallback(
    async (query: string): Promise<string | null> => {
      chat.setDeepSearchInProgress(true);
      chat.clearSearchResults();
      try {
        const result = await clientRef.current!.deepSearch(query, (phase) => {
          chat.addDeepSearchPhase(phase);
        });
        if (result.ok) {
          chat.setSearchResults(result.value.sources);
          return result.value.answer;
        }
      } finally {
        chat.setDeepSearchInProgress(false);
      }
      return null;
    },
    [chat],
  );

  const performCouncil = useCallback(
    async (query: string): Promise<string | null> => {
      chat.setCouncilInProgress(true);
      chat.setCouncilResponse(null);
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
        const result = await clientRef.current!.council(query, members);
        if (result.ok) {
          chat.setCouncilResponse(result.value);
          return result.value.verdict.winnerContent;
        }
      } finally {
        chat.setCouncilInProgress(false);
      }
      return null;
    },
    [chat],
  );

  const performMultiSend = useCallback(
    async (query: string): Promise<string | null> => {
      chat.setMultiSendInProgress(true);
      chat.setMultiSendResponse(null);
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
        const history = chat.messages.filter(
          (m) => m.id !== chat.messages[chat.messages.length - 1]?.id,
        );
        const result = await clientRef.current!.multiSend(
          query,
          targets,
          history,
        );
        if (result.ok) {
          chat.setMultiSendResponse(result.value);
          const firstValid = result.value.responses.find((r) => !r.error);
          return firstValid?.content ?? null;
        }
      } finally {
        chat.setMultiSendInProgress(false);
      }
      return null;
    },
    [chat],
  );

  const performDebate = useCallback(
    async (topic: string): Promise<string | null> => {
      chat.setDebateInProgress(true);
      chat.setDebateResult(null);
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
        const result = await clientRef.current!.debate(
          topic,
          participants,
          'dual',
          6,
          (turn, turnIndex, totalTurns) => {
            chat.addDebateTurn(turn);
          },
        );
        if (result.ok) {
          chat.setDebateResult(result.value);
          const parts: string[] = [];
          for (const turn of result.value.turns) {
            if (!turn.error && turn.content) {
              parts.push(
                `[${turn.participant.label || turn.participant.provider}]: ${turn.content}`,
              );
            }
          }
          if (result.value.summary) {
            parts.push(`\n--- Summary ---\n${result.value.summary}`);
          }
          return parts.join('\n\n');
        }
      } finally {
        chat.setDebateInProgress(false);
      }
      return null;
    },
    [chat],
  );

  const performAgent = useCallback(
    async (task: string): Promise<string | null> => {
      chat.setAgentInProgress(true);
      chat.setAgentResult(null);
      try {
        // TUI-owned agent runtime: Node tools (shell/read_file) gated by the
        // permission policy with a y/n ask prompt on the terminal.
        const result = await runTUIAgent(
          { task, maxSteps: 10 },
          {
            aiConfig: settings.aiConfig,
            defaultToolPermission: settings.defaultToolPermission ?? 'ask',
            onAsk: async (toolName, input) => {
              const rl = (await import('readline')).createInterface({
                input: process.stdin,
                output: process.stdout,
              });
              const answer = await new Promise<string>((resolve) => {
                rl.question(
                  `\n[permission] Allow ${toolName} with input "${input}"? (y/n) `,
                  resolve,
                );
              });
              rl.close();
              return answer.trim().toLowerCase().startsWith('y');
            },
          },
        );
        if (result.ok) {
          chat.setAgentResult(result.value);
          const parts: string[] = [result.value.answer];
          if (result.value.steps.length > 0) {
            parts.push('\n--- Agent Steps ---');
            for (const step of result.value.steps) {
              parts.push(
                `Thought: ${step.thought}\nAction: ${step.action}\nObservation: ${step.observation}`,
              );
            }
          }
          return parts.join('\n\n');
        }
        chat.addMessage({
          id: `msg_${nanoid()}`,
          role: 'assistant',
          content: `[Agent error: ${result.error}]`,
          timestamp: Date.now(),
        });
        return null;
      } finally {
        chat.setAgentInProgress(false);
      }
    },
    [chat, settings],
  );

  const handleSend = useCallback(async () => {
    const content = chat.input.trim();
    if (content.length === 0) return;

    // /mcp — report the connected MCP servers and the tools they add
    // to the agent's advertised surface (connect once per process).
    if (content === '/mcp' || content.startsWith('/mcp ')) {
      chat.setInput('');
      const { session, errors } = await mcpSessionOnce();
      const filePath = mcpConfigPath();
      if (!session) {
        chat.addMessage({
          id: `msg_${nanoid()}`,
          role: 'assistant',
          content:
            errors.length > 0
              ? `[mcp] no server reachable (${filePath}):\n${errors.join('\n')}`
              : `[mcp] no configuration — add an "mcpServers" entry to ${filePath}`,
          timestamp: Date.now(),
        });
        return;
      }
      const byServer = new Map<string, string[]>();
      for (const [advertised, ref] of Object.entries(session.toolMap)) {
        const list = byServer.get(ref.server) ?? [];
        list.push(advertised);
        byServer.set(ref.server, list);
      }
      const lines = [`[mcp] ${byServer.size} server(s), ${session.tools.length} tool(s):`];
      for (const [server, toolsAdvertised] of byServer) {
        lines.push(`  ${server}: ${toolsAdvertised.join(', ')}`);
      }
      for (const e of errors) {
        lines.push(`  failed: ${e}`);
      }
      chat.addMessage({
        id: `msg_${nanoid()}`,
        role: 'assistant',
        content: lines.join('\n'),
        timestamp: Date.now(),
      });
      return;
    }

    // /vault <help|list|save|open <id>|delete <id>> — the shared
    // conversation vault (the core's store; Slint and the CLI read the
    // same files). Autosave covers the common path; these commands give
    // explicit control.
    if (content === '/vault' || content.startsWith('/vault ')) {
      chat.setInput('');
      const arg = content.slice(6).trim();
      const dir = vaultDirRef.current;
      const reply = (text: string) =>
        chat.addMessage({
          id: `msg_${nanoid()}`,
          role: 'assistant',
          content: text,
          timestamp: Date.now(),
        });
      if (arg === '' || arg === 'help') {
        reply(
          [
            'vault — the shared conversation store (prism/conversations)',
            '  /vault list           newest-first ids + titles',
            '  /vault save           persist the current chat, print its id',
            '  /vault open <id>      load a conversation into the chat',
            '  /vault delete <id>    remove one conversation file',
          ].join('\n'),
        );
      } else if (arg === 'list') {
        const metas = listConversations(dir);
        reply(
          metas.length === 0
            ? 'vault is empty'
            : metas
                .slice(0, 10)
                .map(
                  (m) =>
                    `${m.id}  ${new Date(m.updated_at).toISOString()}  ${m.title}`,
                )
                .join('\n'),
        );
      } else if (arg === 'save') {
        const res = persistChat(dir, vaultIdRef.current, chat.messages);
        if (res.error) {
          reply(`[vault save failed: ${res.error}]`);
        } else {
          vaultIdRef.current = res.id;
          const meta = listConversations(dir).find((m) => m.id === res.id);
          setVaultLabel(`vault ${res.id}`);
          reply(`saved as ${res.id}${meta ? ` — “${meta.title}”` : ''}`);
        }
      } else if (arg.startsWith('open ')) {
        const id = arg.slice(5).trim();
        const conv = loadConversation(dir, id);
        if (!conv) {
          reply(`[vault: no conversation ${JSON.stringify(id)}]`);
        } else {
          chat.clearMessages();
          for (const m of conv.messages) {
            chat.addMessage({
              id: `msg_${nanoid()}`,
              role: m.role as Message['role'],
              content: m.content,
              timestamp: Date.now(),
            });
          }
          vaultIdRef.current = conv.id;
          setVaultLabel(`vault ${conv.id}`);
          reply(
            `opened ${conv.id} (“${conv.title}”, ${conv.messages.length} messages)`,
          );
        }
      } else if (arg.startsWith('delete ')) {
        const id = arg.slice(7).trim();
        reply(
          deleteConversation(dir, id)
            ? `deleted ${id}`
            : `[vault: could not delete ${JSON.stringify(id)}]`,
        );
      } else {
        reply(`[vault: unknown command ${JSON.stringify(arg)} — try /vault help]`);
      }
      return;
    }

    // /rag <path> — ingest a local file into the session's RAG store
    if (content.startsWith('/rag ')) {
      const path = content.slice(5).trim();
      chat.setInput('');
      try {
        const doc = await ragSessionRef.current.ingestPath(path);
        chat.addMessage({
          id: `msg_${nanoid()}`,
          role: 'assistant',
          content: `Ingested ${doc.title}: ${doc.chunkCount} chunks indexed. Ask about it and the relevant chunks will be retrieved.`,
          timestamp: Date.now(),
        });
      } catch (err) {
        chat.addMessage({
          id: `msg_${nanoid()}`,
          role: 'assistant',
          content: `[RAG ingest failed: ${(err as Error).message}]`,
          timestamp: Date.now(),
        });
      }
      return;
    }

    const userMessage: Message = {
      id: `msg_${nanoid()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
      characterId: st.activeCharacterId ?? undefined,
    };

    chat.addMessage(userMessage);
    chat.setInput('');
    chat.setLoading(true);

    try {
      if (chat.councilEnabled) {
        const councilResult = await performCouncil(content);
        if (councilResult) {
          const assistantMessage: Message = {
            id: `msg_${nanoid()}`,
            role: 'assistant',
            content: councilResult,
            timestamp: Date.now(),
          };
          chat.addMessage(assistantMessage);
        }
      } else if (chat.debateEnabled) {
        const debateResult = await performDebate(content);
        if (debateResult) {
          const assistantMessage: Message = {
            id: `msg_${nanoid()}`,
            role: 'assistant',
            content: debateResult,
            timestamp: Date.now(),
          };
          chat.addMessage(assistantMessage);
        }
      } else if (chat.multiSendEnabled) {
        const msResult = await performMultiSend(content);
        if (msResult) {
          const assistantMessage: Message = {
            id: `msg_${nanoid()}`,
            role: 'assistant',
            content: msResult,
            timestamp: Date.now(),
          };
          chat.addMessage(assistantMessage);
        }
      } else if (chat.agentEnabled) {
        const agentResult = await performAgent(content);
        if (agentResult) {
          const assistantMessage: Message = {
            id: `msg_${nanoid()}`,
            role: 'assistant',
            content: agentResult,
            timestamp: Date.now(),
          };
          chat.addMessage(assistantMessage);
        }
      } else {
        let enhancedContent = content;

        if (chat.deepSearchEnabled) {
          const deepResult = await performDeepSearch(content);
          if (deepResult) {
            enhancedContent =
              content +
              `\n\n[Research Findings]\n${deepResult}\n\nBased on the research above, respond to the user's query:`;
          }
        } else if (chat.webSearchEnabled) {
          const searchResult = await performWebSearch(content);
          if (searchResult) {
            enhancedContent =
              content +
              `\n\n[Web Search Results]\n${searchResult}\n\nUsing the search results above, respond to the user's query:`;
          }
        }

        const searchUserMessage: Message = {
          ...userMessage,
          content: enhancedContent,
        };

        const assistantMessage = await clientRef.current!.chat([
          ...chat.messages.filter((m) => m.id !== userMessage.id),
          searchUserMessage,
        ]);
        chat.addMessage(assistantMessage);
      }
    } catch (err) {
      const errorMessage: Message = {
        id: `msg_${nanoid()}`,
        role: 'assistant',
        content: `[Error: ${err instanceof Error ? err.message : String(err)}]`,
        timestamp: Date.now(),
      };
      chat.addMessage(errorMessage);
    } finally {
      chat.setLoading(false);
    }
  }, [
    chat,
    st.activeCharacterId,
    performWebSearch,
    performDeepSearch,
    performCouncil,
    performMultiSend,
    performDebate,
    performAgent,
  ]);

  // Debounced autosave: every time the chat grows, persist the full
  // history to the vault (same files as Slint/CLI) after a short idle.
  // Only runs when there is something storable; a small gap keeps
  // streaming updates from hitting the disk on every token.
  const messageCount = chat.messages.length;
  useEffect(() => {
    if (messageCount < 2) {
      return;
    }
    const timer = setTimeout(() => {
      const res = persistChat(
        vaultDirRef.current,
        vaultIdRef.current,
        chat.messages,
      );
      if (!res.error) {
        if (vaultIdRef.current !== res.id) {
          vaultIdRef.current = res.id;
          setVaultLabel(`vault ${res.id}`);
        }
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [messageCount, chat.messages]);

  useInput((input, key) => {
    if (screen !== 'chat') return;

    if (key.escape) {
      if (settings.showSettings) {
        settings.setShowSettings(false);
        setScreen('chat');
      } else {
        setScreen('settings');
        settings.setShowSettings(true);
      }
      return;
    }

    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    if (key.ctrl && input === 'n') {
      // A fresh session starts detached from any vault conversation;
      // the next autosave (or /vault save) creates a new id.
      vaultIdRef.current = null;
      setVaultLabel('');
      chat.newSession();
      return;
    }

    if (key.ctrl && input === 'k') {
      chat.clearMessages();
      return;
    }

    if (key.ctrl && input === 'a') {
      setScreen((prev) => (prev === 'characters' ? 'chat' : 'characters'));
      return;
    }

    if (key.ctrl && input === 'w') {
      chat.toggleWebSearch();
      return;
    }

    if (key.ctrl && input === 'd') {
      chat.toggleDeepSearch();
      return;
    }

    if (key.ctrl && input === 'v') {
      chat.toggleCouncil();
      return;
    }

    if (key.ctrl && input === 'm') {
      chat.toggleMultiSend();
      return;
    }

    if (key.ctrl && input === 'b') {
      chat.toggleDebate();
      return;
    }
  });

  const characterNames: Record<string, string> = {};
  st.characters.forEach((c) => {
    characterNames[c.name] = c.name;
  });

  if (screen === 'settings') {
    return (
      <SettingsScreen
        provider={settings.aiConfig.provider}
        model={settings.aiConfig.model}
        adapterMode={settings.adapterMode}
        capabilityModes={settings.capabilityModes}
        localApiUrl={settings.localApiUrl}
        localSearchProvider={settings.localSearchProvider}
        searxngUrl={settings.searxngUrl}
        defaultToolPermission={settings.defaultToolPermission}
        hardware={settings.aiConfig.hardware}
        onSetProvider={settings.setProvider}
        onSetAdapterMode={settings.setAdapterMode}
        onSetCapabilityMode={settings.setCapabilityMode}
        onSetLocalApiUrl={settings.setLocalApiUrl}
        onSetLocalSearchProvider={settings.setLocalSearchProvider}
        onSetSearxngUrl={settings.setSearxngUrl}
        onSetModel={settings.setModel}
        onSetDefaultToolPermission={settings.setDefaultToolPermission}
        onSetHardware={settings.setHardware}
        onClose={() => {
          settings.setShowSettings(false);
          setScreen('chat');
        }}
      />
    );
  }

  if (screen === 'characters') {
    return (
      <CharacterSelect
        characters={st.characters}
        activeCharacterId={st.activeCharacterId}
        activeCharacterIds={st.activeCharacterIds}
        isGroupChat={st.isGroupChat}
        onSelect={st.setActiveCharacter}
        onAddToGroup={st.addCharacterToGroup}
        onRemoveFromGroup={st.removeCharacterFromGroup}
        onToggleGroupChat={st.toggleGroupChat}
        onClose={() => setScreen('chat')}
      />
    );
  }

  const activeCharName = st.activeCharacterId
    ? characterNames[st.activeCharacterId]
    : undefined;

  const searchModeLabel = chat.deepSearchEnabled
    ? 'DEEP SEARCH'
    : chat.webSearchEnabled
      ? 'WEB SEARCH'
      : null;

  const sessionTokens = chat.messages.reduce(
    (sum, m) => sum + (m.tokens ?? Math.ceil(m.content.length / 4)),
    0,
  );
  const assistantWithMetrics = [...chat.messages]
    .reverse()
    .find((m) => m.role === 'assistant' && m.metrics);
  const tpsSamples = chat.messages
    .map((m) => m.metrics?.tokensPerSecond)
    .filter((t): t is number => typeof t === 'number' && t > 0);
  const avgTokensPerSecond =
    tpsSamples.length > 0
      ? tpsSamples.reduce((a, b) => a + b, 0) / tpsSamples.length
      : undefined;

  return (
    <Box flexDirection="column">
      <StatusBar
        provider={settings.aiConfig.provider}
        model={settings.aiConfig.model}
        adapterMode={settings.adapterMode}
        activeCharacter={activeCharName}
        isGroupChat={st.isGroupChat}
        messageCount={chat.messages.length}
        isOnline={true}
        sessionTokens={sessionTokens}
        avgTokensPerSecond={avgTokensPerSecond}
        lastMetrics={assistantWithMetrics?.metrics ?? null}
        vaultLabel={vaultLabel || undefined}
      />

      {searchModeLabel && (
        <Box paddingX={spacing.lg}>
          <Text
            color={
              chat.deepSearchEnabled
                ? colors.tertiary
                : chat.councilEnabled ||
                    chat.multiSendEnabled ||
                    chat.debateEnabled
                  ? colors.on_surface
                  : colors.primary
            }
            bold
          >
            {searchModeLabel} ON
          </Text>
        </Box>
      )}

      {chat.deepSearchInProgress && chat.deepSearchPhases.length > 0 && (
        <Box flexDirection="column" paddingX={spacing.lg}>
          {chat.deepSearchPhases.slice(-4).map((phase, i) => (
            <Text key={i} color={colors.outline_variant}>
              {phase.type === 'query'
                ? '🔍'
                : phase.type === 'search'
                  ? '🔎'
                  : phase.type === 'extract'
                    ? '📄'
                    : phase.type === 'validate'
                      ? '🧩'
                      : phase.type === 'synthesize'
                        ? '✨'
                        : '⏳'}{' '}
              {phase.type.replace(/_/g, ' ')}
              {phase.query ? `: ${phase.query.slice(0, 40)}` : ''}
            </Text>
          ))}
        </Box>
      )}

      {chat.councilInProgress && (
        <Box paddingX={spacing.lg}>
          <Spinner label="Council deliberating..." />
        </Box>
      )}

      {chat.councilResponse && !chat.councilInProgress && (
        <Box flexDirection="column" paddingX={spacing.lg}>
          <Text color={colors.primary} bold>
            Council Verdict: {chat.councilResponse.verdict.winnerProvider}
            {chat.councilResponse.verdict.winnerModel
              ? `/${chat.councilResponse.verdict.winnerModel}`
              : ''}
          </Text>
          <Text color={colors.on_surface_variant}>
            {chat.councilResponse.verdict.reasoning.slice(0, 100)}
          </Text>
          <Text color={colors.outline_variant}>
            {chat.councilResponse.responses.filter((r) => !r.error).length}/
            {chat.councilResponse.responses.length} members responded
          </Text>
        </Box>
      )}

      {chat.multiSendInProgress && (
        <Box paddingX={spacing.lg}>
          <Spinner label="Multi-sending to AIs..." />
        </Box>
      )}

      {chat.multiSendResponse && !chat.multiSendInProgress && (
        <Box flexDirection="column" paddingX={spacing.lg}>
          <Text color={colors.on_surface} bold>
            Multi-Send:{' '}
            {chat.multiSendResponse.responses.filter((r) => !r.error).length}/
            {chat.multiSendResponse.responses.length} responded
          </Text>
          {chat.multiSendResponse.responses
            .filter((r) => !r.error)
            .map((r, i) => (
              <Text key={i} color={colors.outline_variant}>
                {r.label || r.provider}
                {r.model ? `/${r.model}` : ''}: {r.content.slice(0, 60)}...
              </Text>
            ))}
        </Box>
      )}

      {chat.debateInProgress && (
        <Box paddingX={spacing.lg}>
          <Spinner label="AI debate in progress..." />
        </Box>
      )}

      {chat.debateResult && !chat.debateInProgress && (
        <Box flexDirection="column" paddingX={spacing.lg}>
          <Text color={colors.primary} bold>
            Debate: {chat.debateResult.turns.filter((t) => !t.error).length}{' '}
            turns
          </Text>
          {chat.debateResult.turns
            .filter((t) => !t.error)
            .slice(-4)
            .map((t, i) => (
              <Text key={i} color={colors.outline_variant}>
                {t.participant.label || t.participant.provider}:{' '}
                {t.content.slice(0, 80)}...
              </Text>
            ))}
          {chat.debateResult.summary && (
            <Text color={colors.on_surface_variant}>
              Summary: {chat.debateResult.summary.slice(0, 100)}
            </Text>
          )}
        </Box>
      )}

      {chat.agentInProgress && (
        <Box paddingX={spacing.lg}>
          <Spinner label="Agent running..." />
        </Box>
      )}

      {chat.agentResult && !chat.agentInProgress && (
        <Box flexDirection="column" paddingX={spacing.lg}>
          <Text color={colors.primary} bold>
            Agent: {chat.agentResult.steps.length} steps
          </Text>
          {chat.agentResult.steps.slice(-3).map((s, i) => (
            <Text key={i} color={colors.outline_variant}>
              Step {i + 1}: {s.action.slice(0, 60)}
            </Text>
          ))}
        </Box>
      )}

      {chat.searchResults.length > 0 && !chat.deepSearchInProgress && (
        <Box flexDirection="column" paddingX={spacing.lg}>
          <Text color={colors.on_surface_variant} bold>
            Search Results:
          </Text>
          {chat.searchResults.slice(0, 3).map((r, i) => (
            <Text key={i} color={colors.outline_variant}>
              [{i + 1}] {r.title.slice(0, 50)} - {r.domain}
            </Text>
          ))}
        </Box>
      )}

      <Box flexDirection="column" paddingY={spacing.xs}>
        {chat.isLoading && chat.messages.length > 0 && (
          <Box paddingX={spacing.lg}>
            <Spinner label="Generating..." />
          </Box>
        )}
        <MessageList
          messages={chat.messages}
          isStreaming={chat.isLoading}
          characterNames={characterNames}
        />
      </Box>

      <ChatInput
        value={chat.input}
        onChange={chat.setInput}
        onSubmit={handleSend}
        isLoading={chat.isLoading}
        placeholder="Type a message..."
      />

      <Box paddingX={spacing.lg} paddingBottom={spacing.xs}>
        <Text color={colors.outline_variant} dimColor>
          Ctrl+N: new | Ctrl+K: clear | Ctrl+A: chars | Ctrl+W: web | Ctrl+D:
          deep | Ctrl+V: council | Ctrl+M: multi | Ctrl+B: debate | Ctrl+G:
          agent | Esc: settings | Ctrl+C: quit
        </Text>
      </Box>
    </Box>
  );
}
