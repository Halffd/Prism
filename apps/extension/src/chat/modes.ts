/**
 * The six interaction modes: contracts on one runtime. Same transports,
 * same models, different constraints.
 *
 * This mirrors `prism_core::modes::ModeTraits` field-for-field so the
 * web surface shows the same guarantees the Rust core enforces. The
 * core is authoritative for behaviour; this file is for display and
 * for choosing the prompt preset before a message is built.
 */

export type ModeId =
  | 'chat'
  | 'agent'
  | 'code'
  | 'creative'
  | 'daemon'
  | 'generative';

export interface ModeDef {
  id: ModeId;
  label: string;
  blurb: string;
  /** Advertise the tool surface (agent + daemon). */
  tools: boolean;
  /** Assemble the prompt through the character-card engine (creative). */
  cardPrompt: boolean;
  /** Show the media generation screens (generative). */
  media: boolean;
  /** Task list + trigger editor (daemon). */
  tasks: boolean;
  /** Strategy switcher (agent + daemon). */
  strategy: boolean;
  /** May spawn subagents (agent + daemon only). */
  subagents: boolean;
  /** Slash commands this mode advertises; empty means none. */
  commands: string[];
  style: string;
  persistence: string;
}

/** Same order as `prism_core::modes::Mode::all()`. */
export const MODES: readonly ModeDef[] = [
  {
    id: 'chat',
    label: 'Chat',
    blurb: 'Plain conversation, no tools',
    tools: false,
    cardPrompt: false,
    media: false,
    tasks: false,
    strategy: false,
    subagents: false,
    commands: [],
    style: 'conversational',
    persistence: 'session',
  },
  {
    id: 'agent',
    label: 'Agent',
    blurb: 'Autonomous work with tools and permissions',
    tools: true,
    cardPrompt: false,
    media: false,
    tasks: false,
    strategy: true,
    subagents: true,
    commands: ['fix', 'test', 'commit', 'review'],
    style: 'terse execution',
    persistence: 'session',
  },
  {
    id: 'code',
    label: 'Code',
    blurb: 'Code style and refactors, no tools',
    tools: false,
    cardPrompt: false,
    media: false,
    tasks: false,
    strategy: false,
    subagents: false,
    commands: [],
    style: 'minimal diff',
    persistence: 'session',
  },
  {
    id: 'creative',
    label: 'Creative',
    blurb: 'Character cards and roleplay',
    tools: false,
    cardPrompt: true,
    media: false,
    tasks: false,
    strategy: false,
    subagents: false,
    commands: ['swipe', 'continue', 'impersonate', 'branch'],
    style: 'narrative',
    persistence: 'chat tree',
  },
  {
    id: 'daemon',
    label: 'Daemon',
    blurb: 'Long-running tasks and triggers',
    tools: true,
    cardPrompt: false,
    media: false,
    tasks: true,
    strategy: true,
    subagents: true,
    commands: [],
    style: 'ops report',
    persistence: 'always-on',
  },
  {
    id: 'generative',
    label: 'Generative',
    blurb: 'Images, video, audio, OCR',
    tools: false,
    cardPrompt: false,
    media: true,
    tasks: false,
    strategy: false,
    subagents: false,
    commands: ['img', 'vid', 'tts', 'stt', 'ocr'],
    style: 'asset description',
    persistence: 'job queue',
  },
];

export function getMode(id: ModeId): ModeDef {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}

/** Ids in registry order, for cycling. */
export function nextModeId(current: ModeId): ModeId {
  const i = MODES.findIndex((m) => m.id === current);
  return MODES[(i + 1) % MODES.length].id;
}

/** The traits line shown next to each mode, e.g. "tools · subagents". */
export function traitsSummary(m: ModeDef): string {
  const bits: string[] = [];
  if (m.tools) bits.push('tools');
  if (m.subagents) bits.push('subagents');
  if (m.tasks) bits.push('tasks');
  if (m.media) bits.push('media');
  bits.push(m.style);
  bits.push(m.persistence);
  return bits.join(' · ');
}

/** Preset system prompt per mode; mirrors `default_system_prompt`. */
export function defaultSystemPrompt(id: ModeId): string {
  switch (id) {
    case 'chat':
      return 'You are a helpful assistant.';
    case 'agent':
      return 'You are an autonomous agent. Use the available tools to complete the task, then give the final answer.';
    case 'code':
      return 'You are a code assistant. Write minimal, idiomatic, correct code. No tools are available and none are needed — return the edited code, not a narrative.';
    case 'creative':
      return 'Stay in character and narrate the scene.';
    case 'daemon':
      return 'You are a background daemon. Complete the scheduled task with the tools available and report the result.';
    case 'generative':
      return 'You are a media generation assistant.';
  }
}
