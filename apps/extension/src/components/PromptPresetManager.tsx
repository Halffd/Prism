import { useState, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '@prism/redux-store';
import {
  addPreset,
  updatePreset,
  removePreset,
  setActivePreset,
} from '@prism/redux-store';
import { savePromptPreset, deletePromptPreset } from '@prism/shared-db';
import type {
  PromptPreset,
  PromptEntry,
  PromptPosition,
} from '@prism/shared-types';
import './SillyTavernComponents.scss';

const POSITIONS: { value: PromptPosition; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'before-system', label: 'Before System' },
  { value: 'after-system', label: 'After System' },
  { value: 'before-char', label: 'Before Character' },
  { value: 'after-char', label: 'After Character' },
  { value: 'before-history', label: 'Before History' },
  { value: 'after-history', label: 'After History' },
  { value: 'before-input', label: 'Before Input' },
  { value: 'after-input', label: 'After Input' },
];

interface PresetEditorProps {
  presetId?: string | null;
  onClose?: () => void;
}

export function PresetEditor({ presetId, onClose }: PresetEditorProps) {
  const dispatch = useDispatch();
  const presets = useSelector((state: RootState) => state.presets.presets);
  const existing = presetId ? presets.find((p) => p.id === presetId) : null;

  const [name, setName] = useState(existing?.name ?? '');
  const [prompts, setPrompts] = useState<PromptEntry[]>(
    existing?.prompts ?? [],
  );
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const handleSave = useCallback(async () => {
    const now = Date.now();
    const preset: PromptPreset = {
      id:
        existing?.id ??
        `preset_${now}_${Math.random().toString(36).slice(2, 8)}`,
      name: name || 'Untitled Preset',
      prompts,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (existing) {
      dispatch(updatePreset({ id: preset.id, updates: preset }));
    } else {
      dispatch(addPreset(preset));
    }
    await savePromptPreset(preset);
    dispatch(setActivePreset(preset.id));
    onClose?.();
  }, [name, prompts, existing, dispatch, onClose]);

  const handleDelete = useCallback(async () => {
    if (!existing) return;
    dispatch(removePreset(existing.id));
    await deletePromptPreset(existing.id);
    onClose?.();
  }, [existing, dispatch, onClose]);

  const addEntry = useCallback(() => {
    const entry: PromptEntry = {
      id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: '',
      content: '',
      position: 'after-system',
      role: 'system',
      enabled: true,
      order: prompts.length,
    };
    setPrompts((prev) => [...prev, entry]);
    setEditingIdx(prompts.length);
  }, [prompts.length]);

  const updateEntryField = useCallback(
    (idx: number, updates: Partial<PromptEntry>) => {
      setPrompts((prev) =>
        prev.map((p, i) => (i === idx ? { ...p, ...updates } : p)),
      );
    },
    [],
  );

  const removeEntryAt = useCallback(
    (idx: number) => {
      setPrompts((prev) => prev.filter((_, i) => i !== idx));
      if (editingIdx === idx) setEditingIdx(null);
    },
    [editingIdx],
  );

  const moveEntry = useCallback(
    (idx: number, direction: -1 | 1) => {
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prompts.length) return;
      setPrompts((prev) => {
        const arr = [...prev];
        [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
        return arr.map((p, i) => ({ ...p, order: i }));
      });
    },
    [prompts.length],
  );

  return (
    <div className="st-preset-editor">
      <div className="st-card-editor-header">
        <h3>{existing ? 'Edit Preset' : 'New Preset'}</h3>
        <div className="st-card-editor-actions">
          <button className="st-btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>

      <div className="st-field-group">
        <label className="st-label">Preset Name</label>
        <input
          type="text"
          className="st-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My prompt preset"
        />
      </div>

      <div className="st-preset-entries">
        <div className="st-preset-entries-header">
          <span className="st-selector-label">PROMPT ENTRIES</span>
          <button className="st-btn-ghost" onClick={addEntry}>
            + Add Entry
          </button>
        </div>

        {prompts.map((entry, idx) => (
          <div
            key={entry.id}
            className={`st-preset-entry ${editingIdx === idx ? 'expanded' : ''}`}
          >
            <div
              className="st-preset-entry-summary"
              onClick={() => setEditingIdx(editingIdx === idx ? null : idx)}
            >
              <span
                className={`st-preset-entry-dot ${entry.enabled ? 'enabled' : 'disabled'}`}
              />
              <span className="st-preset-entry-name">
                {entry.name || 'Untitled Entry'}
              </span>
              <span className="st-preset-entry-position">{entry.position}</span>
              <div className="st-preset-entry-actions">
                <button
                  className="st-btn-icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    moveEntry(idx, -1);
                  }}
                  title="Move up"
                >
                  ^
                </button>
                <button
                  className="st-btn-icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    moveEntry(idx, 1);
                  }}
                  title="Move down"
                >
                  v
                </button>
                <button
                  className="st-btn-icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeEntryAt(idx);
                  }}
                  title="Remove"
                >
                  x
                </button>
              </div>
            </div>

            {editingIdx === idx && (
              <div className="st-preset-entry-detail">
                <div className="st-field-row">
                  <div className="st-field-group st-field-flex">
                    <label className="st-label">Name</label>
                    <input
                      type="text"
                      className="st-input"
                      value={entry.name}
                      onChange={(e) =>
                        updateEntryField(idx, { name: e.target.value })
                      }
                      placeholder="Entry name"
                    />
                  </div>
                  <div className="st-field-group st-field-fixed">
                    <label className="st-label">Position</label>
                    <select
                      className="st-select"
                      value={entry.position}
                      onChange={(e) =>
                        updateEntryField(idx, {
                          position: e.target.value as PromptPosition,
                        })
                      }
                    >
                      {POSITIONS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="st-field-group st-field-toggle">
                    <label className="st-label">Enabled</label>
                    <button
                      className={`st-toggle ${entry.enabled ? 'on' : 'off'}`}
                      onClick={() =>
                        updateEntryField(idx, { enabled: !entry.enabled })
                      }
                    >
                      {entry.enabled ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>
                <textarea
                  className="st-textarea"
                  value={entry.content}
                  onChange={(e) =>
                    updateEntryField(idx, { content: e.target.value })
                  }
                  placeholder="Prompt content..."
                  rows={6}
                />
              </div>
            )}
          </div>
        ))}

        {prompts.length === 0 && (
          <div className="st-empty">
            No prompt entries. Click "+ Add Entry" to begin.
          </div>
        )}
      </div>

      <div className="st-card-editor-footer">
        {existing && (
          <button className="st-btn-danger" onClick={handleDelete}>
            Delete
          </button>
        )}
        <div className="st-card-editor-footer-right">
          <button className="st-btn-primary" onClick={handleSave}>
            {existing ? 'Save Changes' : 'Create Preset'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PromptPresetManager() {
  const dispatch = useDispatch();
  const { presets, activePresetId } = useSelector(
    (state: RootState) => state.presets,
  );
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="st-preset-manager">
      {editingId !== undefined && editingId !== null ? (
        <PresetEditor presetId={editingId} onClose={() => setEditingId(null)} />
      ) : editingId === null && editingId !== undefined ? null : null}

      <div className="st-selector-header">
        <span className="st-selector-label">PROMPT PRESETS</span>
        <button className="st-btn-ghost" onClick={() => setEditingId('new')}>
          + New
        </button>
      </div>

      <div className="st-preset-list">
        {presets.map((preset) => (
          <div
            key={preset.id}
            className={`st-preset-item ${preset.id === activePresetId ? 'active' : ''}`}
          >
            <div
              className="st-preset-item-info"
              onClick={() => dispatch(setActivePreset(preset.id))}
            >
              <div className="st-preset-item-name">{preset.name}</div>
              <div className="st-preset-item-count">
                {preset.prompts.filter((p) => p.enabled).length} prompts
              </div>
            </div>
            <button
              className="st-btn-ghost"
              onClick={() => setEditingId(preset.id)}
            >
              Edit
            </button>
          </div>
        ))}
        {presets.length === 0 && (
          <div className="st-empty">
            No presets. Click "+ New" to create one.
          </div>
        )}
      </div>

      {editingId === 'new' && (
        <div className="st-editor-overlay">
          <PresetEditor onClose={() => setEditingId(null)} />
        </div>
      )}

      {editingId && editingId !== 'new' && (
        <div className="st-editor-overlay">
          <PresetEditor
            presetId={editingId}
            onClose={() => setEditingId(null)}
          />
        </div>
      )}
    </div>
  );
}
