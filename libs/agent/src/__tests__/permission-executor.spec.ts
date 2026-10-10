import { describe, expect, it } from '@jest/globals';
import { BuiltinToolExecutor, PermissionAwareToolExecutor } from '../index';

function fakeInner(result: string) {
  return {
    calls: [] as Array<{ tool: string; input: string }>,
    async execute(tool: string, input: string): Promise<string> {
      this.calls.push({ tool, input });
      return result;
    },
  };
}

describe('PermissionAwareToolExecutor', () => {
  it('allow-level tools delegate to the inner executor', async () => {
    const inner = fakeInner('tool output');
    const exec = new PermissionAwareToolExecutor({
      inner,
      permissions: { calculator: 'allow' },
      defaultPermission: 'deny',
    });
    const out = await exec.execute('calculator', '1+1');
    expect(out).toBe('tool output');
    expect(inner.calls.length).toBe(1);
  });

  it('deny-level tools refuse without calling the inner executor', async () => {
    const inner = fakeInner('tool output');
    const exec = new PermissionAwareToolExecutor({
      inner,
      permissions: { read_file: 'deny' },
      defaultPermission: 'allow',
    });
    const out = await exec.execute('read_file', '/etc/passwd');
    expect(out).toContain('Permission denied');
    expect(inner.calls.length).toBe(0);
  });

  it('ask-level tools prompt and honor a true answer', async () => {
    const inner = fakeInner('fetched');
    const asks: string[] = [];
    const exec = new PermissionAwareToolExecutor({
      inner,
      defaultPermission: 'ask',
      onAsk: async (tool) => {
        asks.push(tool);
        return true;
      },
    });
    const out = await exec.execute('fetch_url', 'https://example.com');
    expect(asks).toEqual(['fetch_url']);
    expect(out).toBe('fetched');
  });

  it('ask-level tools prompt and honor a false answer', async () => {
    const inner = fakeInner('fetched');
    const exec = new PermissionAwareToolExecutor({
      inner,
      defaultPermission: 'ask',
      onAsk: async () => false,
    });
    const out = await exec.execute('fetch_url', 'https://example.com');
    expect(out).toContain('denied by user');
    expect(inner.calls.length).toBe(0);
  });

  it('ask-level tools deny when no handler is available', async () => {
    const inner = fakeInner('fetched');
    const exec = new PermissionAwareToolExecutor({
      inner,
      defaultPermission: 'ask',
    });
    const out = await exec.execute('fetch_url', 'https://example.com');
    expect(out).toContain('Permission required');
    expect(inner.calls.length).toBe(0);
  });

  it('defaults to ask when no policy is given', async () => {
    const inner = fakeInner('x');
    const exec = new PermissionAwareToolExecutor({ inner });
    const out = await exec.execute('web_search', 'query');
    expect(out).toContain('Permission required');
  });

  it('BuiltinToolExecutor calculator still works through the wrapper', async () => {
    const exec = new PermissionAwareToolExecutor({
      inner: new BuiltinToolExecutor(),
      permissions: { calculator: 'allow' },
      defaultPermission: 'deny',
    });
    const out = await exec.execute('calculator', '2+3');
    expect(out).toContain('5');
  });
});
