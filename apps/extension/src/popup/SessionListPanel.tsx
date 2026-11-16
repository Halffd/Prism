import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Icon } from '@prism/ui-components';
import type { DBChatSession } from '@prism/shared-db';
import {
  addSessionTag,
  applyBackupEnvelope,
  buildBackupEnvelope,
  collectSessionTags,
  defaultSessionFilters,
  filterSessions,
  isArchived,
  isUnread,
  parseBackupEnvelope,
  removeSessionTag,
  type SessionFilters,
} from './session-data';

interface SessionListPanelProps {
  sessions: DBChatSession[];
  currentSessionId: string;
  corruptSessions: Array<{ id: string; reason: string }>;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onToggleRead: (sessionId: string, read: boolean) => void;
  onToggleArchive: (sessionId: string, archived: boolean) => void;
  onSetTags: (sessionId: string, tags: string[]) => void;
  onRefresh: () => void;
}

/** Download a JSON document as a file. */
function downloadJson(
  data: unknown,
  filename: string,
): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * The popup's session list.
 *
 * It owns the filters (title text, tag, read state, archived state), the
 * per-session tag chips, the read/unread and archive actions, and the
 * import/export of the selected session or of every session.
 */
export function SessionListPanel({
  sessions,
  currentSessionId,
  corruptSessions,
  onSelect,
  onDelete,
  onToggleRead,
  onToggleArchive,
  onSetTags,
  onRefresh,
}: SessionListPanelProps): React.ReactElement {
  const [filters, setFilters] = useState<SessionFilters>(
    defaultSessionFilters(),
  );
  const [tagDraft, setTagDraft] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tags = useMemo(() => collectSessionTags(sessions), [sessions]);
  const visibleSessions = useMemo(
    () => filterSessions(sessions, filters),
    [sessions, filters],
  );

  const updateFilter = useCallback(
    <K extends keyof SessionFilters>(key: K, value: SessionFilters[K]) => {
      setFilters((previous) => ({ ...previous, [key]: value }));
    },
    [],
  );

  const exportSessions = useCallback(
    async (scope: 'selected' | 'all') => {
      setError('');
      try {
        const selected =
          scope === 'selected'
            ? sessions.filter((session) => session.id === currentSessionId)
            : sessions;
        if (selected.length === 0) {
          setError('There is no session to export.');
          return;
        }
        const envelope = await buildBackupEnvelope(selected);
        const name =
          scope === 'selected'
            ? `prism-session-${currentSessionId}.json`
            : 'prism-sessions.json';
        downloadJson(envelope, name);
        setStatus(
          `Exported ${envelope.conversations.length} session${
            envelope.conversations.length === 1 ? '' : 's'
          }.`,
        );
      } catch (exportError) {
        setError(`Export failed: ${(exportError as Error).message}`);
      }
    },
    [sessions, currentSessionId],
  );

  const importSessions = useCallback(
    async (file: File) => {
      setError('');
      setStatus('');
      try {
        const raw = await file.text();
        const parsed = parseBackupEnvelope(raw);
        if (!parsed.ok) {
          setError(parsed.failure.reason);
          return;
        }
        const imported = await applyBackupEnvelope(parsed.envelope);
        onRefresh();
        setStatus(
          `Imported ${imported} session${imported === 1 ? '' : 's'}${
            parsed.migrated ? ' (migrated from an older format)' : ''
          }.`,
        );
      } catch (importError) {
        setError(`Import failed: ${(importError as Error).message}`);
      }
    },
    [onRefresh],
  );

  const applyTag = useCallback(
    (sessionId: string, tag: string) => {
      const session = sessions.find((candidate) => candidate.id === sessionId);
      if (!session) return;
      const trimmed = tag.trim();
      if (!trimmed) return;
      onSetTags(sessionId, addSessionTag(session.tags, trimmed));
      setTagDraft((previous) => ({ ...previous, [sessionId]: '' }));
    },
    [sessions, onSetTags],
  );

  return (
    <div className="session-list-panel">
      <div className="session-filters">
        <input
          type="search"
          className="session-filter-input"
          placeholder="Filter by title"
          aria-label="Filter sessions by title"
          value={filters.text}
          onChange={(event) => updateFilter('text', event.target.value)}
        />
        <select
          className="session-filter-select"
          aria-label="Filter sessions by tag"
          value={filters.tag}
          onChange={(event) => updateFilter('tag', event.target.value)}
        >
          <option value="">All tags</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
        <select
          className="session-filter-select"
          aria-label="Filter sessions by read state"
          value={filters.read}
          onChange={(event) =>
            updateFilter('read', event.target.value as SessionFilters['read'])
          }
        >
          <option value="all">Read & unread</option>
          <option value="read">Read</option>
          <option value="unread">Unread</option>
        </select>
        <select
          className="session-filter-select"
          aria-label="Filter sessions by archive state"
          value={filters.archived}
          onChange={(event) =>
            updateFilter(
              'archived',
              event.target.value as SessionFilters['archived'],
            )
          }
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
      </div>

      <div className="session-transfer-actions">
        <button
          type="button"
          className="menu-action-btn"
          onClick={() => void exportSessions('selected')}
        >
          Export this session
        </button>
        <button
          type="button"
          className="menu-action-btn"
          onClick={() => void exportSessions('all')}
        >
          Export all sessions
        </button>
        <button
          type="button"
          className="menu-action-btn"
          onClick={() => {
            fileInputRef.current?.click();
          }}
        >
          Import sessions
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          aria-label="Import sessions from a file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importSessions(file);
          }}
        />
      </div>

      {status && <div className="session-transfer-status">{status}</div>}
      {error && (
        <div className="session-transfer-error" role="alert">
          {error}
        </div>
      )}

      {corruptSessions.length > 0 && (
        <div className="session-corrupt-warning" role="alert">
          {corruptSessions.length} stored session
          {corruptSessions.length === 1 ? '' : 's'} could not be read and
          {corruptSessions.length === 1 ? ' was' : ' were'} skipped:{' '}
          {corruptSessions
            .map((entry) => `${entry.id || '(no id)'}: ${entry.reason}`)
            .join('; ')}
        </div>
      )}

      <div className="session-list">
        {visibleSessions.length === 0 && (
          <div className="no-sessions">No sessions match these filters.</div>
        )}
        {visibleSessions.map((session) => {
          const unread = isUnread(session);
          const archived = isArchived(session);
          const draft = tagDraft[session.id] ?? '';
          return (
            <div
              key={session.id}
              className={`session-item${
                session.id === currentSessionId ? ' active-session' : ''
              }${archived ? ' archived-session' : ''}${
                unread ? ' unread-session' : ''
              }`}
            >
              <div className="session-item-main">
                <button
                  type="button"
                  onClick={() => onSelect(session.id)}
                  className={
                    session.id === currentSessionId ? 'active' : ''
                  }
                  aria-label={`Open session ${session.title}`}
                >
                  <span className="session-title">
                    {session.title}
                    {unread && (
                      <span className="unread-dot" aria-label="Unread" />
                    )}
                  </span>
                </button>
                <div className="session-tags">
                  {(session.tags ?? []).map((tag) => (
                    <span key={tag} className="session-tag-chip">
                      {tag}
                      <button
                        type="button"
                        className="session-tag-remove"
                        title={`Remove tag ${tag}`}
                        aria-label={`Remove tag ${tag}`}
                        onClick={() =>
                          onSetTags(
                            session.id,
                            removeSessionTag(session.tags, tag),
                          )
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    className="session-tag-input"
                    placeholder="+ tag"
                    aria-label={`Add a tag to ${session.title}`}
                    value={draft}
                    onChange={(event) =>
                      setTagDraft((previous) => ({
                        ...previous,
                        [session.id]: event.target.value,
                      }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        applyTag(session.id, draft);
                      }
                    }}
                  />
                </div>
              </div>
              <div className="session-item-actions">
                <button
                  type="button"
                  onClick={() => onToggleRead(session.id, unread)}
                  className="session-toggle-btn"
                  title={unread ? 'Mark as read' : 'Mark as unread'}
                  aria-label={
                    unread ? 'Mark as read' : 'Mark as unread'
                  }
                >
                  {unread ? '◉' : '○'}
                </button>
                <button
                  type="button"
                  onClick={() => onToggleArchive(session.id, !archived)}
                  className="session-toggle-btn"
                  title={archived ? 'Unarchive session' : 'Archive session'}
                  aria-label={
                    archived ? 'Unarchive session' : 'Archive session'
                  }
                >
                  {archived ? '📥' : '📤'}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(session.id)}
                  className="delete-session-btn"
                  title="Delete session"
                  aria-label={`Delete session ${session.title}`}
                >
                  <Icon name="delete" title="Delete session" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SessionListPanel;
