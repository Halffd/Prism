import React, { useState } from 'react';
import type { AIConfig, CustomModel } from '@prism/shared-types';

interface CustomModelManagerProps {
  /** The current AI configuration. */
  aiConfig: AIConfig;
  /** Called with the updated configuration. */
  onChange: (config: AIConfig) => void;
}

/**
 * Builds a custom model entry with a unique id.
 *
 * @param label The display name of the model.
 * @returns The new entry.
 */
function newCustomModel(label: string): CustomModel {
  return {
    id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label,
    baseUrl: '',
    model: '',
    apiKey: '',
    models: [],
    createdAt: Date.now(),
  };
}

/**
 * Management of the user's own OpenAI-compatible model endpoints.
 *
 * The list lives in the AI configuration, which is stored in
 * `chrome.storage.local`, so a custom endpoint survives a browser restart.
 */
export const CustomModelManager: React.FC<CustomModelManagerProps> = ({
  aiConfig,
  onChange,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState<CustomModel>(newCustomModel(''));

  const customModels = aiConfig.customModels ?? [];
  const activeId = aiConfig.activeCustomModelId;

  const commit = (models: CustomModel[], activeId?: string) => {
    onChange({
      ...aiConfig,
      customModels: models,
      activeCustomModelId: activeId,
    });
  };

  const updateDraft = (patch: Partial<CustomModel>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const addModel = () => {
    const entry: CustomModel = {
      ...draft,
      id: newCustomModel(draft.label).id,
      label: draft.label.trim() || 'Custom model',
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
    };
    commit([...customModels, entry], entry.id);
    setDraft(newCustomModel(''));
    setIsAdding(false);
  };

  const updateModel = (id: string, patch: Partial<CustomModel>) => {
    commit(
      customModels.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
      activeId,
    );
  };

  const removeModel = (id: string) => {
    commit(
      customModels.filter((entry) => entry.id !== id),
      activeId === id ? undefined : activeId,
    );
  };

  const selectModel = (id: string) => {
    const entry = customModels.find((item) => item.id === id);
    if (!entry) {
      return;
    }
    onChange({
      ...aiConfig,
      activeCustomModelId: id,
      // The endpoint's own model id is what the request must carry; the
      // provider list stays untouched.
      model: entry.model.trim(),
    });
  };

  return (
    <div className="custom-model-manager">
      <div className="form-group">
        <label>Custom Models</label>
        {customModels.length === 0 && !isAdding && (
          <small className="form-hint">
            No custom models yet. Add any endpoint that speaks the OpenAI
            chat-completions protocol.
          </small>
        )}
        {customModels.map((entry) => (
          <div
            key={entry.id}
            className={`custom-model-entry ${activeId === entry.id ? 'active' : ''}`}
          >
            <div className="custom-model-row">
              <button
                className="custom-model-select"
                onClick={() => selectModel(entry.id)}
                title={
                  activeId === entry.id
                    ? 'Active custom model'
                    : 'Use this custom model'
                }
              >
                {activeId === entry.id ? '● ' : '○ '}
                {entry.label || 'Untitled'}
              </button>
              <button
                className="custom-model-delete"
                onClick={() => removeModel(entry.id)}
                title="Remove custom model"
              >
                ✕
              </button>
            </div>
            <input
              type="text"
              className="form-control"
              placeholder="Display name"
              value={entry.label}
              onChange={(event) =>
                updateModel(entry.id, { label: event.target.value })
              }
            />
            <input
              type="url"
              className="form-control"
              placeholder="Base URL (e.g. https://api.example.com/v1)"
              value={entry.baseUrl}
              onChange={(event) =>
                updateModel(entry.id, { baseUrl: event.target.value })
              }
            />
            <input
              type="text"
              className="form-control"
              placeholder="Model id (e.g. my-model:latest)"
              value={entry.model}
              onChange={(event) =>
                updateModel(entry.id, { model: event.target.value })
              }
            />
            <input
              type="password"
              className="form-control"
              placeholder="API key (optional)"
              value={entry.apiKey ?? ''}
              onChange={(event) =>
                updateModel(entry.id, { apiKey: event.target.value })
              }
            />
          </div>
        ))}
        {isAdding ? (
          <div className="custom-model-entry">
            <input
              type="text"
              className="form-control"
              placeholder="Display name"
              value={draft.label}
              onChange={(event) => updateDraft({ label: event.target.value })}
            />
            <input
              type="url"
              className="form-control"
              placeholder="Base URL (e.g. https://api.example.com/v1)"
              value={draft.baseUrl}
              onChange={(event) =>
                updateDraft({ baseUrl: event.target.value })
              }
            />
            <input
              type="text"
              className="form-control"
              placeholder="Model id (e.g. my-model:latest)"
              value={draft.model}
              onChange={(event) => updateDraft({ model: event.target.value })}
            />
            <input
              type="password"
              className="form-control"
              placeholder="API key (optional)"
              value={draft.apiKey ?? ''}
              onChange={(event) => updateDraft({ apiKey: event.target.value })}
            />
            <div className="custom-model-row">
              <button className="custom-model-select" onClick={addModel}>
                Save
              </button>
              <button
                className="custom-model-delete"
                onClick={() => {
                  setIsAdding(false);
                  setDraft(newCustomModel(''));
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="custom-model-add"
            onClick={() => setIsAdding(true)}
          >
            + Add custom model
          </button>
        )}
      </div>
    </div>
  );
};
