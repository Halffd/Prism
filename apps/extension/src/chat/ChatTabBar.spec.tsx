import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatTabBar } from '../chat/ChatTabBar';
import type { ChatSession } from '@prism/shared-types';

describe('ChatTabBar', () => {
  const sessions: ChatSession[] = [
    {
      id: 'a',
      userId: '',
      title: 'First chat',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'b',
      userId: '',
      title: 'Second chat',
      messages: [],
      createdAt: 2,
      updatedAt: 2,
    },
  ];

  it('renders nothing when there are no tabs', () => {
    const { container } = render(
      <ChatTabBar
        openTabs={[]}
        activeTabId=""
        sessions={sessions}
        onSelect={jest.fn()}
        onClose={jest.fn()}
        onNewTab={jest.fn()}
      />,
    );
    expect(container.querySelector('.chat-tab-bar')).toBeNull();
  });

  it('renders one tab per open chat', () => {
    render(
      <ChatTabBar
        openTabs={['a', 'b']}
        activeTabId="a"
        sessions={sessions}
        onSelect={jest.fn()}
        onClose={jest.fn()}
        onNewTab={jest.fn()}
      />,
    );
    expect(screen.getByText('First chat')).toBeTruthy();
    expect(screen.getByText('Second chat')).toBeTruthy();
  });

  it('marks the focused tab as selected', () => {
    render(
      <ChatTabBar
        openTabs={['a', 'b']}
        activeTabId="b"
        sessions={sessions}
        onSelect={jest.fn()}
        onClose={jest.fn()}
        onNewTab={jest.fn()}
      />,
    );
    expect(screen.getByText('Second chat').closest('[role="tab"]')?.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('First chat').closest('[role="tab"]')?.getAttribute('aria-selected')).toBe('false');
  });

  it('reports the tab the user clicked', () => {
    const onSelect = jest.fn();
    render(
      <ChatTabBar
        openTabs={['a', 'b']}
        activeTabId="a"
        sessions={sessions}
        onSelect={onSelect}
        onClose={jest.fn()}
        onNewTab={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Second chat'));
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('reports the tab the user closed', () => {
    const onClose = jest.fn();
    render(
      <ChatTabBar
        openTabs={['a', 'b']}
        activeTabId="a"
        sessions={sessions}
        onSelect={jest.fn()}
        onClose={onClose}
        onNewTab={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Close Second chat'));
    expect(onClose).toHaveBeenCalledWith('b');
  });

  it('reports a new chat request', () => {
    const onNewTab = jest.fn();
    render(
      <ChatTabBar
        openTabs={['a']}
        activeTabId="a"
        sessions={sessions}
        onSelect={jest.fn()}
        onClose={jest.fn()}
        onNewTab={onNewTab}
      />,
    );
    fireEvent.click(screen.getByLabelText('New chat'));
    expect(onNewTab).toHaveBeenCalled();
  });

  it('hides the close button when only one tab is open', () => {
    render(
      <ChatTabBar
        openTabs={['a']}
        activeTabId="a"
        sessions={sessions}
        onSelect={jest.fn()}
        onClose={jest.fn()}
        onNewTab={jest.fn()}
      />,
    );
    expect(screen.queryByLabelText('Close First chat')).toBeNull();
  });

  it('labels a chat without a title as untitled', () => {
    render(
      <ChatTabBar
        openTabs={['missing']}
        activeTabId="missing"
        sessions={sessions}
        onSelect={jest.fn()}
        onClose={jest.fn()}
        onNewTab={jest.fn()}
      />,
    );
    expect(screen.getByText('Untitled Chat')).toBeTruthy();
  });
});
