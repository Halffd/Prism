import React from 'react';
import type { ChatSession } from '@prism/shared-types';

interface ChatTabBarProps {
  /** The open tabs, in the order they are shown. */
  openTabs: string[];
  /** The session id of the focused tab. */
  activeTabId: string;
  /** All known sessions, used to label the tabs. */
  sessions: ChatSession[];
  /** Called when a tab is clicked. */
  onSelect: (sessionId: string) => void;
  /** Called when a tab's close button is clicked. */
  onClose: (sessionId: string) => void;
  /** Called when the new-chat button is clicked. */
  onNewTab: () => void;
}

/**
 * The strip of open chat tabs.
 *
 * The tabs live inside the single popup, so switching between
 * conversations happens here rather than by opening another window.
 */
export const ChatTabBar: React.FC<ChatTabBarProps> = ({
  openTabs,
  activeTabId,
  sessions,
  onSelect,
  onClose,
  onNewTab,
}) => {
  if (openTabs.length === 0) {
    return null;
  }

  const titleFor = (sessionId: string): string => {
    const session = sessions.find((entry) => entry.id === sessionId);
    return session?.title?.trim() || 'Untitled Chat';
  };

  return (
    <div className="chat-tab-bar" role="tablist" aria-label="Open chats">
      {openTabs.map((sessionId) => {
        const isActive = sessionId === activeTabId;
        return (
          <div
            key={sessionId}
            className={`chat-tab ${isActive ? 'active' : ''}`}
            role="tab"
            aria-selected={isActive}
          >
            <button
              className="chat-tab-label"
              onClick={() => onSelect(sessionId)}
              title={titleFor(sessionId)}
            >
              {titleFor(sessionId)}
            </button>
            {openTabs.length > 1 && (
              <button
                className="chat-tab-close"
                onClick={() => onClose(sessionId)}
                title="Close tab"
                aria-label={`Close ${titleFor(sessionId)}`}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
      <button
        className="chat-tab-new"
        onClick={onNewTab}
        title="New chat"
        aria-label="New chat"
      >
        +
      </button>
    </div>
  );
};
