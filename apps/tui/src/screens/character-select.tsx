import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, spacing } from '../theme/nocturnal-editorial';
import type { CharacterCard } from '@prism/shared-types';

interface CharacterSelectProps {
  characters: CharacterCard[];
  activeCharacterId: string | null;
  activeCharacterIds: string[];
  isGroupChat: boolean;
  onSelect: (id: string | null) => void;
  onAddToGroup: (id: string) => void;
  onRemoveFromGroup: (id: string) => void;
  onToggleGroupChat: () => void;
  onClose: () => void;
}

export function CharacterSelect({
  characters,
  activeCharacterId,
  activeCharacterIds,
  isGroupChat,
  onSelect,
  onAddToGroup,
  onRemoveFromGroup,
  onToggleGroupChat,
  onClose,
}: CharacterSelectProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIdx(i => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIdx(i => Math.min(characters.length, i + 1));
      return;
    }
    if (key.return) {
      if (selectedIdx === characters.length) {
        onSelect(null);
      } else {
        const char = characters[selectedIdx];
        if (isGroupChat) {
          if (activeCharacterIds.includes(char.name)) {
            onRemoveFromGroup(char.name);
          } else {
            onAddToGroup(char.name);
          }
        } else {
          onSelect(char.name);
        }
      }
      return;
    }
    if (input === 'g') {
      onToggleGroupChat();
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={spacing.xl} paddingY={spacing.lg}>
      <Box paddingBottom={spacing.lg} gap={spacing.sm}>
        <Text color={colors.primary} bold>
          Characters
        </Text>
        <Text color={isGroupChat ? colors.warning : colors.on_surface_variant}>
          {isGroupChat ? '[GROUP MODE]' : '[SINGLE]'}
        </Text>
      </Box>

      {characters.length === 0 && (
        <Text color={colors.on_surface_variant} italic>
          No characters loaded. Import a character card to get started.
        </Text>
      )}

      {characters.map((char, i) => {
        const isActive = isGroupChat
          ? activeCharacterIds.includes(char.name)
          : activeCharacterId === char.name;

        return (
          <Box key={char.id} gap={spacing.sm}>
            <Text color={i === selectedIdx ? colors.on_surface : colors.on_surface_variant}>
              {i === selectedIdx ? '>' : ' '}
            </Text>
            <Text color={isActive ? colors.tertiary : colors.on_surface_variant}>
              {char.name}
            </Text>
            {isActive && (
              <Text color={colors.primary}>*</Text>
            )}
            <Text color={colors.outline_variant}>
              {char.description?.slice(0, 50) ?? ''}
            </Text>
          </Box>
        );
      })}

      <Box gap={spacing.sm} paddingTop={spacing.sm}>
        <Text color={selectedIdx === characters.length ? colors.on_surface : colors.on_surface_variant}>
          {selectedIdx === characters.length ? '> ' : '  '}
        </Text>
        <Text color={colors.on_surface_variant}>
          None (raw chat)
        </Text>
      </Box>

      <Box paddingTop={spacing.lg}>
        <Text color={colors.outline_variant}>
          Enter: select | g: toggle group | Esc: back
        </Text>
      </Box>
    </Box>
  );
}
