import { useMemo, useState } from 'react';
import {
  searchChatSessions,
  type ChatSessionView,
  type SearchFilters,
  type SearchHit,
} from './chat-features';

export interface SearchPanelProps {
  /** The session the user is looking at. */
  currentSessionId: string;
  /** Every session that can be searched. */
  sessions: ChatSessionView[];
  onClose: () => void;
  /** Called with the session and message index of a selected hit. */
  onSelect: (sessionId: string, messageIndex: number) => void;
}

const emptyFilters: SearchFilters = {
  text: '',
  regex: false,
  caseSensitive: false,
  role: '',
  tag: '',
  unreadOnly: false,
  includeArchived: false,
  fileFilter: '',
  sort: 'newest',
};

/**
 * The search panel.
 *
 * It searches the current session or every session and honours every
 * filter: text (literal or regular expression), case, role, tag, unread
 * state, archived sessions and the file the message's context came from.
 */
export function SearchPanel({
  currentSessionId,
  sessions,
  onClose,
  onSelect,
}: SearchPanelProps) {
  const [scope, setScope] = useState<'session' | 'global'>('session');
  const [filters, setFilters] = useState<SearchFilters>(emptyFilters);
  const [applied, setApplied] = useState<SearchFilters>(emptyFilters);

  const searched = useMemo(() => {
    const candidates =
      scope === 'session'
        ? sessions.filter((session) => session.id === currentSessionId)
        : sessions;
    return searchChatSessions(candidates, applied);
  }, [scope, sessions, applied, currentSessionId]);

  const update = <K extends keyof SearchFilters>(
    key: K,
    value: SearchFilters[K],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="search-panel" aria-label="Search messages">
      <header className="search-panel-header">
        <h2>Search</h2>
        <button type="button" onClick={onClose} aria-label="Close search">
          ×
        </button>
      </header>
      <div className="search-panel-filters">
        <fieldset className="search-scope">
          <legend>Scope</legend>
          <label>
            <input
              type="radio"
              name="search-scope"
              checked={scope === 'session'}
              onChange={() => setScope('session')}
            />
            This session only
          </label>
          <label>
            <input
              type="radio"
              name="search-scope"
              checked={scope === 'global'}
              onChange={() => setScope('global')}
            />
            Global
          </label>
        </fieldset>
        <label className="search-text">
          <span>Text</span>
          <input
            type="search"
            value={filters.text}
            placeholder="Search messages"
            onChange={(event) => update('text', event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setApplied(filters);
              }
            }}
          />
        </label>
        <label className="search-checkbox">
          <input
            type="checkbox"
            checked={filters.regex}
            onChange={(event) => update('regex', event.target.checked)}
          />
          Regex
        </label>
        <label className="search-checkbox">
          <input
            type="checkbox"
            checked={filters.caseSensitive}
            onChange={(event) =>
              update('caseSensitive', event.target.checked)
            }
          />
          Case sensitive
        </label>
        <label className="search-select">
          <span>Role</span>
          <select
            value={filters.role ?? ''}
            onChange={(event) =>
              update(
                'role',
                event.target.value as SearchFilters['role'],
              )
            }
          >
            <option value="">Any role</option>
            <option value="user">User</option>
            <option value="assistant">Assistant</option>
            <option value="system">System</option>
          </select>
        </label>
        <label className="search-text">
          <span>Tag</span>
          <input
            type="text"
            value={filters.tag ?? ''}
            placeholder="tag"
            onChange={(event) => update('tag', event.target.value)}
          />
        </label>
        <label className="search-checkbox">
          <input
            type="checkbox"
            checked={filters.unreadOnly}
            onChange={(event) => update('unreadOnly', event.target.checked)}
          />
          Unread only
        </label>
        <label className="search-checkbox">
          <input
            type="checkbox"
            checked={filters.includeArchived}
            onChange={(event) =>
              update('includeArchived', event.target.checked)
            }
          />
          Include archived
        </label>
        <label className="search-text">
          <span>File</span>
          <input
            type="text"
            value={filters.fileFilter ?? ''}
            placeholder="file name or URL"
            onChange={(event) => update('fileFilter', event.target.value)}
          />
        </label>
        <label className="search-select">
          <span>Sort</span>
          <select
            value={filters.sort}
            onChange={(event) =>
              update('sort', event.target.value as SearchFilters['sort'])
            }
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="title">Title</option>
          </select>
        </label>
        <div className="search-panel-buttons">
          <button
            type="button"
            onClick={() => setApplied(filters)}
            className="search-run"
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => {
              setFilters(emptyFilters);
              setApplied(emptyFilters);
            }}
          >
            Clear
          </button>
        </div>
      </div>
      <ul className="search-results" data-testid="search-results">
        {searched.length === 0 ? (
          <li className="search-result-empty">No matches</li>
        ) : (
          searched.map((hit: SearchHit) => (
            <li key={`${hit.sessionId}:${hit.messageId}`}>
              <button
                type="button"
                className="search-result"
                onClick={() => onSelect(hit.sessionId, hit.messageIndex)}
              >
                <span className={`search-result-role ${hit.role}`}>
                  {hit.role}
                </span>
                <span className="search-result-session">
                  {hit.sessionTitle}
                </span>
                <span className="search-result-preview">{hit.preview}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
