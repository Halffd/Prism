import { useCallback, useEffect, useState } from 'react';
import type { Snippet, SnippetTriggerMode } from '@prism/shared-types';
import {
  getSnippets,
  saveSnippet,
  deleteSnippet,
  DEFAULT_SNIPPETS,
} from '@prism/shared-db';
import './SnippetManager.scss';

interface SnippetManagerProps {
  onClose?: () => void;
}

type EditorState = {
  id: string | null;
  name: string;
  shortcut: string;
  text: string;
  group: string;
  triggerMode: SnippetTriggerMode;
};

/**
 * The snippet manager.
 *
 * Lists every snippet (including the built-in ones), and lets the user add,
 * edit and delete their own. Built-in snippets can be edited but not
 * deleted, so the defaults stay available while remaining customisable.
 */
export function SnippetManager({ onClose }: SnippetManagerProps) {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const stored = await getSnippets();
      setSnippets(stored);
    } catch (err) {
      console.error('Failed to load snippets:', err);
      setError('Could not load snippets.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startNew = useCallback(() => {
    setEditor({
      id: null,
      name: '',
      shortcut: '',
      text: '',
      group: '',
      triggerMode: 'standalone',
    });
    setError(null);
  }, []);

  const startEdit = useCallback((snippet: Snippet) => {
    setEditor({
      id: snippet.id,
      name: snippet.name,
      shortcut: snippet.shortcut,
      text: snippet.text,
      group: snippet.group ?? '',
      triggerMode: snippet.triggerMode ?? 'standalone',
    });
    setError(null);
  }, []);

  const save = useCallback(async () => {
    if (!editor) {
      return;
    }

    const name = editor.name.trim();
    const shortcut = editor.shortcut.trim();

    if (!name || !shortcut) {
      setError('A snippet needs a name and a trigger.');
      return;
    }

    const duplicate = snippets.some(
      (s) =>
        s.id !== editor.id && s.shortcut.toLowerCase() === shortcut.toLowerCase(),
    );
    if (duplicate) {
      setError(`The trigger "${shortcut}" is already used by another snippet.`);
      return;
    }

    const existing = editor.id
      ? snippets.find((s) => s.id === editor.id)
      : undefined;

    const snippet: Snippet = {
      id: editor.id ?? `snippet_${Date.now()}`,
      name,
      shortcut,
      text: editor.text,
      group: editor.group.trim() || undefined,
      triggerMode: editor.triggerMode,
      expansionMode: 'text',
      builtIn: existing?.builtIn,
      createdAt: existing?.createdAt ?? Date.now(),
    };

    try {
      await saveSnippet(snippet);
      await load();
      setEditor(null);
      setError(null);
    } catch (err) {
      console.error('Failed to save snippet:', err);
      setError('Could not save the snippet.');
    }
  }, [editor, snippets, load]);

  const remove = useCallback(
    async (snippet: Snippet) => {
      if (snippet.builtIn) {
        return;
      }
      try {
        await deleteSnippet(snippet.id);
        await load();
      } catch (err) {
        console.error('Failed to delete snippet:', err);
        setError('Could not delete the snippet.');
      }
    },
    [load],
  );

  const groups = Array.from(
    new Set(snippets.map((s) => s.group).filter((g): g is string => !!g)),
  ).sort();

  return (
    <div className="snippet-manager">
      <div className="snippet-manager-header">
        <h3>Snippets</h3>
        <div className="snippet-manager-header-actions">
          <button className="snippet-add-btn" onClick={startNew}>
            + New snippet
          </button>
          {onClose && (
            <button className="snippet-close-btn" onClick={onClose} title="Close">
              ✕
            </button>
          )}
        </div>
      </div>

      {error && <div className="snippet-error">{error}</div>}

      {editor && (
        <div className="snippet-editor">
          <input
            type="text"
            className="snippet-input"
            placeholder="Snippet name"
            value={editor.name}
            onChange={(e) =>
              setEditor({ ...editor, name: e.target.value })
            }
          />
          <input
            type="text"
            className="snippet-input"
            placeholder="Trigger (e.g. /fix)"
            value={editor.shortcut}
            onChange={(e) =>
              setEditor({ ...editor, shortcut: e.target.value })
            }
          />
          <textarea
            className="snippet-textarea"
            placeholder="Text inserted by this snippet"
            rows={3}
            value={editor.text}
            onChange={(e) => setEditor({ ...editor, text: e.target.value })}
          />
          <div className="snippet-editor-row">
            <input
              type="text"
              className="snippet-input"
              placeholder="Group (optional)"
              value={editor.group}
              onChange={(e) =>
                setEditor({ ...editor, group: e.target.value })
              }
            />
            <select
              className="snippet-select"
              value={editor.triggerMode}
              onChange={(e) =>
                setEditor({
                  ...editor,
                  triggerMode: e.target.value as SnippetTriggerMode,
                })
              }
              title="When the trigger expands"
            >
              <option value="standalone">Whole input only</option>
              <option value="anywhere">Anywhere in input</option>
            </select>
          </div>
          <div className="snippet-editor-actions">
            <button className="snippet-save-btn" onClick={save}>
              Save
            </button>
            <button className="snippet-cancel-btn" onClick={() => setEditor(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="snippet-list">
        {groups.map((group) => (
          <div key={group} className="snippet-group">
            <div className="snippet-group-title">{group}</div>
            {snippets
              .filter((s) => s.group === group)
              .map((snippet) => (
                <SnippetRow
                  key={snippet.id}
                  snippet={snippet}
                  onEdit={() => startEdit(snippet)}
                  onDelete={() => remove(snippet)}
                />
              ))}
          </div>
        ))}

        {snippets.filter((s) => !s.group).length > 0 && (
          <div className="snippet-group">
            <div className="snippet-group-title">Ungrouped</div>
            {snippets
              .filter((s) => !s.group)
              .map((snippet) => (
                <SnippetRow
                  key={snippet.id}
                  snippet={snippet}
                  onEdit={() => startEdit(snippet)}
                  onDelete={() => remove(snippet)}
                />
              ))}
          </div>
        )}

        {snippets.length === 0 && (
          <div className="snippet-empty">No snippets yet.</div>
        )}
      </div>
    </div>
  );
}

interface SnippetRowProps {
  snippet: Snippet;
  onEdit: () => void;
  onDelete: () => void;
}

function SnippetRow({ snippet, onEdit, onDelete }: SnippetRowProps) {
  return (
    <div className="snippet-item">
      <div className="snippet-item-main">
        <div className="snippet-item-name">
          {snippet.name}
          {snippet.builtIn && <span className="snippet-builtin-badge">built-in</span>}
        </div>
        <div className="snippet-item-info">
          <span className="snippet-trigger">{snippet.shortcut}</span>
          <span className="snippet-mode">
            {(snippet.triggerMode ?? 'standalone') === 'standalone'
              ? 'whole input'
              : 'anywhere'}
          </span>
        </div>
        <div className="snippet-item-text">
          {snippet.text.substring(0, 60)}
          {snippet.text.length > 60 ? '…' : ''}
        </div>
      </div>
      <div className="snippet-item-actions">
        <button
          className="snippet-edit-btn"
          onClick={onEdit}
          title="Edit this snippet"
        >
          Edit
        </button>
        {!snippet.builtIn && (
          <button
            className="snippet-delete-btn"
            onClick={onDelete}
            title="Delete this snippet"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

export { DEFAULT_SNIPPETS };
