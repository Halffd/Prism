import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageJumper } from '../chat/MessageJumper';
import { MessageActions } from '../chat/MessageActions';
import { ContextPanel } from '../chat/ContextPanel';
import { SearchPanel } from '../chat/SearchPanel';
import type { Message } from '@prism/shared-types';

const messages: Message[] = [
  {
    id: 'm1',
    role: 'user',
    content: 'The first message',
    timestamp: 1_000,
  },
  {
    id: 'm2',
    role: 'assistant',
    content: 'The second message',
    timestamp: 2_000,
  },
  {
    id: 'm3',
    role: 'user',
    content: 'The third message',
    timestamp: 3_000,
  },
];

describe('MessageJumper', () => {
  it('jumps to the message above and below', () => {
    const onJump = jest.fn();
    render(
      <MessageJumper
        messages={messages}
        currentIndex={1}
        onJump={onJump}
        scrollRef={{ current: null }}
      />,
    );

    fireEvent.click(screen.getByLabelText('Jump to previous message'));
    expect(onJump).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getByLabelText('Jump to next message'));
    expect(onJump).toHaveBeenCalledWith(2);
  });

  it('disables the buttons at the ends of the transcript', () => {
    render(
      <MessageJumper
        messages={messages}
        currentIndex={0}
        onJump={jest.fn()}
        scrollRef={{ current: null }}
      />,
    );
    expect(
      screen.getByLabelText('Jump to previous message').hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByLabelText('Jump to next message').hasAttribute('disabled'),
    ).toBe(false);
  });

  it('lists every message and jumps to the selected one', () => {
    const onJump = jest.fn();
    render(
      <MessageJumper
        messages={messages}
        currentIndex={0}
        onJump={onJump}
        scrollRef={{ current: null }}
      />,
    );

    fireEvent.click(screen.getByLabelText('Show all messages'));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[1].textContent).toContain('The second message');
    expect(options[1].textContent).toContain('assistant');

    fireEvent.click(options[1]);
    expect(onJump).toHaveBeenCalledWith(1);
  });

  it('renders nothing for an empty transcript', () => {
    const { container } = render(
      <MessageJumper
        messages={[]}
        currentIndex={0}
        onJump={jest.fn()}
        scrollRef={{ current: null }}
      />,
    );
    expect(container.querySelector('.message-jumper')).toBeNull();
  });
});

