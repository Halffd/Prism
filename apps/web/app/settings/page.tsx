'use client';

import { useEffect, useState } from 'react';
import { useStudio } from '../../src/studio/shell';
import {
  PRISM_API_ID,
  chatCompletionsUrl,
  forProvider,
  isOllama,
  modelsUrl,
  needsKey,
  ollamaRootUrl,
  type StudioSettings,
} from '../../src/studio/settings';
import { getCore } from '../../src/studio/media';
import { parseModels } from '@prism/ai-core';

export default function SettingsPage() {
  const { settings, updateSettings, providers } = useStudio();
  const [draft, setDraft] = useState<StudioSettings>(settings);
  const [status, setStatus] = useState('');
  const [testing, setTesting] = useState(false);

  // The shell hydrates persisted settings after mount; follow that once.
  useEffect(() => setDraft(settings), [settings]);

  function chooseProvider(id: string) {
    setDraft(forProvider(id, providers));
    setStatus('');
  }

  function change<K extends keyof StudioSettings>(key: K, value: StudioSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function save() {
    updateSettings(draft);
    setStatus(
      typeof window !== 'undefined' && window.localStorage
        ? 'Settings saved — they persist in this browser.'
        : 'Applied for this session (localStorage unavailable).',
    );
  }

  async function testConnection() {
    setTesting(true);
    setStatus('Testing…');
    try {
      const core = await getCore();
      const url = isOllama(draft) ? `${ollamaRootUrl(draft.base_url)}/api/tags` : modelsUrl(draft.base_url);
      const response = await fetch(url, {
        headers: draft.api_key ? { Authorization: `Bearer ${draft.api_key}` } : undefined,
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const models = parseModels(core, await response.text());
      setStatus(`Connected — ${models.length} models available`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  }

  const keyHint = draft.provider_id === PRISM_API_ID
    ? 'Optional bearer token for a self-hosted Prism API.'
    : needsKey(draft.provider_id, providers)
      ? 'Required — stored only in this browser (localStorage), never sent anywhere else.'
      : 'Not required for local servers.';

  return (
    <>
      <div className="studio-page-header">
        <h1>Settings</h1>
        <p>Choose a chat provider. Settings stay in this browser.</p>
      </div>

      <div className="studio-settings">
        <div className="studio-card" style={{ padding: 18 }}>
          <div className="studio-field" style={{ marginBottom: 14 }}>
            <label className="studio-field-label" htmlFor="set-provider">Provider</label>
            <select id="set-provider" className="studio-select" value={draft.provider_id} onChange={(e) => chooseProvider(e.target.value)}>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.label}</option>
              ))}
            </select>
          </div>

          <div className="studio-field" style={{ marginBottom: 14 }}>
            <label className="studio-field-label" htmlFor="set-base">Base URL</label>
            <input id="set-base" className="studio-input" value={draft.base_url} onChange={(e) => change('base_url', e.target.value)} />
            <small className="studio-status">
              {draft.provider_id === PRISM_API_ID
                ? 'Root URL of your self-hosted Prism API.'
                : 'OpenAI-compatible base URL, including its version segment.'}
            </small>
          </div>

          <div className="studio-field" style={{ marginBottom: 14 }}>
            <label className="studio-field-label" htmlFor="set-model">Model</label>
            <input id="set-model" className="studio-input" value={draft.model} onChange={(e) => change('model', e.target.value)} />
          </div>

          <div className="studio-field" style={{ marginBottom: 18 }}>
            <label className="studio-field-label" htmlFor="set-key">API key</label>
            <input id="set-key" className="studio-input" type="password" autoComplete="off" spellCheck={false} value={draft.api_key} onChange={(e) => change('api_key', e.target.value)} />
            <small className="studio-status">{keyHint}</small>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="studio-primary-button" onClick={save}>Save</button>
            {draft.provider_id !== PRISM_API_ID ? (
              <button type="button" className="studio-secondary-button" onClick={testConnection} disabled={testing}>
                {testing ? 'Testing…' : 'Test connection'}
              </button>
            ) : null}
          </div>
          {status ? <p className={`studio-status ${status.startsWith('Connected') || status.startsWith('Settings saved') ? 'is-ready' : ''}`}>{status}</p> : null}
        </div>

        <div className="studio-note">
          <strong>Wire formats.</strong> OpenAI-compatible providers use SSE at{' '}
          <code>{chatCompletionsUrl(draft.base_url || 'http://127.0.0.1:7861/v1')}</code> and are
          decoded by the core. Ollama uses native NDJSON at{' '}
          <code>{`${ollamaRootUrl(draft.base_url || 'http://127.0.0.1:11434')}/api/chat`}</code>.
          The self-hosted Prism API uses a single non-streaming <code>/api/chat</code> request.
          Everything is assembled by <code>prism-core</code>; this browser only drives fetch.
        </div>
      </div>
    </>
  );
}
