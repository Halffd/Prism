/**
 * Pure chat feature logic: jumper navigation, forks, edits, search and
 * context budgeting.
 *
 * The extension keeps its transcripts in IndexedDB and does its own
 * matching here, so these functions mirror the rules of the Rust core
 * (`crates/prism-core/src/{session_ops,search,context}.rs`). They are
 * deliberately pure so they can be unit tested without a browser.
 */

import type { Message, SessionContextItem } from '@prism/shared-types';

/** A session as the chat surfaces see it. */
export interface ChatSessionView {
  id: string;
  title: string;
  updatedAt: number;
  archived?: boolean;
  tags?: string[];
  read?: boolean;
  forkedFrom?: string;
  forkedAtMessage?: number;
  messages: Message[];
}

// ---------------------------------------------------------------------------
// Message jumper
// ---------------------------------------------------------------------------

/**
 * The message the jumper should move to.
 *
 * `direction` is -1 for "above" and 1 for "below". The result is
 * clamped to the transcript, so the first and last messages stay
 * reachable and the buttons never move the focus out of the list.
 */
export function jumpTarget(
  currentIndex: number,
  messageCount: number,
  direction: -1 | 1,
): number {
  if (messageCount <= 0) {
    return 0;
  }
  const bounded = Math.min(Math.max(currentIndex, 0), messageCount - 1);
  return Math.min(Math.max(bounded + direction, 0), messageCount - 1);
}

/** A short, single-line preview of a message. */
export function messagePreview(message: Message, maxChars = 60): string {
  const flat = message.content.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) {
    return flat;
  }
  return `${flat.slice(0, maxChars)}…`;
}

// ---------------------------------------------------------------------------
// Fork / edit / overwrite
// ---------------------------------------------------------------------------

/** The result of branching a conversation. */
export interface ForkResult {
  messages: Message[];
  /** Index in the source conversation the fork branched at. */
  atMessage: number;
}

/**
 * Copies the messages up to and including `atIndex` into a new branch.
 *
 * The source conversation is left untouched. Messages keep their ids so
 * a tag, read flag or context follows the message into the fork.
 */
export function forkMessages(
  messages: Message[],
  atIndex: number,
): ForkResult {
  if (messages.length === 0) {
    return { messages: [], atMessage: 0 };
  }
  const cut = Math.min(Math.max(atIndex, 0), messages.length - 1);
  return {
    messages: messages.slice(0, cut + 1).map((message) => ({ ...message })),
    atMessage: cut,
  };
}

/** The title a fork gets: it says where it came from. */
export function forkTitle(sourceTitle: string): string {
  const base = sourceTitle.trim() || 'Chat';
  return `${base} (fork)`;
}

/**
 * Gives copied messages their own ids.
 *
 * The transcript store is keyed by the message id, so a fork cannot
 * keep the ids of the messages it copied: they would collide with the
 * source. The new id keeps the old one inside it, so the link between
 * the two transcripts stays readable.
 */
export function withNewMessageIds(
  messages: Message[],
  sessionId: string,
): Message[] {
  return messages.map((message) => ({
    ...message,
    id: `${sessionId}_${message.id}`,
  }));
}

/**
 * Replaces the content of one message, keeping the rest of the
 * transcript.
 *
 * This is the "edit" operation: only the message itself changes.
 */
export function editMessage(
  messages: Message[],
  index: number,
  newContent: string,
  now = Date.now(),
): Message[] {
  if (index < 0 || index >= messages.length) {
    return messages.slice();
  }
  return messages.map((message, position) =>
    position === index
      ? { ...message, content: newContent, editedAt: now }
      : message,
  );
}

/**
 * Replaces the content of one message and drops the messages after it.
 *
 * The dropped tail answered the old text, so it is stale after the
 * replacement. This is the "overwrite" operation.
 */
export function overwriteMessage(
  messages: Message[],
  index: number,
  newContent: string,
  now = Date.now(),
): Message[] {
  if (index < 0 || index >= messages.length) {
    return messages.slice();
  }
  const edited = editMessage(messages, index, newContent, now);
  return edited.slice(0, index + 1);
}

