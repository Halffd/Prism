import {
  MODES,
  defaultSystemPrompt,
  getMode,
  nextModeId,
  traitsSummary,
  type ModeId,
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
