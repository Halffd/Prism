import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionListPanel } from '../popup/SessionListPanel';
import type { DBChatSession } from '@prism/shared-db';

/**
 * The popup's session list shows the tags, the read/unread state and the
 * archive action, and it filters the sessions.
 */
describe('SessionListPanel', () => {
  const sessions: DBChatSession[] = [
    {
      id: 'a',
      title: 'Alpha',
      createdAt: 1,
      updatedAt: 2,
      tags: ['work'],
      read: true,
      archived: false,
    },
    {
      id: 'b',
      title: 'Beta',
      createdAt: 1,
      updatedAt: 3,
      tags: ['fun'],
      read: false,
      archived: true,
    },
  ];

  const renderPanel = (
    overrides: Partial<React.ComponentProps<typeof SessionListPanel>> = {},
  ) => {
    const props = {
      sessions,
      currentSessionId: 'a',
      corruptSessions: [],
      onSelect: jest.fn(),
      onDelete: jest.fn(),
      onToggleRead: jest.fn(),
      onToggleArchive: jest.fn(),
      onSetTags: jest.fn(),
      onRefresh: jest.fn(),
      ...overrides,
    };
    render(<SessionListPanel {...props} />);
    return props;
  };

  /** Show the archived sessions too. */
  const showArchived = () =>
    fireEvent.change(screen.getByLabelText('Filter sessions by archive state'), {
      target: { value: 'all' },
    });

  test('shows a tag chip per session', () => {
    renderPanel();
    showArchived();

    // The tag chip carries the remove button; the filter option with the
    // same text is a different element.
    expect(
      screen.getByLabelText('Remove tag work').parentElement?.textContent,
    ).toContain('work');
    expect(
      screen.getByLabelText('Remove tag fun').parentElement?.textContent,
    ).toContain('fun');
  });

  test('toggles the read state and the archive state', () => {
    const props = renderPanel();
    showArchived();

    // Session "a" is read, so the button marks it unread.
    fireEvent.click(screen.getByLabelText('Mark as unread'));
    expect(props.onToggleRead).toHaveBeenCalledWith('a', false);

    // Session "b" is unread, so its button marks it read.
    fireEvent.click(screen.getByLabelText('Mark as read'));
    expect(props.onToggleRead).toHaveBeenCalledWith('b', true);

    fireEvent.click(screen.getByLabelText('Archive session'));
    expect(props.onToggleArchive).toHaveBeenCalledWith('a', true);

    fireEvent.click(screen.getByLabelText('Unarchive session'));
    expect(props.onToggleArchive).toHaveBeenCalledWith('b', false);
  });

  test('adds and removes a tag', () => {
    const props = renderPanel();

    const tagInput = screen.getByLabelText('Add a tag to Alpha');
    fireEvent.change(tagInput, { target: { value: 'urgent' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    expect(props.onSetTags).toHaveBeenCalledWith('a', ['urgent', 'work']);

    fireEvent.click(screen.getByLabelText('Remove tag work'));
    expect(props.onSetTags).toHaveBeenCalledWith('a', []);
  });

  test('filters the sessions by title, tag, read state and archive state', () => {
    renderPanel();

    // The archived session is hidden by default.
    expect(screen.queryByLabelText('Open session Beta')).toBeNull();

    fireEvent.change(screen.getByLabelText('Filter sessions by title'), {
      target: { value: 'bet' },
    });
    expect(screen.queryByLabelText('Open session Alpha')).toBeNull();

    fireEvent.change(screen.getByLabelText('Filter sessions by title'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('Filter sessions by archive state'), {
      target: { value: 'archived' },
    });
    expect(screen.getByLabelText('Open session Beta')).toBeTruthy();
    expect(screen.queryByLabelText('Open session Alpha')).toBeNull();

    showArchived();
    fireEvent.change(screen.getByLabelText('Filter sessions by tag'), {
      target: { value: 'work' },
    });
    expect(screen.getByLabelText('Open session Alpha')).toBeTruthy();
    expect(screen.queryByLabelText('Open session Beta')).toBeNull();
  });

  test('reports the corrupt sessions instead of hiding the problem', () => {
    renderPanel({
      corruptSessions: [{ id: 'x', reason: 'not an object' }],
    });
    expect(screen.getByRole('alert').textContent).toMatch(/could not be read/i);
  });

  test('exports the selected session and all sessions', async () => {
    const createObjectURL = jest.fn(() => 'blob:prism');
    const revokeObjectURL = jest.fn();
    (global as unknown as { URL: typeof URL }).URL.createObjectURL =
      createObjectURL;
    (global as unknown as { URL: typeof URL }).URL.revokeObjectURL =
      revokeObjectURL;

    renderPanel();

    fireEvent.click(screen.getByText('Export all sessions'));
    // The export builds the envelope before the file is written.
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(screen.getByText(/Exported 2 sessions/)).toBeTruthy();
  });
});