/** Adds a tag to a message when it is not there yet. */
export function addTag(message: Message, tag: string): Message {
  const clean = tag.trim();
  if (!clean) {
    return message;
  }
  const tags = message.tags ?? [];
  if (tags.some((existing) => existing.toLowerCase() === clean.toLowerCase())) {
    return message;
  }
  return { ...message, tags: [...tags, clean] };
}

/** Removes a tag from a message. */
export function removeTag(message: Message, tag: string): Message {
  const tags = message.tags ?? [];
  return {
    ...message,
    tags: tags.filter((existing) => existing.toLowerCase() !== tag.toLowerCase()),
  };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** How search results are ordered. */
export type SearchSort = 'newest' | 'oldest' | 'title';

/** The filters of the search panel. */
export interface SearchFilters {
  /** Free text. An empty text matches every message. */
  text: string;
  /** Treat `text` as a regular expression. */
  regex: boolean;
  /** Match case exactly. */
  caseSensitive: boolean;
  /** Only messages with this role. */
  role?: 'user' | 'assistant' | 'system' | '';
  /** Only messages carrying this tag. */
  tag?: string;
  /** Only unread messages. */
  unreadOnly: boolean;
  /** Include archived sessions. */
  includeArchived: boolean;
  /** Only messages whose attached context points at this file or URL. */
  fileFilter?: string;
  /** Ordering of the results. */
  sort: SearchSort;
}

/** One matching message. */
export interface SearchHit {
  sessionId: string;
  sessionTitle: string;
  messageId: string;
  messageIndex: number;
  role: Message['role'];
  preview: string;
  /** True when the text filter matched the message. */
  matched: boolean;
  timestamp: number;
}

function textMatches(text: string, filters: SearchFilters): boolean {
  const needle = filters.text.trim();
  if (!needle) {
    return true;
  }
  if (filters.regex) {
    try {
      const pattern = filters.caseSensitive
        ? new RegExp(needle)
        : new RegExp(needle, 'i');
      return pattern.test(text);
    } catch {
      // A half-typed regular expression is treated as plain text, so the
      // panel keeps returning something useful.
      return filters.caseSensitive
        ? text.includes(needle)
        : text.toLowerCase().includes(needle.toLowerCase());
    }
  }
  return filters.caseSensitive
    ? text.includes(needle)
    : text.toLowerCase().includes(needle.toLowerCase());
}

/** Does the attached context of a message point at `filter`? */
export function contextMatchesFilter(
  message: Message,
  filter: string | undefined,
): boolean {
  const needle = filter?.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const context = message.context;
  if (!context) {
    return false;
  }
  const parts: string[] = [];
  if (context.url) {
    parts.push(context.url);
  }
  if (context.title) {
    parts.push(context.title);
  }
  if (context.appName) {
    parts.push(context.appName);
  }
  // An attached document names itself in the metadata of the context.
  const metadata = context.metadata;
  if (metadata && typeof metadata === 'object') {
    for (const value of Object.values(metadata)) {
      if (typeof value === 'string') {
        parts.push(value);
      }
    }
  }
  return parts.join(' ').toLowerCase().includes(needle);
}

function scopeMatches(
  session: ChatSessionView,
  message: Message,
  filters: SearchFilters,
): boolean {
  if (!filters.includeArchived && session.archived) {
    return false;
  }
  if (filters.role && message.role !== filters.role) {
    return false;
  }
  const tag = filters.tag?.trim();
  if (
    tag &&
    !(message.tags ?? []).some(
      (existing) => existing.toLowerCase() === tag.toLowerCase(),
    )
  ) {
    return false;
  }
  if (filters.unreadOnly && message.read !== false) {
    return false;
  }
  if (!contextMatchesFilter(message, filters.fileFilter)) {
    return false;
  }
  return true;
}

/**
 * Searches the given sessions and returns the matching messages.
 *
 * The scope filters (role, tag, unread, archived, file) narrow the
 * candidates first, the text filter narrows them further and the sort
 * decides the order.
 */
export function searchChatSessions(
  sessions: ChatSessionView[],
  filters: SearchFilters,
): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const session of sessions) {
    session.messages.forEach((message, index) => {
      if (!scopeMatches(session, message, filters)) {
        return;
      }
      const matched = textMatches(message.content, filters);
      if (!matched) {
        return;
      }
      hits.push({
        sessionId: session.id,
        sessionTitle: session.title,
        messageId: message.id,
        messageIndex: index,
        role: message.role,
        preview: messagePreview(message, 120),
        matched,
        timestamp: message.timestamp,
      });
    });
  }
  return sortSearchHits(hits, sessions, filters.sort);
}

