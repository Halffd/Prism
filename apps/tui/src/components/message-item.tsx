import { Box, Text } from 'ink';
import { colors, spacing } from '../theme/nocturnal-editorial';

interface MessageItemProps {
  role: 'system' | 'user' | 'assistant';
  content: string;
  characterName?: string;
  isStreaming?: boolean;
}

const roleColors: Record<string, string> = {
  system: colors.outline_variant,
  user: colors.primary,
  assistant: colors.tertiary,
};

const roleLabels: Record<string, string> = {
  system: 'SYS',
  user: 'YOU',
  assistant: 'AI',
};

export function MessageItem({ role, content, characterName, isStreaming }: MessageItemProps) {
  const color = roleColors[role] ?? colors.on_surface;
  const label = characterName ?? roleLabels[role] ?? role;

  const lines = content.split('\n');

  return (
    <Box flexDirection="column" paddingBottom={spacing.sm}>
      <Box gap={spacing.sm}>
        <Text color={color} bold>
          [{label}]
        </Text>
        {isStreaming && (
          <Text color={colors.primary}>...</Text>
        )}
      </Box>
      <Box paddingLeft={spacing.lg} flexDirection="column">
        {lines.map((line, i) => (
          <Text key={i} color={colors.on_surface}>
            {line || ' '}
          </Text>
        ))}
        {content.length === 0 && (
          <Text color={colors.on_surface_variant}>...</Text>
        )}
      </Box>
    </Box>
  );
}
