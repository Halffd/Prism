import { useState } from 'react';
import type { AIConfig } from '@prism/shared-types';

interface Props {
  aiConfig: AIConfig;
  setAiConfig: (config: AIConfig) => void;
}

/**
 * Per-provider model list editor. Stores per-provider recent models under
 * `aiConfig.modelCache[provider]` so "Fetch Available Models" results persist,
 * and users can add aliases or remove deprecated entries by hand.
 *
 * This is intentionally free-form: the model input itself is never validated
 * against a hardcoded list anywhere else in the codebase.
 */
export function ModelRecentsEditor({ aiConfig, setAiConfig }: Props) {
  const cache = aiConfig.modelCache ?? {};
  const providers = Object.keys(cache).sort();
  const [draftProvider, setDraftProvider] = useState<string>(aiConfig.provider);
  const [draftModel, setDraftModel] = useState('');

  const addToProvider = (provider: string) => {
    const trimmed = draftModel.trim();
    if (!trimmed) return;
    const list = cache[provider] ?? [];
    if (list.includes(trimmed)) return;
    setAiConfig({
      ...aiConfig,
      modelCache: { ...cache, [provider]: [...list, trimmed] },
    });
    setDraftModel('');
  };

  const removeFromProvider = (provider: string, model: string) => {
    const list = (cache[provider] ?? []).filter((m) => m !== model);
    setAiConfig({
      ...aiConfig,
      modelCache: { ...cache, [provider]: list },
    });
  };

  const seedFromSession = (provider: string) => {
    if (aiConfig.provider === provider && aiConfig.model) {
      addToProviderCurrent(provider, aiConfig.model);
    }
  };

  const addToProviderCurrent = (provider: string, model: string) => {
    const list = cache[provider] ?? [];
    if (list.includes(model)) return;
    setAiConfig({
      ...aiConfig,
      modelCache: { ...cache, [provider]: [...list, model] },
    });
  };

  return (
    <div className="model-recents-editor">
      <div className="model-recents-add">
        <select
          value={draftProvider}
          onChange={(e) => setDraftProvider(e.target.value)}
          className="form-control"
        >
          <option value={aiConfig.provider}>
            {aiConfig.provider} (current)
          </option>
          {providers
            .filter((p) => p !== aiConfig.provider)
            .map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          <option value={draftProvider}>{draftProvider}</option>
        </select>
        <input
          type="text"
          className="form-control"
          placeholder="Add a model name for this provider"
          value={draftModel}
          onChange={(e) => setDraftModel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addToProvider(draftProvider);
            }
          }}
        />
        <button
          type="button"
          className="fetch-models-btn"
          onClick={() => addToProvider(draftProvider)}
        >
          Add
        </button>
        <button
          type="button"
          className="fetch-models-btn"
          onClick={() => seedFromSession(draftProvider)}
          title="Add the currently selected model to this provider's list"
        >
          Add current
        </button>
      </div>

      {providers.length === 0 && (
        <p className="form-hint">
          No cached models yet. Use Fetch Available Models above to populate.
        </p>
      )}

      {providers.map((provider) => (
        <div key={provider} className="model-recents-provider">
          <strong>{provider}</strong>
          <div className="model-list">
            {(cache[provider] ?? []).map((model) => (
              <div key={model} className="model-recents-row">
                <button
                  type="button"
                  className="model-btn"
                  onClick={() =>
                    setAiConfig({
                      ...aiConfig,
                      provider: provider as AIConfig['provider'],
                      model,
                    })
                  }
                >
                  {model}
                </button>
                <button
                  type="button"
                  className="model-remove-btn"
                  onClick={() => removeFromProvider(provider, model)}
                  aria-label={`Remove ${model}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
