import { useState } from 'react';
import React from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, spacing } from '../theme/nocturnal-editorial';
import type {
  CustomAgent,
  AgentStrategy,
  AIProvider,
} from '@prism/shared-types';

interface AgentPickerProps {
  agents: CustomAgent[];
  activeAgentId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (agent: Partial<import('@prism/shared-types').CustomAgent>) => void;
  onEdit: (
    id: string,
    updates: Partial<import('@prism/shared-types').CustomAgent>,
  ) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function AgentPicker({
  agents,
  activeAgentId,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  onClose,
}: AgentPickerProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [view, setView] = useState<'list' | 'edit' | 'create'>('list');
  const [form, setForm] = useState<
    Partial<import('@prism/shared-types').CustomAgent>
  >({
    name: '',
    description: '',
    systemPrompt: '',
    strategy: 'react',
    provider: 'openai',
    model: '',
    temperature: 0.7,
    maxSteps: 10,
    maxTokens: 4096,
    tools: [],
    personality: '',
  });

  const STRATEGIES: AgentStrategy[] = [
    'react',
    'plan-and-execute',
    'reflexion',
  ];
  const PROVIDERS: AIProvider[] = [
    'openai',
    'claude',
    'gemini',
    'deepseek',
    'groq',
    'ollama',
    'koboldcpp',
    'llamacpp',
    'sglang',
  ];

  const editingAgent = form.name ? agents.find((a) => a.id === form.id) : null;
  const isEditing = view === 'edit' && editingAgent;

  useInput((input, key) => {
    if (key.escape) {
      if (view !== 'list') {
        setView('list');
        setForm({
          name: '',
          description: '',
          systemPrompt: '',
          strategy: 'react',
          provider: 'openai',
          model: '',
          temperature: 0.7,
          maxSteps: 10,
          maxTokens: 4096,
          tools: [],
          personality: '',
        });
      } else {
        onClose();
      }
      return;
    }

    if (view === 'list') {
      if (key.upArrow) {
        setSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIdx((i) => Math.min(agents.length, i + 1));
        return;
      }
      if (key.return) {
        if (selectedIdx === agents.length) {
          setView('create');
        } else {
          setView('edit');
          setForm({ ...agents[selectedIdx] });
        }
        return;
      }
      if (key.escape) {
        onClose();
        return;
      }
    }
  });

  const handleSave = async () => {
    if (!form.name || !form.systemPrompt) return;
    const agent = {
      id: editingAgent?.id ?? `agent_${Date.now()}`,
      name: form.name,
      description: form.description,
      systemPrompt: form.systemPrompt,
      strategy: form.strategy as import('@prism/shared-types').AgentStrategy,
      provider: form.provider as import('@prism/shared-types').AIProvider,
      model: form.model,
      temperature: form.temperature ?? 0.7,
      maxSteps: form.maxSteps ?? 10,
      maxTokens: form.maxTokens ?? 4096,
      tools: form.tools ?? [],
      personality: form.personality,
      createdAt: editingAgent?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    onCreate(agent);
    setView('list');
    setForm({
      name: '',
      description: '',
      systemPrompt: '',
      strategy: 'react',
      provider: 'openai',
      model: '',
      temperature: 0.7,
      maxSteps: 10,
      maxTokens: 4096,
      tools: [],
      personality: '',
    });
  };

  const renderList = () => (
    <Box flexDirection="column" gap={spacing.sm}>
      <Box paddingBottom={spacing.sm} gap={spacing.sm}>
        <Text color={colors.primary} bold>
          Agents
        </Text>
        <Text color={colors.on_surface_variant}>
          {agents.length} agent{agents.length !== 1 ? 's' : ''} loaded
        </Text>
      </Box>

      {agents.length === 0 && (
        <Text color={colors.on_surface_variant} italic>
          No agents created. Press 'n' to create a new agent.
        </Text>
      )}

      {agents.map((agent, i) => {
        const isActive = activeAgentId === agent.id;
        return (
          <Box key={agent.id} gap={spacing.sm} marginBottom={spacing.sm}>
            <Box gap={spacing.xs}>
              <Text
                color={
                  i === selectedIdx
                    ? colors.on_surface
                    : colors.on_surface_variant
                }
              >
                {i === selectedIdx ? '> ' : '  '}
              </Text>
              <Text
                color={isActive ? colors.tertiary : colors.on_surface_variant}
              >
                {agent.name}
              </Text>
              {isActive && <Text color={colors.primary}> *active</Text>}
            </Box>
            <Text color={colors.outline_variant} dimColor>
              {agent.description?.slice(0, 60) ?? 'No description'}
            </Text>
            <Text color={colors.outline_variant} dimColor>
              {agent.provider} • {agent.model ?? 'default'} • {agent.strategy}
            </Text>
          </Box>
        );
      })}

      <Box gap={spacing.sm} paddingTop={spacing.sm}>
        <Box gap={spacing.sm} key="new-agent">
          <Text
            color={
              selectedIdx === agents.length
                ? colors.on_surface
                : colors.on_surface_variant
            }
          >
            {selectedIdx === agents.length ? '> ' : '  '}
          </Text>
          <Text color={colors.on_surface_variant}>+ Create New Agent</Text>
        </Box>
      </Box>

      <Box paddingTop={spacing.lg}>
        <Text color={colors.outline_variant}>
          ↑/↓: navigate | Enter: select | n: new | e: edit | d: delete | Esc:
          back
        </Text>
      </Box>
    </Box>
  );

  const renderEdit = () => (
    <Box
      flexDirection="column"
      gap={spacing.sm}
      paddingX={spacing.xl}
      paddingY={spacing.lg}
    >
      <Box gap={spacing.sm} paddingBottom={spacing.sm}>
        <Text color={colors.primary} bold>
          {isEditing ? 'Edit Agent' : 'Create New Agent'}
        </Text>
        <Text color={colors.on_surface_variant} dimColor>
          {isEditing
            ? `Editing ${editingAgent?.name}`
            : 'Fill in the details below'}
        </Text>
      </Box>

      <Box flexDirection="column" gap={spacing.sm}>
        <label className="st-agent-label">Name</label>
        <input
          className="st-agent-input"
          value={form.name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setForm({ ...form, name: e.target.value })
          }
          placeholder="Agent name"
        />

        <label className="st-agent-label">Description</label>
        <textarea
          className="st-agent-textarea"
          value={form.description ?? ''}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            setForm({ ...form, description: e.target.value })
          }
          rows={3}
          placeholder="What does this agent do?"
        />

        <label className="st-agent-label">Personality</label>
        <input
          className="st-agent-input"
          type="text"
          value={form.personality ?? ''}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setForm({ ...form, personality: e.target.value })
          }
          placeholder="e.g. concise and technical, dry humor, formal..."
        />

        <label className="st-agent-label">System Prompt</label>
        <textarea
          className="st-agent-textarea"
          value={form.systemPrompt ?? ''}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            setForm({ ...form, systemPrompt: e.target.value })
          }
          rows={6}
          placeholder="You are a research assistant..."
        />

