import { Box, Text } from 'ink';
import { colors, spacing } from '../theme/nocturnal-editorial';
import { MessageItem } from './message-item';
import type { Message } from '@prism/shared-types';

interface MessageListProps {
  messages: Message[];
  isStreaming: boolean;
  characterNames: Record<string, string>;
  maxHeight?: number;
}

export function MessageList({ messages, isStreaming, characterNames, maxHeight }: MessageListProps) {
  const visibleMessages = maxHeight
    ? messages.slice(-maxHeight)
    : messages;

  return (
    <Box flexDirection="column" paddingX={spacing.lg} flexGrow={1}>
      {visibleMessages.length === 0 && (
        <Box paddingY={spacing.xxl}>
          <Text color={colors.on_surface_variant} italic>
            No messages yet. Start typing to begin.
          </Text>
        </Box>
      )}
      {visibleMessages.map((msg, i) => {
        const isLast = i === visibleMessages.length - 1;
        const charName = msg.characterId
          ? characterNames[msg.characterId]
          : undefined;

        return (
          <MessageItem
            key={msg.id}
            role={msg.role}
            content={msg.content}
            characterName={charName}
            isStreaming={isLast && isStreaming && msg.role === 'assistant'}
          />
        );
      })}
    </Box>
  );
}
