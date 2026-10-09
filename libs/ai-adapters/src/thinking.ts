import type { Message, ThinkingConfig } from '@prism/shared-types';

const SCRATCH_INSTRUCTION =
  'Before answering, reason through the problem step by step inside <thinking></thinking> tags, then give the final answer after the closing tag.';

/** True when a request asks for extended thinking via the prompt fallback. */
export function isThinkingEnabled(thinking?: ThinkingConfig): boolean {
  return thinking?.enabled === true;
}

/**
 * Prepend the scratchpad instruction to the first user message.
 * Returns a new array; does not mutate the input messages.
 */
export function applyThinkingToMessages(
  messages: Message[],
  thinking?: ThinkingConfig,
): Message[] {
  if (!isThinkingEnabled(thinking)) return messages;
  const result = [...messages];
  const firstUserIdx = result.findIndex((m) => m.role === 'user');
  if (firstUserIdx === -1) return result;
  const firstUser = result[firstUserIdx];
  result[firstUserIdx] = {
    ...firstUser,
    content: `${SCRATCH_INSTRUCTION}\n\n${firstUser.content}`,
  };
  return result;
}

/**
 * Extract `<thinking>…</thinking>` from a response and return the cleaned
 * final content plus the reasoning text.
 */
export function stripThinkingFromContent(content: string): {
  content: string;
  thinking?: string;
} {
  if (!content.includes('<thinking>')) return { content };
  const match = content.match(/<thinking>([\s\S]*?)<\/thinking>/);
  return {
    content: content.replace(/<thinking>[\s\S]*?<\/thinking>\s*/, '').trim(),
    thinking: match?.[1]?.trim(),
  };
}