        <div className="st-agent-row">
          <div className="st-agent-field">
            <label className="st-agent-label">Strategy</label>
            <select
              className="st-agent-input-sm"
              value={form.strategy}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setForm({
                  ...form,
                  strategy: e.target
                    .value as import('@prism/shared-types').AgentStrategy,
                })
              }
            >
              {STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="st-agent-field">
            <label className="st-agent-label">Provider</label>
            <select
              className="st-agent-input-sm"
              value={form.provider}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setForm({
                  ...form,
                  provider: e.target
                    .value as import('@prism/shared-types').AIProvider,
                })
              }
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="st-agent-row">
          <div className="st-agent-field">
            <label className="st-agent-label">Model</label>
            <input
              className="st-agent-input"
              type="text"
              value={form.model ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setForm({ ...form, model: e.target.value })
              }
              placeholder="e.g., gpt-4o, claude-sonnet-4-20250514, llama3.2"
            />
          </div>

          <div className="st-agent-field">
            <label className="st-agent-label">Temperature</label>
            <input
              className="st-agent-input-sm"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={form.temperature ?? 0.7}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setForm({ ...form, temperature: parseFloat(e.target.value) })
              }
            />
          </div>

          <div className="st-agent-field">
            <label className="st-agent-label">Max Steps</label>
            <input
              className="st-agent-input-sm"
              type="number"
              min={1}
              max={50}
              value={form.maxSteps ?? 10}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setForm({ ...form, maxSteps: parseInt(e.target.value) })
              }
            />
          </div>

          <div className="st-agent-field">
            <label className="st-agent-label">Max Tokens</label>
            <input
              className="st-agent-input-sm"
              type="number"
              min={128}
              max={32768}
              step={128}
              value={form.maxTokens ?? 4096}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setForm({ ...form, maxTokens: parseInt(e.target.value) })
              }
            />
          </div>

          <div className="st-agent-memories">
            <label className="st-agent-label">
              Core Memories ({(form as any).coreMemories?.length ?? 0})
            </label>
            <div className="st-agent-memories">
              {/* Memories UI can be added later */}
              <Text color={colors.on_surface_variant} dimColor>
                Memory management coming soon...
              </Text>
              <button
                type="button"
                className="st-btn-ghost"
                onClick={() => {
                  const mem = {
                    id: `mem_${Date.now()}`,
                    agentId: '',
                    kind: 'note' as const,
                    content: '',
                    importance: 0.5,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                  };
                  setForm({
                    ...form,
                    coreMemories: [...((form as any).coreMemories ?? []), mem],
                  });
                }}
              >
                + Add Memory
              </button>
            </div>
          </div>

          <div className="st-agent-row" style={{ marginTop: spacing.lg }}>
            <button className="st-btn-ghost" onClick={() => setView('list')}>
              Cancel
            </button>
            <button className="st-btn-primary" onClick={handleSave}>
              {isEditing ? 'Save Changes' : 'Create Agent'}
            </button>
          </div>
        </div>
      </Box>
    </Box>
  );

  return (
    <Box flexDirection="column" paddingX={spacing.xl} paddingY={spacing.lg}>
      {view === 'list' ? renderList() : renderEdit()}
    </Box>
  );
}