/** Orders the hits of a search. */
export function sortSearchHits(
  hits: SearchHit[],
  sessions: ChatSessionView[],
  sort: SearchSort,
): SearchHit[] {
  const updated = new Map(sessions.map((s) => [s.id, s.updatedAt]));
  const titles = new Map(sessions.map((s) => [s.id, s.title]));
  return [...hits].sort((a, b) => {
    if (sort === 'title') {
      const byTitle = (titles.get(a.sessionId) ?? '').localeCompare(
        titles.get(b.sessionId) ?? '',
      );
      if (byTitle !== 0) {
        return byTitle;
      }
    } else {
      const byUpdated =
        (updated.get(b.sessionId) ?? 0) - (updated.get(a.sessionId) ?? 0);
      if (byUpdated !== 0) {
        return sort === 'newest' ? byUpdated : -byUpdated;
      }
    }
    // The messages of one conversation keep the order they were sent
    // in, so the result reads like the transcript.
    return a.messageIndex - b.messageIndex;
  });
}

// ---------------------------------------------------------------------------
// Context management
// ---------------------------------------------------------------------------

/**
 * Rough token estimate of a text.
 *
 * Four characters per token is the usual approximation for English
 * prose; CJK text is denser and is counted per character instead.
 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  let cjk = 0;
  let total = 0;
  for (const character of text) {
    total += 1;
    const code = character.codePointAt(0) ?? 0;
    if (
      (code >= 0x3040 && code <= 0x309f) ||
      (code >= 0x30a0 && code <= 0x30ff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0x20000 && code <= 0x2fa1f)
    ) {
      cjk += 1;
    }
  }
  return cjk + Math.ceil((total - cjk) / 4);
}

/**
 * Trims context items to fit a token budget.
 *
 * Only enabled items cost anything. They are admitted in priority order
 * (lowest number first); items of the same priority keep their original
 * order. An item that does not fit on its own is skipped rather than
 * blocking the rest, and the items that were dropped come back
 * disabled so the panel can show what was cut.
 */
export function contextBudget(
  items: SessionContextItem[],
  maxTokens: number,
): SessionContextItem[] {
  const result = items.map((item) => ({ ...item }));
  const order = result
    .map((_, index) => index)
    .sort((a, b) => {
      const byPriority = (result[a].priority ?? 0) - (result[b].priority ?? 0);
      return byPriority !== 0 ? byPriority : a - b;
    });
  let spent = 0;
  const admitted = new Set<number>();
  for (const index of order) {
    const item = result[index];
    if (!item.enabled) {
      admitted.add(index);
      continue;
    }
    const cost = item.tokens;
    if (spent + cost <= maxTokens) {
      spent += cost;
      admitted.add(index);
    }
  }
  return result.map((item, index) =>
    admitted.has(index) ? item : { ...item, enabled: false },
  );
}

/** The token cost of the enabled context items. */
export function enabledContextTokens(items: SessionContextItem[]): number {
  return items.reduce(
    (sum, item) => (item.enabled ? sum + item.tokens : sum),
    0,
  );
}

/**
 * Builds context items from the context attached to the messages of a
 * session.
 *
 * A page, a selection and a document each become one item. Items that
 * are already known keep their stored state (disabled, tokens), so a
 * user decision survives a reload.
 */
export function contextItemsFromMessages(
  messages: Message[],
  known: SessionContextItem[] = [],
): SessionContextItem[] {
  const items: SessionContextItem[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const context = message.context;
    if (!context) {
      continue;
    }
    const source =
      context.url ?? context.title ?? context.appName ?? 'conversation';
    const id = `${context.type}:${source}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const existing = known.find((item) => item.id === id);
    const content =
      context.selectedText ?? context.fullText ?? context.title ?? source;
    items.push(
      existing
        ? { ...existing, content, tokens: estimateTokens(content) }
        : {
            id,
            kind: context.type,
            title: context.title ?? source,
            content,
            tokens: estimateTokens(content),
            enabled: true,
            source,
            priority: items.length,
          },
    );
  }
  return items;
}
