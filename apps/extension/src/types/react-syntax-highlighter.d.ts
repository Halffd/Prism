/**
 * Type declarations for react-syntax-highlighter, which ships without its
 * own .d.ts files. Only the exports used by this project are declared.
 */
declare module 'react-syntax-highlighter' {
  import type { CSSProperties, FC } from 'react';

  export interface SyntaxHighlighterProps {
    language?: string;
    style?: Record<string, CSSProperties> | unknown;
    children?: string | string[];
    wrapLongLines?: boolean;
    showLineNumbers?: boolean;
    startingLineNumber?: number;
    customStyle?: CSSProperties;
    className?: string;
    codeTagProps?: { style?: CSSProperties };
    [key: string]: unknown;
  }

  export const Prism: FC<SyntaxHighlighterProps>;
  export const Light: FC<SyntaxHighlighterProps>;
  declare const SyntaxHighlighterDefault: FC<SyntaxHighlighterProps>;
  export default SyntaxHighlighterDefault;
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  import type { CSSProperties } from 'react';

  export const atomDark: Record<string, CSSProperties>;
  export const oneDark: Record<string, CSSProperties>;
  export const vscDarkPlus: Record<string, CSSProperties>;
  export const prism: Record<string, CSSProperties>;
  export const okaidia: Record<string, CSSProperties>;
  export const tomorrow: Record<string, CSSProperties>;
}
