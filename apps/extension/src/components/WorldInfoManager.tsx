import { useState, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '@prism/redux-store';
import {
  addWorldInfo,
  updateWorldInfo,
  removeWorldInfo,
  setActiveWorldInfo,
  addEntry,
  updateEntry,
  removeEntry,
} from '@prism/redux-store';
import {
  saveWorldInfo,
  deleteWorldInfo,
  saveWorldInfoEntry,
  deleteWorldInfoEntry,
} from '@prism/shared-db';
import type { WorldInfo, WorldInfoEntry } from '@prism/shared-types';
import './SillyTavernComponents.scss';

function WorldInfoEntryEditor({
  entry,
  onUpdate,
  onRemove,
}: {
  entry: WorldInfoEntry;
  onUpdate: (updates: Partial<WorldInfoEntry>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`st-wi-entry ${expanded ? 'expanded' : ''}`}>
      <div
        className="st-wi-entry-summary"
        onClick={() => setExpanded(!expanded)}
      >
        <span
          className={`st-preset-entry-dot ${entry.enabled ? 'enabled' : 'disabled'}`}
        />
        <span className="st-wi-entry-keys">
          {entry.keys.join(', ') || 'No keywords'}
        </span>
        <span className="st-wi-entry-preview">
          {entry.content.slice(0, 60)}
          {entry.content.length > 60 ? '...' : ''}
        </span>
        <button
          className="st-btn-icon"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Delete"
        >
          x
        </button>
      </div>

      {expanded && (
        <div className="st-wi-entry-detail">
          <div className="st-field-row">
            <div className="st-field-group st-field-flex">
              <label className="st-label">Keywords (comma-separated)</label>
              <input
                type="text"
                className="st-input"
                value={entry.keys.join(', ')}
                onChange={(e) =>
                  onUpdate({
                    keys: e.target.value
                      .split(',')
                      .map((k) => k.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="keyword1, keyword2"
              />
            </div>
            <div className="st-field-group st-field-fixed">
              <label className="st-label">Secondary Keys</label>
              <input
                type="text"
                className="st-input"
                value={entry.secondaryKeys.join(', ')}
                onChange={(e) =>
                  onUpdate({
                    secondaryKeys: e.target.value
                      .split(',')
                      .map((k) => k.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="optional"
              />
            </div>
          </div>

          <div className="st-field-row">
            <div className="st-field-group st-field-toggle">
              <label className="st-label">Enabled</label>
              <button
                className={`st-toggle ${entry.enabled ? 'on' : 'off'}`}
                onClick={() => onUpdate({ enabled: !entry.enabled })}
              >
                {entry.enabled ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="st-field-group st-field-toggle">
              <label className="st-label">Case Sensitive</label>
              <button
                className={`st-toggle ${entry.caseSensitive ? 'on' : 'off'}`}
                onClick={() =>
                  onUpdate({ caseSensitive: !entry.caseSensitive })
                }
              >
                {entry.caseSensitive ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="st-field-group st-field-toggle">
              <label className="st-label">Whole Words</label>
              <button
                className={`st-toggle ${entry.matchWholeWords ? 'on' : 'off'}`}
                onClick={() =>
                  onUpdate({ matchWholeWords: !entry.matchWholeWords })
                }
              >
                {entry.matchWholeWords ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="st-field-group st-field-fixed">
              <label className="st-label">Probability</label>
              <input
                type="number"
                className="st-input"
                min={0}
                max={1}
                step={0.1}
                value={entry.probability}
                onChange={(e) =>
                  onUpdate({ probability: parseFloat(e.target.value) || 0 })
                }
              />
            </div>
            <div className="st-field-group st-field-fixed">
              <label className="st-label">Insert Order</label>
              <input
                type="number"
                className="st-input"
                min={0}
                value={entry.insertionOrder}
                onChange={(e) =>
                  onUpdate({ insertionOrder: parseInt(e.target.value) || 0 })
                }
              />
            </div>
          </div>

          <textarea
            className="st-textarea"
            value={entry.content}
            onChange={(e) => onUpdate({ content: e.target.value })}
            placeholder="World info entry content..."
            rows={6}
          />

          <div className="st-field-group">
            <label className="st-label">Comment (optional)</label>
            <input
              type="text"
              className="st-input"
              value={entry.comment ?? ''}
              onChange={(e) => onUpdate({ comment: e.target.value })}
              placeholder="Internal note"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function WorldInfoManager() {
  const dispatch = useDispatch();
  const { worldInfoList, activeWorldInfoId, entries } = useSelector(
    (state: RootState) => state.worldInfo,
  );
  const activeWI =
    worldInfoList.find((w) => w.id === activeWorldInfoId) ?? null;
  const activeEntries = activeWI ? (entries[activeWI.id] ?? []) : [];

  const handleCreateWI = useCallback(async () => {
    const now = Date.now();
    const wi: WorldInfo = {
      id: `wi_${now}_${Math.random().toString(36).slice(2, 8)}`,
      name: 'New Lorebook',
      description: '',
      entries: [],
      scanDepth: 50,
      tokenBudget: 2048,
      recursiveScanning: true,
      createdAt: now,
      updatedAt: now,
    };
    dispatch(addWorldInfo(wi));
    await saveWorldInfo(wi);
    dispatch(setActiveWorldInfo(wi.id));
  }, [dispatch]);

  const handleDeleteWI = useCallback(
    async (id: string) => {
      dispatch(removeWorldInfo(id));
      await deleteWorldInfo(id);
    },
    [dispatch],
  );

  const handleAddEntry = useCallback(async () => {
    if (!activeWI) return;
    const entry: WorldInfoEntry = {
      id: `wie_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      worldInfoId: activeWI.id,
      keys: [],
      secondaryKeys: [],
      content: '',
      comment: '',
      enabled: true,
      position: 'before-char' as const,
      insertionOrder: activeEntries.length,
      caseSensitive: false,
      matchWholeWords: false,
      useGroupScoring: false,
      scanDepth: 50,
      preventRecursion: false,
      delayUntilRecursion: 0,
      role: 'system',
      probability: 1,
      extensions: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    dispatch(addEntry(entry));
    await saveWorldInfoEntry(entry);
  }, [activeWI, activeEntries.length, dispatch]);

  const handleUpdateEntry = useCallback(
    async (entryId: string, updates: Partial<WorldInfoEntry>) => {
      if (!activeWI) return;
      dispatch(updateEntry({ id: entryId, worldInfoId: activeWI.id, updates }));
      const current = activeEntries.find((e) => e.id === entryId);
      if (current) {
        await saveWorldInfoEntry({ ...current, ...updates });
      }
    },
    [activeWI, activeEntries, dispatch],
  );

  const handleRemoveEntry = useCallback(
    async (entryId: string) => {
      if (!activeWI) return;
      dispatch(removeEntry({ id: entryId, worldInfoId: activeWI.id }));
      await deleteWorldInfoEntry(entryId);
    },
    [activeWI, dispatch],
  );

  return (
    <div className="st-world-info-manager">
      <div className="st-selector-header">
        <span className="st-selector-label">WORLD INFO / LOREBOOK</span>
        <button className="st-btn-ghost" onClick={handleCreateWI}>
          + New
        </button>
      </div>

      <div className="st-wi-list">
        {worldInfoList.map((wi) => (
          <div
            key={wi.id}
            className={`st-wi-item ${wi.id === activeWorldInfoId ? 'active' : ''}`}
            onClick={() => dispatch(setActiveWorldInfo(wi.id))}
          >
            <div className="st-wi-item-name">{wi.name}</div>
            <button
              className="st-btn-icon"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteWI(wi.id);
              }}
              title="Delete"
            >
              x
            </button>
          </div>
        ))}
        {worldInfoList.length === 0 && (
          <div className="st-empty">
            No lorebooks. Click "+ New" to create one.
          </div>
        )}
      </div>

      {activeWI && (
        <div className="st-wi-detail">
          <div className="st-wi-detail-header">
            <input
              type="text"
              className="st-input-name"
              value={activeWI.name}
              onChange={(e) => {
                dispatch(
                  updateWorldInfo({
                    id: activeWI.id,
                    updates: { name: e.target.value },
                  }),
                );
                saveWorldInfo({ ...activeWI, name: e.target.value });
              }}
              placeholder="Lorebook name"
            />
            <div className="st-wi-entries-header">
              <span className="st-selector-label">
                ENTRIES ({activeEntries.length})
              </span>
              <button className="st-btn-ghost" onClick={handleAddEntry}>
                + Add Entry
              </button>
            </div>
          </div>

          {activeEntries.map((entry) => (
            <WorldInfoEntryEditor
              key={entry.id}
              entry={entry}
              onUpdate={(updates) => handleUpdateEntry(entry.id, updates)}
              onRemove={() => handleRemoveEntry(entry.id)}
            />
          ))}

          {activeEntries.length === 0 && (
            <div className="st-empty">No entries yet. Click "+ Add Entry".</div>
          )}
        </div>
      )}
    </div>
  );
}
