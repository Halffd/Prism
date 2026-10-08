import { describe, expect, it } from '@jest/globals';
import presetReducer, {
  addPreset,
  updatePreset,
  removePreset,
  setActivePreset,
} from '../presetSlice';
import type { PromptPreset } from '@prism/shared-types';

const initialState = { presets: [], activePresetId: null, isLoading: false };

describe('presetSlice', () => {
  const preset: PromptPreset = {
    id: 'p1',
    name: 'Default',
    description: '',
    entries: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('addPreset appends', () => {
    const s = presetReducer(initialState, addPreset(preset));
    expect(s.presets).toHaveLength(1);
    expect(s.presets[0].id).toBe('p1');
  });

  it('updatePreset patches fields', () => {
    let s = presetReducer(initialState, addPreset(preset));
    s = presetReducer(
      s,
      updatePreset({ id: 'p1', updates: { name: 'Renamed' } }),
    );
    expect(s.presets[0].name).toBe('Renamed');
  });

  it('removePreset filters and clears active id if matching', () => {
    let s = presetReducer(initialState, addPreset(preset));
    s = presetReducer(s, setActivePreset('p1'));
    s = presetReducer(s, removePreset('p1'));
    expect(s.presets).toHaveLength(0);
    expect(s.activePresetId).toBeNull();
  });
});
