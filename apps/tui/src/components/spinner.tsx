import { useState, useEffect } from 'react';
import { Text } from 'ink';
import { colors } from '../theme/nocturnal-editorial';

interface SpinnerProps {
  label?: string;
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function Spinner({ label }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return (
    <Text color={colors.tertiary}>
      {FRAMES[frame]} {label ?? 'Loading'}
    </Text>
  );
}
