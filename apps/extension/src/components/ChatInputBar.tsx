import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '@prism/redux-store';
import {
  setActiveCharacter,
  setActivePersona,
  setActivePreset,
  setActiveWorldInfo,
  toggleCharacterInGroup,
  setGroupChatMode,
} from '@prism/redux-store';
import type { GroupChatMode } from '@prism/shared-types';
import './SillyTavernComponents.scss';

interface ChatInputBarProps {
  onOpenCharacterSelector?: () => void;
  onOpenPersonaSelector?: () => void;
  onOpenPresetManager?: () => void;
  onOpenWorldInfoManager?: () => void;
  onOpenAgentBuilder?: () => void;
  onMentionCharacter?: (characterId: string) => void;
}

export function ChatInputBar({
  onOpenCharacterSelector,
  onOpenPersonaSelector,
  onOpenPresetManager,
  onOpenWorldInfoManager,
  onOpenAgentBuilder,
  onMentionCharacter,
}: ChatInputBarProps) {
  const dispatch = useDispatch();
  const { characters, activeCharacterId, activeCharacterIds, groupChatMode } =
    useSelector((state: RootState) => state.characters);
  const { personas, activePersonaId } = useSelector(
    (state: RootState) => state.personas,
  );
  const { presets, activePresetId } = useSelector(
    (state: RootState) => state.presets,
  );
  const { worldInfoList, activeWorldInfoId } = useSelector(
    (state: RootState) => state.worldInfo,
  );
  void dispatch;
  void useSelector((state: RootState) => state.agents);
  const { addressedCharacterIds } = useSelector(
    (state: RootState) => state.groupChat,
  );

  const activeCharacter = characters.find((c) => c.id === activeCharacterId);
  const activePersona = personas.find((p) => p.id === activePersonaId);
  const activePreset = presets.find((p) => p.id === activePresetId);
  const activeWorldInfo = worldInfoList.find((w) => w.id === activeWorldInfoId);
  const isGroupChat = activeCharacterIds.length > 1 && groupChatMode !== null;

  const handleGroupModeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      dispatch(setGroupChatMode(e.target.value as GroupChatMode));
    },
    [dispatch],
  );

  const handleRemoveFromGroup = useCallback(
    (id: string) => {
      dispatch(toggleCharacterInGroup(id));
    },
    [dispatch],
  );

  return (
    <div className="st-chat-input-bar">
      {/* Group chat mode indicator + mode selector */}
      {isGroupChat && (
        <div className="st-group-indicator">
          <select
            className="st-group-mode-inline"
            value={groupChatMode ?? 'round-robin'}
            onChange={handleGroupModeChange}
          >
            <option value="round-robin">Round Robin</option>
            <option value="reactive">Reactive</option>
            <option value="selective">Selective</option>
          </select>
        </div>
      )}

      {/* Character pill(s) */}
      {isGroupChat ? (
        // Multi-character pills for group chat
        <div className="st-group-pills" onClick={onOpenCharacterSelector}>
          <span className="st-pill-label">GROUP</span>
          {activeCharacterIds.map((id) => {
            const char = characters.find((c) => c.id === id);
            if (!char) return null;
            const isAddressed = addressedCharacterIds.includes(id);
            return (
              <span
                key={id}
                className={`st-pill-mini ${isAddressed ? 'addressed' : ''}`}
              >
                {char.name}
                <button
                  className="st-pill-clear-mini"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveFromGroup(id);
                  }}
                >
                  x
                </button>
              </span>
            );
          })}
        </div>
      ) : activeCharacter ? (
        <div
          className="st-chat-input-pill character"
          onClick={onOpenCharacterSelector}
        >
          <span className="st-pill-label">CHAR</span>
          <span className="st-pill-value">{activeCharacter.name}</span>
          <button
            className="st-pill-clear"
            onClick={(e) => {
              e.stopPropagation();
              dispatch(setActiveCharacter(null));
            }}
          >
            x
          </button>
        </div>
      ) : (
        <div
          className="st-chat-input-pill-placeholder"
          onClick={onOpenCharacterSelector}
        >
          + Character
        </div>
      )}

      {/* @mention quick-pick for selective mode */}
      {isGroupChat && groupChatMode === 'selective' && (
        <div className="st-mention-picker">
          <span className="st-mention-label">@</span>
          {activeCharacterIds.map((id) => {
            const char = characters.find((c) => c.id === id);
            if (!char) return null;
            const isAddressed = addressedCharacterIds.includes(id);
            return (
              <button
                key={id}
                className={`st-mention-btn ${isAddressed ? 'addressed' : ''}`}
                onClick={() => onMentionCharacter?.(id)}
                title={`Address ${char.name}`}
              >
                @{char.name}
              </button>
            );
          })}
        </div>
      )}

      {activePersona ? (
        <div
          className="st-chat-input-pill persona"
          onClick={onOpenPersonaSelector}
        >
          <span className="st-pill-label">YOU</span>
          <span className="st-pill-value">{activePersona.name}</span>
          <button
            className="st-pill-clear"
            onClick={(e) => {
              e.stopPropagation();
              dispatch(setActivePersona(null));
            }}
          >
            x
          </button>
        </div>
      ) : (
        <div
          className="st-chat-input-pill-placeholder"
          onClick={onOpenPersonaSelector}
        >
          + Persona
        </div>
      )}

      {activePreset ? (
        <div
          className="st-chat-input-pill preset"
          onClick={onOpenPresetManager}
        >
          <span className="st-pill-label">PRESET</span>
          <span className="st-pill-value">{activePreset.name}</span>
          <button
            className="st-pill-clear"
            onClick={(e) => {
              e.stopPropagation();
              dispatch(setActivePreset(null));
            }}
          >
            x
          </button>
        </div>
      ) : (
        <div
          className="st-chat-input-pill-placeholder"
          onClick={onOpenPresetManager}
        >
          + Preset
        </div>
      )}

      {activeWorldInfo ? (
        <div
          className="st-chat-input-pill world-info"
          onClick={onOpenWorldInfoManager}
        >
          <span className="st-pill-label">WORLD</span>
          <span className="st-pill-value">{activeWorldInfo.name}</span>
          <button
            className="st-pill-clear"
            onClick={(e) => {
              e.stopPropagation();
              dispatch(setActiveWorldInfo(null));
            }}
          >
            x
          </button>
        </div>
      ) : (
        <div
          className="st-chat-input-pill-placeholder"
          onClick={onOpenWorldInfoManager}
        >
          + World
        </div>
      )}
    </div>
  );
}
