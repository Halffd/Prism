import { Box, Text, useInput } from 'ink';
import { colors, spacing } from '../theme/nocturnal-editorial';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  placeholder?: string;
}

export function ChatInput({ value, onChange, onSubmit, isLoading, placeholder }: ChatInputProps) {
  useInput((input, key) => {
    if (key.return) {
      if (!isLoading && value.trim().length > 0) {
        onSubmit();
      }
      return;
    }
    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      return;
    }
    if (key.ctrl && input === 'w') {
      const parts = value.split(/\s+/);
      parts.pop();
      onChange(parts.join(' '));
      return;
    }
    if (key.ctrl && input === 'u') {
      onChange('');
      return;
    }
    if (!key.ctrl && !key.meta && input) {
      onChange(value + input);
    }
  });

  const displayValue = value.length > 0 ? value : (placeholder ?? 'Type a message...');
  const displayColor = value.length > 0 ? colors.on_surface : colors.outline_variant;

  return (
    <Box
      flexDirection="column"
      paddingX={spacing.lg}
      paddingY={spacing.sm}
    >
      <Box gap={spacing.sm}>
        <Text color={colors.primary} bold>
          {'>'}
        </Text>
        <Text color={displayColor}>
          {displayValue}
        </Text>
        {!isLoading && <Text color={colors.primary}>_</Text>}
        {isLoading && <Text color={colors.tertiary}>(generating...)</Text>}
      </Box>
      <Text color={colors.outline_variant} dimColor>
        Enter: send | Ctrl+w: del word | Ctrl+u: clear | Esc: settings
      </Text>
    </Box>
  );
}
