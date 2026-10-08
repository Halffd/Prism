/**
 * Material Symbols–style inline SVG icon set (24x24 grid, filled style).
 *
 * Icons are pure inline SVG — no icon font, no network fetch, no extra
 * dependency. Shared across extension, desktop, TUI (web-embedded), and mobile
 * (Expo react-native-web) via libs/ui-components.
 */
import type { CSSProperties } from 'react';

export type IconName =
  | 'send'
  | 'search'
  | 'science'
  | 'balance'
  | 'shuffle'
  | 'handshake'
  | 'smart_toy'
  | 'settings'
  | 'delete'
  | 'clear'
  | 'stop'
  | 'volume_up'
  | 'content_copy'
  | 'attach_file'
  | 'mic'
  | 'edit'
  | 'add'
  | 'close'
  | 'check'
  | 'keyboard'
  | 'bolt'
  | 'memory'
  | 'terminal'
  | 'menu';

/** Material Symbols (filled) path data, 24x24 viewport. */
const PATHS: Record<IconName, string> = {
  send: 'M2.01 21 23 12 2.01 3 2 10l15 2-15 2z',
  search:
    'M15.5 14h-.79l-.28-.27a6.5 6.5 0 0 0 1.48-5.34c-.47-2.78-2.79-5-5.59-5.34a6.505 6.505 0 0 0-7.27 7.27c.34 2.8 2.56 5.12 5.34 5.59a6.5 6.5 0 0 0 5.34-1.48l.27.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14zm-6 0C7.01 14 5 9.99 5 7.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  science:
    'M19.8 18.4 14 10.67V6.5l1.35-1.69c.26-.17.65-.31.9-.31H21c.55 0 1-.45 1-1s-.45-1-1-1h-5.75c-.25 0-.64.14-.9.31L12 4.47 9.65 2.81c-.26-.17-.65-.31-.9-.31H3c-.55 0-1 .45-1 1s.45 1 1 1h4.75c.25 0 .64.14.9.31L10 6.5v4.17L4.2 18.4c-.49.66-.02 1.6.8 1.6h14c.82 0 1.29-.94.8-1.6z',
  balance:
    'M12 2a1 1 0 0 0-1 1v1.06A8 8 0 0 0 4.13 10H3a1 1 0 0 0-.94 1.34l2.4 6A3 3 0 0 0 7.24 19h.52a3 3 0 0 0 2.78-1.66l2.4-6A1 1 0 0 0 12 10h-1.13A6 6 0 0 1 13 5.34V21h-2a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2V5.34A6 6 0 0 1 17.13 10H16a1 1 0 0 0-.94 1.34l2.4 6A3 3 0 0 0 20.24 19h.52a3 3 0 0 0 2.78-1.66l2.4-6A1 1 0 0 0 25 10h-1.13A8 8 0 0 0 13 4.06V3a1 1 0 0 0-1-1z',
  shuffle:
    'M10.59 9.17 5.41 4 4 5.41l5.17 5.41 1.42-1.65zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
  handshake:
    'M12.22 19.85c-.18.18-.5.21-.71 0a.504.504 0 0 1 0-.71l3.39-3.39-1.41-1.41-3.39 3.39c-.19.2-.51.19-.71 0a.504.504 0 0 1 0-.71l3.39-3.39-1.41-1.41-3.39 3.39c-.18.18-.5.21-.71 0a.513.513 0 0 1 0-.71l3.39-3.39-1.42-1.41-3.39 3.39c-.18.18-.5.21-.71 0a.513.513 0 0 1 0-.71L9.52 8.4l1.87 1.86c.95.95 2.59.94 3.54 0 .98-.98.98-2.56 0-3.54l-1.86-1.86.28-.28c.78-.78 2.05-.78 2.83 0l4.24 4.24c.78.78.78 2.05 0 2.83l-8.2 8.2zM21.83 9.41l-4.24-4.24a3.975 3.975 0 0 0-5.66 0l-.28.28-.28-.28a3.975 3.975 0 0 0-5.66 0L2.17 8.71a3.975 3.975 0 0 0 0 5.66l4.24 4.24c.78.78 2.05.78 2.83 0l8.2-8.2c.78-.78.78-2.05.39-2.83z',
  smart_toy:
    'M20 9V7c0-1.1-.9-2-2-2h-3a2.5 2.5 0 0 0-5 0H7c-1.1 0-2 .9-2 2v2a2.5 2.5 0 0 0 0 5v2c0 1.1.9 2 2 2h3v2a1 1 0 1 0 2 0v-2h3c1.1 0 2-.9 2-2v-2a2.5 2.5 0 0 0 0-5zM7.5 11.5A1.5 1.5 0 1 1 9 10a1.5 1.5 0 0 1-1.5 1.5zm4.5 4a1.5 1.5 0 1 1 1.5-1.5 1.5 1.5 0 0 1-1.5 1.5zm0-3.5a.5.5 0 1 1 .5-.5.5.5 0 0 1-.5.5zm4.5-.5a1.5 1.5 0 1 1-1.5-1.5 1.5 1.5 0 0 1 1.5 1.5z',
  settings:
    'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.61 3.6 0 1 1 12 8.4a3.61 3.6 0 0 1 0 7.2z',
  delete:
    'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  clear:
    'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  stop: 'M6 6h12v12H6z',
  volume_up:
    'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.47 4.47 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  content_copy:
    'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  attach_file:
    'M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z',
  mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  close:
    'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  keyboard:
    'M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z',
  bolt: 'M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z',
  memory:
    'M15 9H9v6h5V9zm-2 4h-3v-2h3v2zm7-2v-2h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3h-2v2H8c-1.1 0-2 .9-2 2v2H4v2h2v2H4v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H8V7h8v10z',
  terminal:
    'M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 14H4V8h16v10zm-2-1v-2h-4v2h4zM7.5 15l1.41-1.41L7.33 12l1.58-1.59L7.5 9 4.5 12l3 3z',
  menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
};

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

/**
 * Material-style icon rendered as inline SVG. Inherits currentColor, so it
 * adapts to any theme automatically.
 */
export function Icon({ name, size = 18, className, style, title }: IconProps) {
  const path = PATHS[name];
  if (!path) return null;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className ? `prism-icon ${className}` : 'prism-icon'}
      style={style}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <path d={path} />
    </svg>
  );
}
