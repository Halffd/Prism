import { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { AppDispatch, RootState } from '@prism/redux-store';
import {
  setAgents,
  addAgent,
  updateAgent,
  removeAgent,
  setActiveAgent,
  setAgentsLoading,
  setEditingAgent,
} from '@prism/redux-store';
import {
  getAllCustomAgents,
  saveCustomAgent,
  deleteCustomAgent,
} from '@prism/shared-db';
import type {
  CustomAgent,
  AgentToolDef,
  AgentStrategy,
  AIProvider,
  BuiltinToolName,
  AgentMemory,
} from '@prism/shared-types';
import { nanoid } from 'nanoid';

const BUILTIN_TOOLS: { name: BuiltinToolName; description: string }[] = [
  { name: 'web_search', description: 'Search the web for information' },
  { name: 'calculator', description: 'Evaluate mathematical expressions' },
  { name: 'fetch_url', description: 'Fetch content from a URL' },
  { name: 'code_eval', description: 'Evaluate a code expression' },
  { name: 'read_file', description: 'Read a file from the filesystem' },
];

const STRATEGIES: AgentStrategy[] = ['react', 'plan-and-execute', 'reflexion'];

const LLM_PROVIDERS: AIProvider[] = [
  'openai',
  'claude',
  'gemini',
  'deepseek',
  'grok',
  'groq',
  'openrouter',
  'mistral',
  'cohere',
  'together',
  'perplexity',
  'qwen',
  'poe',
  'nvidia-nim',
  'cerebras',
  'cloudflare-workers',
  'fireworks',
  'zai',
  'transformers',
];

interface Props {
  onClose: () => void;
}

export function AgentBuilder({ onClose }: Props) {
  const dispatch = useDispatch<AppDispatch>();
  const { agents, activeAgentId, editingAgent } = useSelector(
    (state: RootState) => state.agents,
  );
  const [view, setView] = useState<'list' | 'edit'>('list');
  const [form, setForm] = useState<Partial<CustomAgent>>({});

  useEffect(() => {
    loadAgents();
  }, []);

  async function loadAgents() {
    dispatch(setAgentsLoading(true));
    try {
      const all = await getAllCustomAgents();
      dispatch(setAgents(all));
    } finally {
      dispatch(setAgentsLoading(false));
    }
  }

  function startCreate() {
    const newAgent: Partial<CustomAgent> = {
      name: '',
      description: '',
      systemPrompt: '',
      strategy: 'react',
      provider: 'openai',
      temperature: 0,
      maxSteps: 10,
      maxTokens: 1024,
      tools: BUILTIN_TOOLS.map((t) => ({
        ...t,
        parameters: {},
        enabled: false,
      })),
    };
    setForm(newAgent);
    dispatch(setEditingAgent(null));
    setView('edit');
  }

  function startEdit(agent: CustomAgent) {
    setForm({ ...agent });
    dispatch(setEditingAgent(agent));
    setView('edit');
  }

  async function handleSave() {
    const now = Date.now();
    const agent: CustomAgent = {
      id: editingAgent?.id ?? `agent_${nanoid()}`,
      name: form.name ?? 'Unnamed Agent',
      description: form.description ?? '',
      systemPrompt: form.systemPrompt ?? '',
      strategy: form.strategy ?? 'react',
      provider: form.provider ?? 'openai',
      model: form.model,
      temperature: form.temperature ?? 0,
      maxSteps: form.maxSteps ?? 10,
      maxTokens: form.maxTokens ?? 1024,
      tools: form.tools ?? [],
      personality: form.personality,
      coreMemories: form.coreMemories,
      permissions: form.permissions,
      createdAt: editingAgent?.createdAt ?? now,
      updatedAt: now,
    };

    await saveCustomAgent(agent);
    if (editingAgent) {
      dispatch(updateAgent({ id: agent.id, updates: agent }));
    } else {
      dispatch(addAgent(agent));
    }
    setView('list');
    dispatch(setEditingAgent(null));
    setForm({});
  }

  async function handleDelete(id: string) {
    await deleteCustomAgent(id);
    dispatch(removeAgent(id));
  }

  function addCustomTool() {
    const tools = [...(form.tools ?? [])];
    tools.push({ name: '', description: '', parameters: {}, enabled: true });
    setForm({ ...form, tools });
  }

  function updateCustomTool(
    index: number,
    field: keyof AgentToolDef,
    value: string | boolean,
  ) {
    if (!form.tools) return;
    const tools = [...form.tools];
    tools[index] = { ...tools[index], [field]: value };
    setForm({ ...form, tools });
  }

  function removeCustomTool(index: number) {
    if (!form.tools) return;
    const tools = form.tools.filter((_, i) => i !== index);
    setForm({ ...form, tools });
  }

  if (view === 'edit') {
    return (
      <div className="st-agent-builder">
        <div className="st-editor-header">
          <h3 className="st-editor-title">
            {editingAgent ? 'Edit Agent' : 'Create Agent'}
          </h3>
          <button
            className="st-editor-close"
            onClick={() => {
              setView('list');
              setForm({});
              dispatch(setEditingAgent(null));
            }}
          >
            ✕
          </button>
        </div>

        <div className="st-agent-form">
          <label className="st-agent-label">Name</label>
          <input
            className="st-agent-input"
            value={form.name ?? ''}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Research Agent"
          />

          <label className="st-agent-label">Description</label>
          <input
            className="st-agent-input"
            value={form.description ?? ''}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Deep research and analysis agent"
          />

          <label className="st-agent-label">Strategy</label>
          <select
            className="st-agent-select"
            value={form.strategy ?? 'react'}
            onChange={(e) =>
              setForm({ ...form, strategy: e.target.value as AgentStrategy })
            }
          >
            {STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <label className="st-agent-label">Provider</label>
          <select
            className="st-agent-select"
            value={form.provider ?? 'openai'}
            onChange={(e) =>
              setForm({ ...form, provider: e.target.value as AIProvider })
            }
          >
            {LLM_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <label className="st-agent-label">Model (optional)</label>
          <input
            className="st-agent-input"
            value={form.model ?? ''}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            placeholder="gpt-4o"
          />

          <label className="st-agent-label">
            System Prompt (leave empty for strategy default)
          </label>
          <textarea
            className="st-agent-textarea"
            value={form.systemPrompt ?? ''}
            onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
            rows={4}
            placeholder="You are a research assistant..."
          />

          <label className="st-agent-label">Personality</label>
          <input
            className="st-agent-input"
            type="text"
            value={form.personality ?? ''}
            onChange={(e) => setForm({ ...form, personality: e.target.value })}
            placeholder="e.g. Concise and technical, dry humor, formal..."
          />

          <label className="st-agent-label">
            Core Memories ({(form.coreMemories ?? []).length})
          </label>
          <div className="st-agent-memories">
            {(form.coreMemories ?? []).map((mem, idx) => (
              <div key={mem.id} className="st-agent-memory-row">
                <select
                  className="st-agent-input-sm"
                  value={mem.kind}
                  onChange={(e) => {
                    const mems = [...(form.coreMemories ?? [])];
                    mems[idx] = {
                      ...mem,
                      kind: e.target.value as 'fact' | 'preference' | 'note',
                    };
                    setForm({ ...form, coreMemories: mems });
                  }}
                >
                  <option value="fact">Fact</option>
                  <option value="preference">Preference</option>
                  <option value="note">Note</option>
                </select>
                <input
                  className="st-agent-input"
                  type="text"
                  value={mem.content}
                  onChange={(e) => {
                    const mems = [...(form.coreMemories ?? [])];
                    mems[idx] = {
                      ...mem,
                      content: e.target.value,
                      updatedAt: Date.now(),
                    };
                    setForm({ ...form, coreMemories: mems });
                  }}
                  placeholder="The user prefers TypeScript..."
                />
                <button
                  type="button"
                  className="st-btn-ghost"
                  onClick={() => {
                    setForm({
                      ...form,
                      coreMemories: (form.coreMemories ?? []).filter(
                        (m) => m.id !== mem.id,
                      ),
                    });
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="st-btn-ghost"
              onClick={() => {
                const mem: AgentMemory = {
                  id: `mem_${nanoid()}`,
                  agentId: editingAgent?.id ?? 'new',
                  kind: 'note',
                  content: '',
                  importance: 0.5,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                };
                setForm({
                  ...form,
                  coreMemories: [...(form.coreMemories ?? []), mem],
                });
              }}
            >
              + Add Memory
            </button>
          </div>

          <div className="st-agent-row">
            <div className="st-agent-field">
              <label className="st-agent-label">Temperature</label>
              <input
                className="st-agent-input-sm"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={form.temperature ?? 0}
                onChange={(e) =>
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
                onChange={(e) =>
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
                max={16384}
                value={form.maxTokens ?? 1024}
                onChange={(e) =>
                  setForm({ ...form, maxTokens: parseInt(e.target.value) })
                }
              />
            </div>
          </div>

          <label className="st-agent-label">Tools</label>
          <div className="st-agent-tools">
            {(form.tools ?? []).map((tool, i) => (
              <div key={i} className="st-agent-tool-row">
                <input
                  type="checkbox"
                  checked={tool.enabled}
                  onChange={(e) => {
                    // Keep the permission map in sync with the checkbox
                    const level: 'allow' | 'deny' = e.target.checked
                      ? 'allow'
                      : 'deny';
                    setForm({
                      ...form,
                      permissions: {
                        ...(form.permissions ?? {}),
                        [tool.name]: level,
                      },
                      tools: (form.tools ?? []).map((t, ti) =>
                        ti === i ? { ...t, enabled: e.target.checked } : t,
                      ),
                    });
                  }}
                />
                <input
                  className="st-agent-tool-name"
                  value={tool.name}
                  onChange={(e) => updateCustomTool(i, 'name', e.target.value)}
                  placeholder="tool_name"
                />
                <input
                  className="st-agent-tool-desc"
                  value={tool.description}
                  onChange={(e) =>
                    updateCustomTool(i, 'description', e.target.value)
                  }
                  placeholder="description"
                />
                <button
                  className="st-agent-tool-remove"
                  onClick={() => removeCustomTool(i)}
                >
                  ✕
                </button>
              </div>
            ))}
            <button className="st-agent-add-tool" onClick={addCustomTool}>
              + Add Tool
            </button>
          </div>

          <div className="st-agent-actions">
            <button className="st-agent-save" onClick={handleSave}>
              Save Agent
            </button>
            <button
              className="st-agent-cancel"
              onClick={() => {
                setView('list');
                setForm({});
                dispatch(setEditingAgent(null));
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="st-agent-builder">
      <div className="st-editor-header">
        <h3 className="st-editor-title">Custom Agents</h3>
        <button className="st-editor-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <button className="st-agent-create" onClick={startCreate}>
        + Create New Agent
      </button>

      <div className="st-agent-list">
        {agents.length === 0 && (
          <div className="st-agent-empty">
            No custom agents yet. Create one to get started.
          </div>
        )}
        {agents.map((agent) => (
          <div
            key={agent.id}
            className={`st-agent-card ${activeAgentId === agent.id ? 'active' : ''}`}
            onClick={() =>
              dispatch(
                setActiveAgent(activeAgentId === agent.id ? null : agent.id),
              )
            }
          >
            <div className="st-agent-card-header">
              <span className="st-agent-card-name">{agent.name}</span>
              <span className="st-agent-card-badge">{agent.strategy}</span>
            </div>
            <div className="st-agent-card-meta">
              {agent.provider}
              {agent.model ? `/${agent.model}` : ''} ·{' '}
              {agent.tools.filter((t) => t.enabled).length} tools · max{' '}
              {agent.maxSteps} steps
            </div>
            <div className="st-agent-card-desc">
              {agent.description || 'No description'}
            </div>
            <div className="st-agent-card-actions">
              <button
                className="st-agent-card-edit"
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit(agent);
                }}
              >
                Edit
              </button>
              <button
                className="st-agent-card-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(agent.id);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
