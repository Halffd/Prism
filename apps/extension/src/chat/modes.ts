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

/**
 * A single capability a mode grants. Mirrors `prism_core::modes::Feature`.
 * Modes are bundles of features; mixing unions them; the UI toggles
 * them individually.
 */
export type FeatureId =
  | 'tools'
  | 'subagents'
  | 'commands'
  | 'character-cards'
  | 'media'
  | 'tasks'
  | 'strategy';

export interface FeatureDef {
  id: FeatureId;
  label: string;
  description: string;
}

/** Same order as `prism_core::modes::Feature::all()`. */
export const FEATURES: readonly FeatureDef[] = [
  {
    id: 'tools',
    label: 'Tools',
    description: 'Execute tools (shell, files, search)',
  },
  {
    id: 'subagents',
    label: 'Subagents',
    description: 'Spawn nested workers',
  },
  {
    id: 'commands',
    label: 'Commands',
    description: 'Slash commands',
  },
  {
    id: 'character-cards',
    label: 'Character cards',
    description: 'Character cards and lorebook',
  },
  {
    id: 'media',
    label: 'Media',
    description: 'Image, video and audio generation',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    description: 'Scheduled tasks and triggers',
  },
  {
    id: 'strategy',
    label: 'Strategy',
    description: 'React / plan-and-execute switch',
  },
];

/** Permission level for a tool; mirrors `prism_core::agent::Permission`. */
export type PermissionLevel = 'allow' | 'ask' | 'deny';

/** allow -> ask -> deny -> allow. */
export function cyclePermission(level: PermissionLevel): PermissionLevel {
  switch (level) {
    case 'allow':
      return 'ask';
    case 'ask':
      return 'deny';
    case 'deny':
      return 'allow';
  }
}

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

/** Does this mode grant the feature? */
export function modeHasFeature(mode: ModeDef, feature: FeatureId): boolean {
  switch (feature) {
    case 'tools':
      return mode.tools;
    case 'subagents':
      return mode.subagents;
    case 'commands':
      return mode.commands.length > 0;
    case 'character-cards':
      return mode.cardPrompt;
    case 'media':
      return mode.media;
    case 'tasks':
      return mode.tasks;
    case 'strategy':
      return mode.strategy;
  }
}

/**
 * A web session: the primary mode, the blended modes, per-feature
 * overrides and the permission policy. Mirrors the core
 * `prism_core::session::Session` so the browser enforces the same
 * contract the Rust surfaces do.
 */
export interface ModeSession {
  /** The primary mode. It owns the prompt voice. */
  primary: ModeId;
  /** Blended modes; their capabilities are unioned in. */
  mixed: ModeId[];
  /** Explicit per-feature overrides; `undefined` follows the modes. */
  overrides: Partial<Record<FeatureId, boolean>>;
  /** Per-tool permission overrides. */
  permissions: Record<string, PermissionLevel>;
  /** Fallback for tools with no explicit entry. */
  defaultPermission: PermissionLevel;
}

export function newSession(primary: ModeId = 'chat'): ModeSession {
  return {
    primary,
    mixed: [],
    overrides: {},
    permissions: {},
    defaultPermission: 'allow',
  };
}

/** Every mode in the session: the primary first, then the blend. */
export function activeModes(session: ModeSession): ModeId[] {
  const modes: ModeId[] = [session.primary];
  for (const m of session.mixed) {
    if (m !== session.primary && !modes.includes(m)) {
      modes.push(m);
    }
  }
  return modes;
}

/**
 * The features this session has: the union of every active mode's
 * features, with explicit overrides applied on top. This is the single
 * source of truth for what the session can do.
 */
export function activeFeatures(session: ModeSession): FeatureId[] {
  const modes = activeModes(session).map(getMode);
  const granted = new Set<FeatureId>();
  for (const mode of modes) {
    for (const feature of FEATURES) {
      if (modeHasFeature(mode, feature.id)) {
        granted.add(feature.id);
      }
    }
  }
  for (const feature of FEATURES) {
    const override = session.overrides[feature.id];
    if (override === true) granted.add(feature.id);
    if (override === false) granted.delete(feature.id);
  }
  return FEATURES.filter((f) => granted.has(f.id)).map((f) => f.id);
}

/** Is the feature on for this session, after overrides? */
export function sessionHasFeature(
  session: ModeSession,
  feature: FeatureId,
): boolean {
  return activeFeatures(session).includes(feature);
}

/**
 * Blend a mode into the session. The primary cannot be blended into
 * itself, and a mode cannot be blended twice.
 */
export function mixMode(session: ModeSession, mode: ModeId): ModeSession {
  if (mode === session.primary || session.mixed.includes(mode)) {
    return session;
  }
  return { ...session, mixed: [...session.mixed, mode] };
}

/** Remove a blended mode. The primary cannot be removed. */
export function unmixMode(session: ModeSession, mode: ModeId): ModeSession {
  if (mode === session.primary) {
    return session;
  }
  return { ...session, mixed: session.mixed.filter((m) => m !== mode) };
}

/** Force a feature on or off, overriding the blended modes. */
export function setFeature(
  session: ModeSession,
  feature: FeatureId,
  enabled: boolean,
): ModeSession {
  return {
    ...session,
    overrides: { ...session.overrides, [feature]: enabled },
  };
}

/** Drop an override so the feature follows the blended modes again. */
export function resetFeature(
  session: ModeSession,
  feature: FeatureId,
): ModeSession {
  const overrides = { ...session.overrides };
  delete overrides[feature];
  return { ...session, overrides };
}

/** Effective permission for a tool. */
export function permissionFor(
  session: ModeSession,
  tool: string,
): PermissionLevel {
  return session.permissions[tool] ?? session.defaultPermission;
}

/**
 * Set a per-tool permission. Returns the session unchanged when the
 * tool is not advertised, so the policy and the tool list cannot
 * disagree — the same rule the core enforces.
 */
export function setPermission(
  session: ModeSession,
  tool: string,
  level: PermissionLevel,
  availableTools: readonly string[],
): ModeSession {
  if (!availableTools.includes(tool)) {
    return session;
  }
  return {
    ...session,
    permissions: { ...session.permissions, [tool]: level },
  };
}

/** Cycle one tool's permission: allow -> ask -> deny -> allow. */
export function cycleToolPermission(
  session: ModeSession,
  tool: string,
  availableTools: readonly string[],
): ModeSession {
  return setPermission(
    session,
    tool,
    cyclePermission(permissionFor(session, tool)),
    availableTools,
  );
}

/** The blend summary shown in the mode bar and status line. */
export function sessionSummary(session: ModeSession): string {
  const names = activeModes(session).map((id) => getMode(id).label);
  return names.join(' + ');
}
