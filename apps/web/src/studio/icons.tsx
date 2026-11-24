// Lucide-style inline icons. Kept local so the studio shell has no icon
// dependency; every glyph is decorative and hidden from assistive tech.

export type IconName =
  | 'home' | 'message' | 'clapperboard' | 'video' | 'image' | 'globe'
  | 'user' | 'mic' | 'puzzle' | 'folder' | 'briefcase' | 'film'
  | 'workflow' | 'template' | 'zap' | 'tag' | 'chevronDown' | 'chevronRight'
  | 'menu' | 'close' | 'plus' | 'minus' | 'sparkles' | 'wand' | 'camera'
  | 'crop' | 'trash' | 'sliders' | 'volume' | 'search' | 'refresh' | 'star'
  | 'grid' | 'filter' | 'play' | 'settings' | 'send' | 'stop' | 'copy'
  | 'check' | 'pencil' | 'panel' | 'language' | 'download';

const PATHS: Record<IconName, React.ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
  message: <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.6-.7L3 21l1.8-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z" />,
  clapperboard: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="m7 7 2-4 4 0-2 4M15 7l2-4 4 0-2 4" /></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4" /></>,
  puzzle: <path d="M9 3h6v3a2 2 0 1 0 4 0V3h3v6h-3a2 2 0 1 0 0 4h3v8h-6v-3a2 2 0 1 0-4 0v3H3v-6h3a2 2 0 1 0 0-4H3V3h6Z" />,
  folder: <path d="M3 6h7l2 3h9v12H3Z" />,
  briefcase: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M9 7V4h6v3M3 13h18" /></>,
  film: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 8h4M17 8h4M3 16h4M17 16h4" /></>,
  workflow: <><rect x="3" y="3" width="7" height="6" rx="1" /><rect x="14" y="15" width="7" height="6" rx="1" /><path d="M6.5 9v6a3 3 0 0 0 3 3H14" /></>,
  template: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12" /></>,
  zap: <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />,
  tag: <><path d="M3 12V4h8l10 10-8 8Z" /><circle cx="7.5" cy="7.5" r="1" /></>,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  sparkles: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z" /></>,
  wand: <><path d="m4 20 12-12M15 4l1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" /><path d="m4 4 2 2M20 16l-2 2" /></>,
  camera: <><path d="M3 8h4l2-3h6l2 3h4v12H3Z" /><circle cx="12" cy="14" r="3.5" /></>,
  crop: <path d="M6 2v16h16M2 6h16v16" />,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" /></>,
  sliders: <><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="14" cy="18" r="2" /></>,
  volume: <><path d="M4 9v6h4l5 4V5L8 9Z" /><path d="M17 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2 6" /><path d="M20 4v7h-7" /></>,
  star: <path d="m12 3 2.8 5.8 6.2.9-4.5 4.4 1 6.2-5.5-3-5.5 3 1-6.2L3 9.7l6.2-.9Z" />,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8Z" />,
  play: <path d="m8 5 11 7-11 7Z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>,
  send: <path d="m3 3 18 9-18 9 4-9Z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  check: <path d="m4 12 5 5L20 6" />,
  pencil: <path d="m4 20 4-1 11-11-3-3L5 16Z" />,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  language: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>,
  download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M4 19h16" /></>,
};

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}
