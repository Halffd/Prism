import type { Message, SessionContextItem } from '@prism/shared-types';
import {
  addTag,
  contextBudget,
  contextItemsFromMessages,
  contextMatchesFilter,
  editMessage,
  enabledContextTokens,
  estimateTokens,
  forkMessages,
  forkTitle,
  jumpTarget,
  messagePreview,
  overwriteMessage,
  removeTag,
  searchChatSessions,
  sortSearchHits,
  withNewMessageIds,
  type ChatSessionView,
  type SearchFilters,
} from '../chat/chat-features';

function message(
  id: string,
  role: Message['role'],
  content: string,
  extra: Partial<Message> = {},
): Message {
  return {
    id,
    role,
    content,
    timestamp: 1_000 + Number(id.replace(/\D/g, '')) || 1_000,
    ...extra,
  };
}

const filters = (overrides: Partial<SearchFilters> = {}): SearchFilters => ({
  text: '',
  regex: false,
  caseSensitive: false,
  role: '',
  tag: '',
  unreadOnly: false,
  includeArchived: false,
  fileFilter: '',
  sort: 'newest',
  ...overrides,
});

describe('message jumper', () => {
  it('moves to the message above and below', () => {
    expect(jumpTarget(2, 5, -1)).toBe(1);
    expect(jumpTarget(2, 5, 1)).toBe(3);
  });

  it('stays inside the transcript at the ends', () => {
    expect(jumpTarget(0, 5, -1)).toBe(0);
    expect(jumpTarget(4, 5, 1)).toBe(4);
  });

  it('handles an empty transcript', () => {
    expect(jumpTarget(0, 0, 1)).toBe(0);
  });

  it('clamps an out-of-range current index', () => {
    expect(jumpTarget(99, 3, -1)).toBe(1);
  });

  it('shortens a preview to a single line', () => {
    const long = message('1', 'user', 'x'.repeat(200));
    const preview = messagePreview(long);
    expect(preview.length).toBeLessThanOrEqual(61);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('flattens newlines in a preview', () => {
    const multi = message('1', 'user', 'first\nsecond');
    expect(messagePreview(multi)).toBe('first second');
  });
});

describe('forking', () => {
  const messages = [
    message('1', 'user', 'one'),
    message('2', 'assistant', 'two'),
    message('3', 'user', 'three'),
  ];

  it('copies the messages up to and including the fork point', () => {
    const result = forkMessages(messages, 1);
    expect(result.messages).toHaveLength(2);
    expect(result.messages.map((m) => m.content)).toEqual(['one', 'two']);
    expect(result.atMessage).toBe(1);
  });

  it('leaves the source conversation unchanged', () => {
    const before = messages.map((m) => ({ ...m }));
    forkMessages(messages, 1);
    expect(messages).toEqual(before);
  });

  it('does not share message objects with the source', () => {
    const result = forkMessages(messages, 2);
    result.messages[0].content = 'changed';
    expect(messages[0].content).toBe('one');
  });

  it('clamps the fork point to the transcript', () => {
    expect(forkMessages(messages, 99).atMessage).toBe(2);
    expect(forkMessages(messages, -5).atMessage).toBe(0);
  });

  it('names the fork after its source', () => {
    expect(forkTitle('Ideas')).toBe('Ideas (fork)');
    expect(forkTitle('  ')).toBe('Chat (fork)');
  });

  it('gives copied messages their own ids', () => {
    const copied = withNewMessageIds(forkMessages(messages, 1).messages, 'fork-1');
    expect(copied.map((m) => m.id)).toEqual(['fork-1_1', 'fork-1_2']);
    expect(messages[0].id).toBe('1');
  });
});

describe('editing and overwriting', () => {
  const messages = [
    message('1', 'user', 'one'),
    message('2', 'assistant', 'two'),
    message('3', 'user', 'three'),
  ];

  it('edits one message in place and keeps the rest', () => {
    const edited = editMessage(messages, 1, 'edited', 5_000);
    expect(edited).toHaveLength(3);
    expect(edited[1].content).toBe('edited');
    expect(edited[1].editedAt).toBe(5_000);
    expect(edited[0].content).toBe('one');
    expect(edited[2].content).toBe('three');
  });

  it('does not change the original array', () => {
    editMessage(messages, 0, 'edited');
    expect(messages[0].content).toBe('one');
  });

  it('drops the stale tail when a message is overwritten', () => {
    const overwritten = overwriteMessage(messages, 1, 'replacement', 5_000);
    expect(overwritten).toHaveLength(2);
    expect(overwritten[1].content).toBe('replacement');
    expect(overwritten[1].editedAt).toBe(5_000);
  });

  it('ignores an out-of-range index', () => {
    expect(editMessage(messages, 9, 'x')).toHaveLength(3);
    expect(overwriteMessage(messages, -1, 'x')).toHaveLength(3);
  });

  it('adds and removes a tag', () => {
    const tagged = addTag(message('1', 'user', 'x'), 'important');
    expect(tagged.tags).toEqual(['important']);
    expect(addTag(tagged, 'IMPORTANT').tags).toEqual(['important']);
    expect(removeTag(tagged, 'important').tags).toEqual([]);
  });
});

describe('search', () => {
  const sessions: ChatSessionView[] = [
    {
      id: 'a',
      title: 'Alpha',
      updatedAt: 300,
      messages: [
        message('1', 'user', 'Hello world', { tags: ['greeting'] }),
        message('2', 'assistant', 'The answer is 42', {
          read: false,
          tags: ['important'],
        }),
      ],
    },
    {
      id: 'b',
      title: 'Beta',
      updatedAt: 100,
      archived: true,
      messages: [
        message('3', 'user', 'hello again', {
          context: {
            type: 'page',
            url: 'https://example.com/docs',
            title: 'Docs',
          },
        }),
      ],
    },
  ];

  it('finds matches across sessions', () => {
    const hits = searchChatSessions(
      sessions,
      filters({ text: 'hello', includeArchived: true }),
    );
    expect(hits).toHaveLength(2);
    expect(hits.map((hit) => hit.sessionId).sort()).toEqual(['a', 'b']);
  });

  it('matches case-insensitively by default', () => {
    const hits = searchChatSessions(
      sessions,
      filters({ text: 'HELLO', includeArchived: true }),
    );
    expect(hits).toHaveLength(2);
  });

  it('honours case sensitivity', () => {
    const hits = searchChatSessions(
      sessions,
      filters({ text: 'HELLO', caseSensitive: true }),
    );
    expect(hits).toHaveLength(0);
  });

  it('treats the query as a regular expression when asked', () => {
    const hits = searchChatSessions(
      sessions,
      filters({ text: 'answer is \\d+', regex: true }),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('2');
  });

  it('falls back to a literal match for an invalid regular expression', () => {
    const hits = searchChatSessions(
      sessions,
      filters({ text: 'answer is (', regex: true }),
    );
    expect(hits).toHaveLength(0);
  });

  it('filters by role', () => {
    const hits = searchChatSessions(
      sessions,
      filters({ text: 'hello', role: 'assistant' }),
    );
    expect(hits).toHaveLength(0);
  });

  it('filters by tag', () => {
    const hits = searchChatSessions(sessions, filters({ tag: 'important' }));
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('2');
  });

  it('filters unread messages', () => {
    const hits = searchChatSessions(sessions, filters({ unreadOnly: true }));
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('2');
  });

  it('excludes archived sessions unless asked for them', () => {
    expect(searchChatSessions(sessions, filters())).toHaveLength(2);
    const withoutArchived = searchChatSessions(
      sessions,
      filters({ text: 'hello' }),
    );
    expect(withoutArchived.map((hit) => hit.sessionId)).not.toContain('b');
    const withArchived = searchChatSessions(
      sessions,
      filters({ text: 'hello', includeArchived: true }),
    );
    expect(withArchived.map((hit) => hit.sessionId)).toContain('b');
  });

  it('filters by the file the context came from', () => {
    const hits = searchChatSessions(
      sessions,
      filters({ fileFilter: 'example.com', includeArchived: true }),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('3');
  });

  it('matches a context file filter against the title as well', () => {
    expect(
      contextMatchesFilter(
        message('1', 'user', 'x', {
          context: { type: 'page', title: 'Report.pdf' },
        }),
        'report',
      ),
    ).toBe(true);
  });

  it('matches a context file filter against attached document metadata', () => {
    expect(
      contextMatchesFilter(
        message('1', 'user', 'x', {
          context: {
            type: 'page',
            metadata: { fileName: 'quarterly-report.docx' },
          },
        }),
        'quarterly',
      ),
    ).toBe(true);
    expect(
      contextMatchesFilter(
        message('1', 'user', 'x', {
          context: { type: 'page', metadata: { fileName: 'other.txt' } },
        }),
        'quarterly',
      ),
    ).toBe(false);
  });

  it('sorts by newest and oldest session', () => {
    const newest = searchChatSessions(
      sessions,
      filters({ sort: 'newest', includeArchived: true }),
    );
    expect(newest[0].sessionId).toBe('a');
    const oldest = searchChatSessions(
      sessions,
      filters({ sort: 'oldest', includeArchived: true }),
    );
    expect(oldest[0].sessionId).toBe('b');
  });

  it('sorts by title', () => {
    const byTitle = searchChatSessions(sessions, filters({ sort: 'title' }));
    expect(byTitle[0].sessionTitle).toBe('Alpha');
  });

  it('orders hits without changing the original list', () => {
    const hits = searchChatSessions(sessions, filters());
    const sorted = sortSearchHits(hits, sessions, 'title');
    expect(sorted).not.toBe(hits);
    expect(hits[0].sessionId).toBe('a');
  });

  it('returns nothing when the text matches nothing', () => {
    expect(searchChatSessions(sessions, filters({ text: 'zzz' }))).toHaveLength(
      0,
    );
  });
});

describe('context management', () => {
  const item = (
    id: string,
    tokens: number,
    priority: number,
    enabled = true,
  ): SessionContextItem => ({
    id,
    kind: 'page',
    title: id,
    content: 'x'.repeat(tokens * 4),
    tokens,
    enabled,
    source: `https://example.com/${id}`,
    priority,
  });

  it('estimates tokens at four characters per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('counts CJK text per character', () => {
    expect(estimateTokens('日本語')).toBe(3);
  });

  it('keeps everything that fits in the budget', () => {
    const items = [item('a', 10, 0), item('b', 10, 1)];
    const trimmed = contextBudget(items, 100);
    expect(trimmed.every((entry) => entry.enabled)).toBe(true);
    expect(enabledContextTokens(trimmed)).toBe(20);
  });

  it('drops the lowest priority item when over budget', () => {
    const items = [item('a', 10, 0), item('b', 10, 5)];
    const trimmed = contextBudget(items, 15);
    expect(trimmed[0].enabled).toBe(true);
    expect(trimmed[1].enabled).toBe(false);
  });

  it('keeps the original order of the returned items', () => {
    const items = [item('a', 10, 5), item('b', 10, 0)];
    const trimmed = contextBudget(items, 15);
    expect(trimmed.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(trimmed[0].enabled).toBe(false);
    expect(trimmed[1].enabled).toBe(true);
  });

  it('does not count disabled items against the budget', () => {
    const items = [item('a', 10, 0, false), item('b', 10, 1)];
    const trimmed = contextBudget(items, 10);
    expect(trimmed[0].enabled).toBe(false);
    expect(trimmed[1].enabled).toBe(true);
  });

  it('skips an oversized item instead of blocking the rest', () => {
    const items = [item('a', 100, 0), item('b', 10, 1)];
    const trimmed = contextBudget(items, 20);
    expect(trimmed[0].enabled).toBe(false);
    expect(trimmed[1].enabled).toBe(true);
  });

  it('builds context items from the messages of a session', () => {
    const items = contextItemsFromMessages([
      message('1', 'user', 'x', {
        context: {
          type: 'page',
          url: 'https://example.com/page',
          title: 'A page',
          fullText: 'hello world',
        },
      }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe('https://example.com/page');
    expect(items[0].enabled).toBe(true);
    expect(items[0].tokens).toBe(estimateTokens('hello world'));
  });

  it('keeps the stored state of a known item', () => {
    const stored: SessionContextItem[] = [
      {
        id: 'page:https://example.com/page',
        kind: 'page',
        title: 'A page',
        content: 'old',
        tokens: 99,
        enabled: false,
        source: 'https://example.com/page',
        priority: 0,
      },
    ];
    const items = contextItemsFromMessages(
      [
        message('1', 'user', 'x', {
          context: {
            type: 'page',
            url: 'https://example.com/page',
            title: 'A page',
            fullText: 'hello world',
          },
        }),
      ],
      stored,
    );
    expect(items[0].enabled).toBe(false);
    expect(items[0].tokens).toBe(estimateTokens('hello world'));
  });
});
