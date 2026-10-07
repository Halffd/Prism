import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '@prism/redux-store';
import {
  setActivePersona,
  addPersona,
  removePersona,
} from '@prism/redux-store';
import { savePersona, deletePersona } from '@prism/shared-db';
import type { PersonaProfile } from '@prism/shared-types';
import './SillyTavernComponents.scss';

export function PersonaSelector() {
  const dispatch = useDispatch();
  const { personas, activePersonaId } = useSelector(
    (state: RootState) => state.personas,
  );

  const activePersona = personas.find((p) => p.id === activePersonaId) ?? null;

  const handleSelect = useCallback(
    (id: string | null) => {
      dispatch(setActivePersona(id));
    },
    [dispatch],
  );

  const handleCreate = useCallback(async () => {
    const persona: PersonaProfile = {
      id: `persona_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: 'New Persona',
      description: '',
      personality: '',
      scenario: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    dispatch(addPersona(persona));
    await savePersona(persona);
    dispatch(setActivePersona(persona.id));
  }, [dispatch]);

  const handleRemove = useCallback(
    async (id: string) => {
      dispatch(removePersona(id));
      await deletePersona(id);
    },
    [dispatch],
  );

  return (
    <div className="st-persona-selector">
      <div className="st-selector-header">
        <span className="st-selector-label">PERSONA</span>
        <div className="st-selector-actions">
          <button className="st-btn-ghost" onClick={handleCreate}>
            + New
          </button>
        </div>
      </div>

      {activePersona && (
        <div className="st-active-card">
          <div className="st-active-card-name">{activePersona.name}</div>
          <button
            className="st-btn-ghost st-btn-clear"
            onClick={() => handleSelect(null)}
          >
            Clear
          </button>
        </div>
      )}

      <div className="st-persona-list">
        {personas.map((persona) => (
          <div
            key={persona.id}
            className={`st-persona-item ${persona.id === activePersonaId ? 'active' : ''}`}
            onClick={() =>
              handleSelect(persona.id === activePersonaId ? null : persona.id)
            }
          >
            <div className="st-persona-item-name">{persona.name}</div>
            <button
              className="st-btn-icon"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(persona.id);
              }}
              title="Delete persona"
            >
              x
            </button>
          </div>
        ))}
        {personas.length === 0 && (
          <div className="st-empty">No personas created</div>
        )}
      </div>
    </div>
  );
}
