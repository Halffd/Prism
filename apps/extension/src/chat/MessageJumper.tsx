import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '@prism/shared-types';
import { jumpTarget, messagePreview } from './chat-features';
import { MessageJumpList } from './MessageJumpList';

export interface MessageJumperProps {
  messages: Message[];
  /** Index of the message the jumper is currently anchored to. */
  currentIndex: number;
  /** Called with the index of the message to scroll to. */
  onJump: (index: number) => void;
  /** The scrollable message list. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Floating navigation for a message list.
 *
 * The control sits at the right edge of the list and follows the
 * message the user is reading: the list reserves space for it, so it
 * never covers the text, and its vertical position is recomputed when
 * the list scrolls.
 */
export function MessageJumper({
  messages,
  currentIndex,
  onJump,
  scrollRef,
}: MessageJumperProps) {
  const [listOpen, setListOpen] = useState(false);
  const [offset, setOffset] = useState<number | null>(null);
  const controlRef = useRef<HTMLDivElement>(null);

  const updateOffset = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    const element = container.querySelector<HTMLElement>(
      `[data-message-index="${currentIndex}"]`,
    );
    if (!element) {
      return;
    }
    // The host is sticky at the top of the scrollport, so the position
    // of the control is the distance from the top of the visible area
    // to the current message.
    const elementRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const visibleTop = elementRect.top - containerRect.top;
    const height = controlRef.current?.offsetHeight ?? 120;
    const max = Math.max(0, container.clientHeight - height);
    setOffset(
      Math.min(
        Math.max(visibleTop + elementRect.height / 2 - height / 2, 0),
        max,
      ),
    );
  }, [currentIndex, scrollRef]);

  useEffect(() => {
    updateOffset();
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    container.addEventListener('scroll', updateOffset, { passive: true });
    window.addEventListener('resize', updateOffset);
    return () => {
      container.removeEventListener('scroll', updateOffset);
      window.removeEventListener('resize', updateOffset);
    };
  }, [updateOffset, scrollRef]);

  useEffect(() => {
    if (!listOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setListOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [listOpen]);

  const jump = (direction: -1 | 1) => {
    const target = jumpTarget(currentIndex, messages.length, direction);
    onJump(target);
  };

  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="message-jumper-host">
      <div
        className="message-jumper"
        ref={controlRef}
        style={offset === null ? undefined : { top: `${offset}px` }}
      >
        <button
          type="button"
          className="message-jumper-button"
          onClick={() => jump(-1)}
          disabled={currentIndex <= 0}
          aria-label="Jump to previous message"
          title="Previous message"
        >
          ↑
        </button>
        <button
          type="button"
          className="message-jumper-button message-jumper-list-button"
          onClick={() => setListOpen((open) => !open)}
          aria-expanded={listOpen}
          aria-haspopup="listbox"
          aria-label="Show all messages"
          title="All messages"
        >
          ☰
        </button>
        <button
          type="button"
          className="message-jumper-button"
          onClick={() => jump(1)}
          disabled={currentIndex >= messages.length - 1}
          aria-label="Jump to next message"
          title="Next message"
        >
          ↓
        </button>
        {listOpen ? (
          <MessageJumpList
            messages={messages}
            currentIndex={currentIndex}
            onSelect={(index) => {
              setListOpen(false);
              onJump(index);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The preview shown for a message in the jump list. */
export { messagePreview };
