import { Box, Text } from 'ink';
import { colors, spacing } from '../theme/nocturnal-editorial';

interface StatusBarProps {
  provider: string;
  model?: string;
  adapterMode: string;
  activeCharacter?: string;
  isGroupChat: boolean;
  messageCount: number;
  isOnline: boolean;
}

export function StatusBar({
  provider,
  model,
  adapterMode,
  activeCharacter,
  isGroupChat,
  messageCount,
  isOnline,
}: StatusBarProps) {
  const providerDisplay = provider.length > 12 ? provider.slice(0, 12) : provider;
  const modeDisplay = adapterMode.toUpperCase();
  const modelDisplay = model
    ? (model.length > 20 ? model.slice(0, 20) + '...' : model)
    : 'no model';

  return (
    <Box
      justifyContent="space-between"
      paddingX={spacing.lg}
      paddingY={spacing.xs}
    >
      <Box gap={spacing.sm}>
        <Text color={isOnline ? colors.success : colors.error} bold>
          {isOnline ? '●' : '○'}
        </Text>
        <Text color={colors.primary} bold>
          {providerDisplay}
        </Text>
        <Text color={colors.on_surface_variant}>
          /
        </Text>
        <Text color={colors.on_surface_variant}>
          {modelDisplay}
        </Text>
        <Text color={colors.outline_variant}>
          [{modeDisplay}]
        </Text>
      </Box>
      <Box gap={spacing.sm}>
        {activeCharacter && (
          <Text color={colors.tertiary}>
            @{activeCharacter}
          </Text>
        )}
        {isGroupChat && (
          <Text color={colors.warning}>
            GROUP
          </Text>
        )}
        <Text color={colors.on_surface_variant}>
          {messageCount}msg
        </Text>
      </Box>
    </Box>
  );
}
