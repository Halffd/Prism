import React, { useRef, useCallback, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '@prism/redux-store';
import {
  setActiveCharacter,
  addCharacter,
  removeCharacter,
  setCharactersLoading,
  toggleCharacterInGroup,
  setGroupChatMode,
} from '@prism/redux-store';
import type { CharacterCard, GroupChatMode } from '@prism/shared-types';
import { importV2CharacterCard, importPngCharacterCard } from '@prism/context-manager';
import './SillyTavernComponents.scss';

export function CharacterSelector() {
  const dispatch = useDispatch();
  const { characters, activeCharacterId, activeCharacterIds, groupChatMode } = useSelector((state: RootState) => state.characters);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [multiSelect, setMultiSelect] = useState(false);

  const activeCharacter = characters.find((c: CharacterCard) => c.id === activeCharacterId) ?? null;

  const handleSelect = useCallback((id: string | null) => {
    if (multiSelect) {
      // In multi-select mode, toggle the character in the group
      if (id) dispatch(toggleCharacterInGroup(id));
    } else {
      dispatch(setActiveCharacter(id));
    }
  }, [dispatch, multiSelect]);

  const handleToggleMultiSelect = useCallback(() => {
    const next = !multiSelect;
    setMultiSelect(next);
    if (next) {
      // Entering multi-select: if there's an active character, start group with them
      if (activeCharacterId && !activeCharacterIds.includes(activeCharacterId)) {
        dispatch(toggleCharacterInGroup(activeCharacterId));
      }
      // Default to round-robin mode
      dispatch(setGroupChatMode('round-robin'));
    } else {
      // Exiting multi-select: keep only the first selected character
      if (activeCharacterIds.length > 0) {
        dispatch(setActiveCharacter(activeCharacterIds[0]));
      }
    }
  }, [dispatch, multiSelect, activeCharacterId, activeCharacterIds]);

  const handleGroupChatModeChange = useCallback((mode: GroupChatMode) => {
    dispatch(setGroupChatMode(mode));
  }, [dispatch]);

  const handleRemove = useCallback(async (id: string) => {
    dispatch(removeCharacter(id));
    try {
      const { deleteCharacterCard } = await import('@prism/shared-db');
      await deleteCharacterCard(id);
    } catch (err) {
      console.error('Failed to delete character from DB:', err);
    }
  }, [dispatch]);

  const handleImportJson = useCallback(async () => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    dispatch(setCharactersLoading(true));
    try {
      let card: CharacterCard;
      if (file.type === 'image/png' || file.name.endsWith('.png')) {
        card = await importPngCharacterCard(file);
      } else {
        const text = await file.text();
        const json = JSON.parse(text);
        card = importV2CharacterCard(json);
      }
      dispatch(addCharacter(card));
      try {
        const { saveCharacterCard } = await import('@prism/shared-db');
        await saveCharacterCard(card);
      } catch (err) {
        console.error('Failed to save character to DB:', err);
      }
      dispatch(setActiveCharacter(card.id));
    } catch (err) {
      console.error('Failed to import character card:', err);
    } finally {
      dispatch(setCharactersLoading(false));
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [dispatch]);

  return (
    <div className="st-character-selector">
      <div className="st-selector-header">
        <span className="st-selector-label">CHARACTER</span>
        <div className="st-selector-actions">
          <button
            className={`st-btn-ghost ${multiSelect ? 'active' : ''}`}
            onClick={handleToggleMultiSelect}
            title={multiSelect ? 'Switch to single character mode' : 'Enable group chat (multi-select)'}
          >
            {multiSelect ? 'Group: ON' : 'Group'}
          </button>
          <button
            className="st-btn-ghost"
            onClick={handleImportJson}
            title="Import character card (JSON/PNG)"
          >
            + Import
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.png"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Group chat mode selector (only visible when multi-select is on) */}
      {multiSelect && (
        <div className="st-group-mode-selector">
          <label className="st-group-mode-label">Mode:</label>
          <select
            className="st-group-mode-select"
            value={groupChatMode ?? 'round-robin'}
            onChange={(e) => handleGroupChatModeChange(e.target.value as GroupChatMode)}
          >
            <option value="round-robin">Round Robin</option>
            <option value="reactive">Reactive</option>
            <option value="selective">Selective (@mention)</option>
          </select>
          <span className="st-group-count">
            {activeCharacterIds.length} character{activeCharacterIds.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Single character display */}
      {!multiSelect && activeCharacter && (
        <div className="st-active-card">
          <div className="st-active-card-name">{activeCharacter.name}</div>
          {activeCharacter.tags.length > 0 && (
            <div className="st-active-card-tags">
              {activeCharacter.tags.slice(0, 5).map((tag: string) => (
                <span key={tag} className="st-tag">{tag}</span>
              ))}
            </div>
          )}
          <button
            className="st-btn-ghost st-btn-clear"
            onClick={() => handleSelect(null)}
          >
            Clear
          </button>
        </div>
      )}

      {/* Multi-character selected pills */}
      {multiSelect && activeCharacterIds.length > 0 && (
        <div className="st-group-selected-pills">
          {activeCharacterIds.map((id: string) => {
            const char = characters.find((c: CharacterCard) => c.id === id);
            if (!char) return null;
            return (
              <span key={id} className="st-group-pill">
                {char.name}
                <button
                  className="st-group-pill-remove"
                  onClick={() => dispatch(toggleCharacterInGroup(id))}
                >
                  x
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className="st-character-list">
        {characters.map((char: CharacterCard) => {
          const isSelected = multiSelect
            ? activeCharacterIds.includes(char.id)
            : char.id === activeCharacterId;
          return (
            <div
              key={char.id}
              className={`st-character-item ${isSelected ? 'active' : ''}`}
              onClick={() => handleSelect(isSelected ? null : char.id)}
            >
              {multiSelect && (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {}}
                  className="st-character-checkbox"
                />
              )}
              <div className="st-character-item-name">{char.name}</div>
              <button
                className="st-btn-icon"
                onClick={(e) => { e.stopPropagation(); handleRemove(char.id); }}
                title="Delete character"
              >
                x
              </button>
            </div>
          );
        })}
        {characters.length === 0 && (
          <div className="st-empty">No characters imported</div>
        )}
      </div>
    </div>
  );
}
