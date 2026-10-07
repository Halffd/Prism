import React, { useState, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '@prism/redux-store';
import {
  addCharacter,
  updateCharacter,
  removeCharacter,
  setActiveCharacter,
} from '@prism/redux-store';
import { saveCharacter, deleteCharacter } from '@prism/shared-db';
import type { CharacterCard } from '@prism/shared-types';
import { importV2CharacterCard, importPngCharacterCard, exportV2CharacterCard } from '@prism/context-manager';
import './SillyTavernComponents.scss';

const EMPTY_CARD: Omit<CharacterCard, 'id' | 'createdAt' | 'updatedAt'> = {
  spec: 'chara_card_v2',
  specVersion: '2.0',
  name: '',
  description: '',
  personality: '',
  scenario: '',
  firstMes: '',
  mesExample: '',
  creatorNotes: '',
  systemPrompt: '',
  postHistoryInstructions: '',
  alternateGreetings: [],
  tags: [],
  creator: '',
  characterVersion: '1.0',
  extensions: {},
};

interface CharacterCardEditorProps {
  characterId?: string | null;
  onClose?: () => void;
}

export function CharacterCardEditor({ characterId, onClose }: CharacterCardEditorProps) {
  const dispatch = useDispatch();
  const characters = useSelector((state: RootState) => state.characters.characters);
  const existing = characterId ? characters.find(c => c.id === characterId) : null;

  const [form, setForm] = useState<Partial<CharacterCard>>(
    existing ?? { ...EMPTY_CARD }
  );
  const [activeTab, setActiveTab] = useState<'description' | 'personality' | 'scenario' | 'first-mes' | 'examples' | 'system' | 'advanced'>('description');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateField = useCallback(<K extends keyof CharacterCard>(key: K, value: CharacterCard[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    const now = Date.now();
    const card: CharacterCard = {
      id: existing?.id ?? `char_${now}_${Math.random().toString(36).slice(2, 8)}`,
      spec: 'chara_card_v2',
      specVersion: '2.0',
      name: form.name ?? 'Unnamed',
      description: form.description ?? '',
      personality: form.personality ?? '',
      scenario: form.scenario ?? '',
      firstMes: form.firstMes ?? '',
      mesExample: form.mesExample ?? '',
      creatorNotes: form.creatorNotes ?? '',
      systemPrompt: form.systemPrompt ?? '',
      postHistoryInstructions: form.postHistoryInstructions ?? '',
      alternateGreetings: form.alternateGreetings ?? [],
      tags: form.tags ?? [],
      creator: form.creator ?? '',
      characterVersion: form.characterVersion ?? '1.0',
      extensions: form.extensions ?? {},
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (existing) {
      dispatch(updateCharacter({ id: card.id, updates: card }));
    } else {
      dispatch(addCharacter(card));
    }
    await saveCharacter(card);
    dispatch(setActiveCharacter(card.id));
    onClose?.();
  }, [form, existing, dispatch, onClose]);

  const handleDelete = useCallback(async () => {
    if (!existing) return;
    dispatch(removeCharacter(existing.id));
    await deleteCharacter(existing.id);
    onClose?.();
  }, [existing, dispatch, onClose]);

  const handleExport = useCallback(() => {
    if (!existing) return;
    const v2 = exportV2CharacterCard(existing);
    const blob = new Blob([JSON.stringify(v2, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${existing.name.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [existing]);

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      let card: CharacterCard;
      if (file.type === 'image/png' || file.name.endsWith('.png')) {
        card = await importPngCharacterCard(file);
      } else {
        const text = await file.text();
        card = importV2CharacterCard(JSON.parse(text));
      }
      setForm(card);
    } catch (err) {
      console.error('Import failed:', err);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const tabs = [
    { key: 'description', label: 'Description' },
    { key: 'personality', label: 'Personality' },
    { key: 'scenario', label: 'Scenario' },
    { key: 'first-mes', label: 'First Message' },
    { key: 'examples', label: 'Examples' },
    { key: 'system', label: 'System Prompt' },
    { key: 'advanced', label: 'Advanced' },
  ] as const;

  return (
    <div className="st-card-editor">
      <div className="st-card-editor-header">
        <h3>{existing ? 'Edit Character' : 'New Character'}</h3>
        <div className="st-card-editor-actions">
          <button className="st-btn-ghost" onClick={() => fileInputRef.current?.click()}>Import</button>
          {existing && <button className="st-btn-ghost" onClick={handleExport}>Export</button>}
          <button className="st-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.png"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
      </div>

      <div className="st-card-editor-name">
        <input
          type="text"
          value={form.name ?? ''}
          onChange={e => updateField('name', e.target.value)}
          placeholder="Character name"
          className="st-input-name"
        />
      </div>

      <div className="st-card-editor-tabs">
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`st-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="st-card-editor-body">
        {activeTab === 'description' && (
          <textarea
            className="st-textarea"
            value={form.description ?? ''}
            onChange={e => updateField('description', e.target.value)}
            placeholder="Character description..."
            rows={12}
          />
        )}
        {activeTab === 'personality' && (
          <textarea
            className="st-textarea"
            value={form.personality ?? ''}
            onChange={e => updateField('personality', e.target.value)}
            placeholder="Character personality traits..."
            rows={12}
          />
        )}
        {activeTab === 'scenario' && (
          <textarea
            className="st-textarea"
            value={form.scenario ?? ''}
            onChange={e => updateField('scenario', e.target.value)}
            placeholder="Scenario / setting..."
            rows={12}
          />
        )}
        {activeTab === 'first-mes' && (
          <>
            <textarea
              className="st-textarea"
              value={form.firstMes ?? ''}
              onChange={e => updateField('firstMes', e.target.value)}
              placeholder="First message (greeting)..."
              rows={8}
            />
            <div className="st-field-group">
              <label className="st-label">Alternate Greetings (one per line)</label>
              <textarea
                className="st-textarea"
                value={(form.alternateGreetings ?? []).join('\n---\n')}
                onChange={e => updateField('alternateGreetings', e.target.value.split('\n---\n'))}
                placeholder="Alternate first messages..."
                rows={4}
              />
            </div>
          </>
        )}
        {activeTab === 'examples' && (
          <textarea
            className="st-textarea"
            value={form.mesExample ?? ''}
            onChange={e => updateField('mesExample', e.target.value)}
            placeholder="<START>\n{{user}}: Hello\n{{char}}: *waves* Hi there!"
            rows={12}
          />
        )}
        {activeTab === 'system' && (
          <>
            <div className="st-field-group">
              <label className="st-label">System Prompt Override</label>
              <textarea
                className="st-textarea"
                value={form.systemPrompt ?? ''}
                onChange={e => updateField('systemPrompt', e.target.value)}
                placeholder="Overrides the default system prompt..."
                rows={6}
              />
            </div>
            <div className="st-field-group">
              <label className="st-label">Post-History Instructions</label>
              <textarea
                className="st-textarea"
                value={form.postHistoryInstructions ?? ''}
                onChange={e => updateField('postHistoryInstructions', e.target.value)}
                placeholder="Instructions appended after chat history..."
                rows={4}
              />
            </div>
          </>
        )}
        {activeTab === 'advanced' && (
          <div className="st-advanced-fields">
            <div className="st-field-group">
              <label className="st-label">Creator</label>
              <input
                type="text"
                className="st-input"
                value={form.creator ?? ''}
                onChange={e => updateField('creator', e.target.value)}
                placeholder="Creator name"
              />
            </div>
            <div className="st-field-group">
              <label className="st-label">Character Version</label>
              <input
                type="text"
                className="st-input"
                value={form.characterVersion ?? ''}
                onChange={e => updateField('characterVersion', e.target.value)}
                placeholder="1.0"
              />
            </div>
            <div className="st-field-group">
              <label className="st-label">Creator Notes</label>
              <textarea
                className="st-textarea"
                value={form.creatorNotes ?? ''}
                onChange={e => updateField('creatorNotes', e.target.value)}
                placeholder="Notes for other users..."
                rows={4}
              />
            </div>
            <div className="st-field-group">
              <label className="st-label">Tags (comma-separated)</label>
              <input
                type="text"
                className="st-input"
                value={(form.tags ?? []).join(', ')}
                onChange={e => updateField('tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                placeholder="roleplay, fantasy, original"
              />
            </div>
          </div>
        )}
      </div>

      <div className="st-card-editor-footer">
        {existing && (
          <button className="st-btn-danger" onClick={handleDelete}>Delete</button>
        )}
        <div className="st-card-editor-footer-right">
          <button className="st-btn-primary" onClick={handleSave}>
            {existing ? 'Save Changes' : 'Create Character'}
          </button>
        </div>
      </div>
    </div>
  );
}
