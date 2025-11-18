import { contextManager } from './context-manager.js';

describe('contextManager', () => {
  it('should work', () => {
    expect(contextManager()).toEqual('context-manager');
  });
});
