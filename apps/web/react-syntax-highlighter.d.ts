// The web chat page uses react-syntax-highlighter, whose upstream types are
// not installed in this workspace. These minimal declarations keep the
// studio build type-safe without pulling in an extra dependency.
declare module 'react-syntax-highlighter' {
  import type { ComponentType, HTMLAttributes } from 'react';
  export const Prism: ComponentType<HTMLAttributes<HTMLElement> & {
    language?: string;
    PreTag?: unknown;
    style?: unknown;
    showLineNumbers?: boolean;
    inline?: boolean;
    wrapLongLines?: boolean;
    customStyle?: unknown;
  }>;
  const SyntaxHighlighter: typeof Prism;
  export default SyntaxHighlighter;
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  export const atomDark: Record<string, unknown>;
}
