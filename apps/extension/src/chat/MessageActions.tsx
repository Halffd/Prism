import { useState } from 'react';
import type { Message } from '@prism/shared-types';

export interface MessageActionsProps {
  message: Message;
  /** Toggles the read flag of the message. */
  onToggleRead: (message: Message) => void;
  /** Adds or removes a tag on the message. */
  onSetTag: (message: Message, tag: string) => void;
  /** Branches a new session from this message. */
  onFork: (message: Message, index: number) => void;
  /** Replaces the content of this message with an edited text. */
  onOverwrite: (message: Message, index: number, content: string) => void;
  /** The index of the message in the session. */
  index: number;
}

/**
 * The action row under a message.
 *
 * Every action works on the message itself: tags, the read flag, a
 * branch of the conversation and an in-place edit of the text.
 */
export function MessageActions({
  message,
  index,
  onToggleRead,
  onSetTag,
  onFork,
  onOverwrite,
}: MessageActionsProps) {
  const [tagOpen, setTagOpen] = useState(false);
  const [tagValue, setTagValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  const isRead = message.read !== false;
  const tags = message.tags ?? [];

  const submitTag = () => {
    const tag = tagValue.trim();
    if (tag) {
      onSetTag(message, tag);
      setTagValue('');
    }
    setTagOpen(false);
  };

  const submitEdit = () => {
    onOverwrite(message, index, draft);
    setEditing(false);
  };

  return (
    <div className="message-actions" data-testid="message-actions">
      <button
        type="button"
        className="message-action-btn"
        onClick={() => setTagOpen((open) => !open)}
        aria-expanded={tagOpen}
        title="Tag this message"
      >
        # Tag
      </button>
      <button
        type="button"
        className="message-action-btn"
        onClick={() => onToggleRead(message)}
        title={isRead ? 'Mark as unread' : 'Mark as read'}
      >
        {isRead ? 'Mark unread' : 'Mark read'}
      </button>
      <button
        type="button"
        className="message-action-btn"
        onClick={() => onFork(message, index)}
        title="Fork the conversation up to this message"
      >
       ⑂ Fork
      </button>
      <button
        type="button"
        className="message-action-btn"
        onClick={() => {
          setDraft(message.content);
          setEditing((value) => !value);
        }}
        aria-expanded={editing}
        title="Edit this message"
      >
        ✎ Edit
      </button>
      {tags.length > 0 ? (
        <span className="message-action-tags">
          {tags.map((tag) => (
            <button
              type="button"
              key={tag}
              className="message-action-tag"
              onClick={() => onSetTag(message, tag)}
              title={`Remove tag ${tag}`}
            >
              {tag} ×
            </button>
          ))}
        </span>
      ) : null}
      {tagOpen ? (
        <span className="message-action-tag-editor">
          <input
            type="text"
            value={tagValue}
            aria-label="Tag name"
            placeholder="tag name"
            onChange={(event) => setTagValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                submitTag();
              } else if (event.key === 'Escape') {
                setTagOpen(false);
              }
            }}
          />
          <button type="button" onClick={submitTag}>
            Apply
          </button>
        </span>
      ) : null}
      {editing ? (
        <div className="message-action-editor">
          <textarea
            value={draft}
            aria-label="Edit message"
            rows={3}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="message-action-editor-buttons">
            <button type="button" onClick={submitEdit}>
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(message.content);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
