import {
  MODES,
  FEATURES,
  defaultSystemPrompt,
  getMode,
  nextModeId,
  traitsSummary,
  newSession,
  mixMode,
  unmixMode,
  setFeature,
  resetFeature,
  sessionHasFeature,
  activeFeatures,
  activeModes,
  permissionFor,
  setPermission,
  cycleToolPermission,
  cyclePermission,
  sessionSummary,
  type ModeId,
  type ModeSession,
} from '../chat/modes';

/**
 * Pins the web registry against the Rust core's `ModeTraits`. The core is
 * authoritative; if these numbers drift, the extension lies to the user
 * about what a mode allows (or, worse, advertises tools it does not have).
 */
describe('mode registry conformance with prism_core::modes', () => {
  it('has exactly the six modes in registry order', () => {
    expect(MODES.map((m) => m.id)).toEqual([
      'chat',
      'agent',
      'code',
      'creative',
      'daemon',
      'generative',
    ]);
  });

  it('matches Rust: only chat and code advertise nothing', () => {
    expect(getMode('chat')).toMatchObject({
      tools: false,
      subagents: false,
      tasks: false,
      media: false,
      strategy: false,
      cardPrompt: false,
    });
    expect(getMode('code')).toMatchObject({
      tools: false,
      subagents: false,
      tasks: false,
      media: false,
      strategy: false,
      cardPrompt: false,
    });
  });

  it('matches Rust: only agent and daemon may spawn subagents', () => {
    const spawners = MODES.filter((m) => m.subagents).map((m) => m.id);
    expect(spawners).toEqual(['agent', 'daemon']);
  });

  it('matches Rust: style and persistence per mode', () => {
    const expected: Record<ModeId, [string, string]> = {
      chat: ['conversational', 'session'],
      agent: ['terse execution', 'session'],
      code: ['minimal diff', 'session'],
      creative: ['narrative', 'chat tree'],
      daemon: ['ops report', 'always-on'],
      generative: ['asset description', 'job queue'],
    };
    for (const m of MODES) {
      expect([m.style, m.persistence]).toEqual(expected[m.id]);
    }
  });

  it('matches Rust: command counts per mode', () => {
    const counts = MODES.map((m) => [m.id, m.commands.length] as const);
    expect(counts).toEqual([
      ['chat', 0],
      ['agent', 4],
      ['code', 0],
      ['creative', 4],
      ['daemon', 0],
      ['generative', 5],
    ]);
  });

  it('matches Rust: daemon is the only mode with tasks, generative the only with media', () => {
    expect(MODES.filter((m) => m.tasks).map((m) => m.id)).toEqual(['daemon']);
    expect(MODES.filter((m) => m.media).map((m) => m.id)).toEqual([
      'generative',
    ]);
  });

  it('code mode has a no-tools preset prompt', () => {
    expect(defaultSystemPrompt('code').toLowerCase()).toContain('no tools');
  });

  it('getMode falls back to chat for unknown ids', () => {
    expect(getMode('nope' as ModeId).id).toBe('chat');
  });

  it('cycles through all six modes and wraps', () => {
    const visited: ModeId[] = [];
    let cur: ModeId = 'chat';
    for (let i = 0; i < MODES.length; i++) {
      visited.push(cur);
      cur = nextModeId(cur);
    }
    expect(visited).toEqual(MODES.map((m) => m.id));
    expect(nextModeId('generative')).toBe('chat');
  });

  it('traitsSummary lists binding constraints only', () => {
    expect(traitsSummary(getMode('chat'))).toBe('conversational · session');
    expect(traitsSummary(getMode('code'))).toBe('minimal diff · session');
    expect(traitsSummary(getMode('daemon'))).toBe(
      'tools · subagents · tasks · ops report · always-on',
    );
  });
});

