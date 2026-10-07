import { useState, useCallback } from 'react';
import type { CharacterCard, PersonaProfile, PromptPreset, WorldInfo } from '@prism/shared-types';

interface SillyTavernState {
  characters: CharacterCard[];
  activeCharacterId: string | null;
  activeCharacterIds: string[];
  personas: PersonaProfile[];
  activePersonaId: string | null;
  presets: PromptPreset[];
  activePresetId: string | null;
  worldInfoList: WorldInfo[];
  activeWorldInfoId: string | null;
  isGroupChat: boolean;
}

export function useSillyTavern() {
  const [state, setState] = useState<SillyTavernState>({
    characters: [],
    activeCharacterId: null,
    activeCharacterIds: [],
    personas: [],
    activePersonaId: null,
    presets: [],
    activePresetId: null,
    worldInfoList: [],
    activeWorldInfoId: null,
    isGroupChat: false,
  });

  const setActiveCharacter = useCallback((id: string | null) => {
    setState(prev => ({ ...prev, activeCharacterId: id }));
  }, []);

  const setActivePersona = useCallback((id: string | null) => {
    setState(prev => ({ ...prev, activePersonaId: id }));
  }, []);

  const setActivePreset = useCallback((id: string | null) => {
    setState(prev => ({ ...prev, activePresetId: id }));
  }, []);

  const setActiveWorldInfo = useCallback((id: string | null) => {
    setState(prev => ({ ...prev, activeWorldInfoId: id }));
  }, []);

  const toggleGroupChat = useCallback(() => {
    setState(prev => ({ ...prev, isGroupChat: !prev.isGroupChat }));
  }, []);

  const addCharacterToGroup = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      activeCharacterIds: prev.activeCharacterIds.includes(id)
        ? prev.activeCharacterIds
        : [...prev.activeCharacterIds, id],
    }));
  }, []);

  const removeCharacterFromGroup = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      activeCharacterIds: prev.activeCharacterIds.filter(c => c !== id),
    }));
  }, []);

  return {
    ...state,
    setActiveCharacter,
    setActivePersona,
    setActivePreset,
    setActiveWorldInfo,
    toggleGroupChat,
    addCharacterToGroup,
    removeCharacterFromGroup,
  };
}
