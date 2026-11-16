import { useEffect, useRef } from 'react';
import type { Message } from '@prism/shared-types';
import { messagePreview } from './chat-features';

export interface MessageJumpListProps {
  messages: Message[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

/**
 * The list of every message in the session.
 *
 * It is a listbox: the arrow keys move the selection, Enter and Space
 * open the selected message.
 */
export function MessageJumpList({
  messages,
  currentIndex,
  onSelect,
}: MessageJumpListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>(
      '[data-active="true"]',
    );
    active?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const focusedIndex = Number(
      (event.target as HTMLElement).dataset.index ?? currentIndex,
    );
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = Math.min(
        Math.max(focusedIndex + (event.key === 'ArrowDown' ? 1 : -1), 0),
        messages.length - 1,
      );
      const target = listRef.current?.querySelector<HTMLElement>(
        `[data-index="${next}"]`,
      );
      target?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(focusedIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      (event.target as HTMLElement).blur();
    }
  };

  return (
    <div
      className="message-jump-list"
      role="listbox"
      aria-label="All messages in this session"
      ref={listRef}
      onKeyDown={handleKeyDown}
    >
      {messages.map((message, index) => (
        <button
          type="button"
          role="option"
          aria-selected={index === currentIndex}
          data-index={index}
          data-active={index === currentIndex}
          key={message.id}
          className={`message-jump-list-item${
            index === currentIndex ? ' active' : ''
          }`}
          onClick={() => onSelect(index)}
        >
          <span className={`message-jump-role ${message.role}`}>
            {message.role}
          </span>
          <span className="message-jump-preview">
            {messagePreview(message)}
          </span>
        </button>
      ))}
    </div>
  );
}