describe('mode session: mixing, capabilities and permissions', () => {
  it('a fresh session has only the chat contract', () => {
    const s = newSession();
    expect(s.primary).toBe('chat');
    expect(s.mixed).toEqual([]);
    expect(activeModes(s)).toEqual(['chat']);
    expect(sessionHasFeature(s, 'tools')).toBe(false);
    expect(sessionHasFeature(s, 'character-cards')).toBe(false);
  });

  it('mixing unions capabilities', () => {
    let s = newSession('chat');
    s = mixMode(s, 'creative');
    expect(activeModes(s)).toEqual(['chat', 'creative']);
    expect(sessionHasFeature(s, 'character-cards')).toBe(true);
    expect(sessionHasFeature(s, 'tools')).toBe(false);

    s = mixMode(s, 'agent');
    expect(sessionHasFeature(s, 'tools')).toBe(true);
    expect(sessionHasFeature(s, 'subagents')).toBe(true);
    // Creative's cards survive the union.
    expect(sessionHasFeature(s, 'character-cards')).toBe(true);
  });

  it('mixing the primary or a duplicate is refused', () => {
    let s = newSession('chat');
    s = mixMode(s, 'chat');
    expect(s.mixed).toEqual([]);
    s = mixMode(s, 'agent');
    s = mixMode(s, 'agent');
    expect(s.mixed).toEqual(['agent']);
  });

  it('unmix removes a blend but never the primary', () => {
    let s = newSession('chat');
    s = mixMode(s, 'agent');
    s = unmixMode(s, 'agent');
    expect(s.mixed).toEqual([]);
    expect(sessionHasFeature(s, 'tools')).toBe(false);

    s = unmixMode(s, 'chat');
    expect(s.primary).toBe('chat');
  });

  it('feature overrides beat the modes', () => {
    let s = newSession('agent');
    expect(sessionHasFeature(s, 'tools')).toBe(true);
    s = setFeature(s, 'tools', false);
    expect(sessionHasFeature(s, 'tools')).toBe(false);
    s = setFeature(s, 'media', true);
    expect(sessionHasFeature(s, 'media')).toBe(true);
    s = resetFeature(s, 'tools');
    expect(sessionHasFeature(s, 'tools')).toBe(true);
  });

  it('feature list mirrors the Rust Feature::all order', () => {
    expect(FEATURES.map((f) => f.id)).toEqual([
      'tools',
      'subagents',
      'commands',
      'character-cards',
      'media',
      'tasks',
      'strategy',
    ]);
    // A blended chat+agent session lists features in that order.
    // Agent grants tools, subagents, commands and strategy.
    const s = mixMode(newSession('chat'), 'agent');
    expect(activeFeatures(s)).toEqual([
      'tools',
      'subagents',
      'commands',
      'strategy',
    ]);
  });

  it('permission edits apply and reject unknown tools', () => {
    const tools = ['calculator', 'web_search'];
    let s = newSession('agent');
    s = setPermission(s, 'calculator', 'ask', tools);
    expect(permissionFor(s, 'calculator')).toBe('ask');
    expect(permissionFor(s, 'web_search')).toBe('allow');
    // A tool the session cannot use is not grantable.
    s = setPermission(s, 'shell', 'allow', tools);
    expect(permissionFor(s, 'shell')).toBe('allow'); // falls back to default
    expect(s.permissions.shell).toBeUndefined();
  });

  it('permission cycles allow -> ask -> deny -> allow', () => {
    expect(cyclePermission('allow')).toBe('ask');
    expect(cyclePermission('ask')).toBe('deny');
    expect(cyclePermission('deny')).toBe('allow');

    const tools = ['calculator'];
    let s = newSession('agent');
    s = cycleToolPermission(s, 'calculator', tools);
    expect(permissionFor(s, 'calculator')).toBe('ask');
    s = cycleToolPermission(s, 'calculator', tools);
    expect(permissionFor(s, 'calculator')).toBe('deny');
  });

  it('the default permission covers tools with no entry', () => {
    const s: ModeSession = {
      ...newSession('agent'),
      defaultPermission: 'deny',
    };
    expect(permissionFor(s, 'calculator')).toBe('deny');
  });

  it('the summary names every active mode', () => {
    let s = newSession('chat');
    expect(sessionSummary(s)).toBe('Chat');
    s = mixMode(s, 'agent');
    expect(sessionSummary(s)).toBe('Chat + Agent');
  });
});