describe('MessageActions', () => {
  const renderActions = (
    message: Message = messages[0],
    overrides: Partial<React.ComponentProps<typeof MessageActions>> = {},
  ) => {
    const props = {
      message,
      index: 0,
      onToggleRead: jest.fn(),
      onSetTag: jest.fn(),
      onFork: jest.fn(),
      onOverwrite: jest.fn(),
      ...overrides,
    };
    render(<MessageActions {...props} />);
    return props;
  };

  it('toggles the read state', () => {
    const props = renderActions();
    fireEvent.click(screen.getByTitle('Mark as unread'));
    expect(props.onToggleRead).toHaveBeenCalledWith(messages[0]);
  });

  it('shows the read action of an unread message', () => {
    renderActions({ ...messages[0], read: false });
    fireEvent.click(screen.getByTitle('Mark as read'));
    expect(screen.getByTitle('Mark as read')).toBeTruthy();
  });

  it('sets a tag through the text input', () => {
    const props = renderActions();
    fireEvent.click(screen.getByTitle('Tag this message'));
    const input = screen.getByLabelText('Tag name');
    fireEvent.change(input, { target: { value: 'urgent' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onSetTag).toHaveBeenCalledWith(messages[0], 'urgent');
  });

  it('removes a tag that is already on the message', () => {
    const props = renderActions({ ...messages[0], tags: ['urgent'] });
    fireEvent.click(screen.getByTitle('Remove tag urgent'));
    expect(props.onSetTag).toHaveBeenCalledWith(
      { ...messages[0], tags: ['urgent'] },
      'urgent',
    );
  });

  it('forks the conversation at the message', () => {
    const props = renderActions();
    fireEvent.click(screen.getByTitle('Fork the conversation up to this message'));
    expect(props.onFork).toHaveBeenCalledWith(messages[0], 0);
  });

  it('edits the message in place', () => {
    const props = renderActions();
    fireEvent.click(screen.getByTitle('Edit this message'));
    const editor = screen.getByLabelText('Edit message');
    fireEvent.change(editor, { target: { value: 'edited text' } });
    fireEvent.click(screen.getByText('Save'));
    expect(props.onOverwrite).toHaveBeenCalledWith(
      messages[0],
      0,
      'edited text',
    );
  });
});

describe('ContextPanel', () => {
  const items = [
    {
      id: 'page:a',
      kind: 'page',
      title: 'A page',
      content: 'hello',
      tokens: 10,
      enabled: true,
      source: 'https://example.com/a',
      priority: 0,
    },
    {
      id: 'file:b',
      kind: 'file',
      title: 'report.pdf',
      content: 'world',
      tokens: 90,
      enabled: true,
      source: 'report.pdf',
      priority: 1,
    },
  ];

  it('shows the token total against the budget', () => {
    render(
      <ContextPanel
        items={items}
        budget={100}
        onBudgetChange={jest.fn()}
        onToggle={jest.fn()}
        onRemove={jest.fn()}
      />,
    );
    expect(screen.getByTestId('context-token-total').textContent).toBe(
      '100 / 100',
    );
  });

  it('marks the item that does not fit the budget', () => {
    const { container } = render(
      <ContextPanel
        items={items}
        budget={50}
        onBudgetChange={jest.fn()}
        onToggle={jest.fn()}
        onRemove={jest.fn()}
      />,
    );
    const dropped = container.querySelectorAll('.context-panel-item.dropped');
    expect(dropped).toHaveLength(1);
  });

  it('toggles and removes an item', () => {
    const onToggle = jest.fn();
    const onRemove = jest.fn();
    render(
      <ContextPanel
        items={items}
        budget={100}
        onBudgetChange={jest.fn()}
        onToggle={onToggle}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByLabelText('Enable A page'));
    expect(onToggle).toHaveBeenCalledWith('page:a');
    fireEvent.click(screen.getByLabelText('Remove report.pdf'));
    expect(onRemove).toHaveBeenCalledWith('file:b');
  });

  it('changes the budget', () => {
    const onBudgetChange = jest.fn();
    render(
      <ContextPanel
        items={items}
        budget={100}
        onBudgetChange={onBudgetChange}
        onToggle={jest.fn()}
        onRemove={jest.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Context token budget'), {
      target: { value: '250' },
    });
    expect(onBudgetChange).toHaveBeenCalledWith(250);
  });
});

describe('SearchPanel', () => {
  const sessions = [
    {
      id: 'a',
      title: 'Alpha',
      updatedAt: 2,
      messages: [
        {
          id: 'm1',
          role: 'user' as const,
          content: 'needle in the haystack',
          timestamp: 1_000,
        },
      ],
    },
  ];

  it('finds a match and reports the message to jump to', () => {
    const onSelect = jest.fn();
    render(
      <SearchPanel
        currentSessionId="a"
        sessions={sessions}
        onClose={jest.fn()}
        onSelect={onSelect}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Search messages'), {
      target: { value: 'needle' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    const result = screen.getByText('needle in the haystack');
    fireEvent.click(result);
    expect(onSelect).toHaveBeenCalledWith('a', 0);
  });

  it('reports nothing when the query matches nothing', () => {
    render(
      <SearchPanel
        currentSessionId="a"
        sessions={sessions}
        onClose={jest.fn()}
        onSelect={jest.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Search messages'), {
      target: { value: 'nothing here' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByText('No matches')).toBeTruthy();
  });
});
