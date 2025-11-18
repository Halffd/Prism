import { llmService } from './llm-service.js';

describe('llmService', () => {
  it('should work', () => {
    expect(llmService()).toEqual('llm-service');
  });
});
