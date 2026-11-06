import type { AIConfig } from '@prism/shared-types';
import {
  customModelOptions,
  findCustomModel,
  resolveActiveCustomModel,
  resolveRequestConfig,
  withCustomModel,
} from '../chat/custom-model';

const CUSTOM_MODEL = {
  id: 'custom_1',
  label: 'My Local LLM',
  baseUrl: 'https://api.example.test/v1',
  apiKey: 'sk-test',
  model: 'my-model:latest',
};

describe('Custom model', () => {
  const config: AIConfig = {
    provider: 'openai',
    apiUrl: 'http://localhost:3000/api',
    apiKey: 'hosted-key',
    model: 'gpt-4o',
    providerKeys: { openai: 'hosted-key' },
    customModels: [CUSTOM_MODEL],
    activeCustomModelId: 'custom_1',
  };

  describe('findCustomModel', () => {
    it('finds a custom model by id', () => {
      expect(findCustomModel(config, 'custom_1')).toEqual(CUSTOM_MODEL);
    });

    it('returns undefined for an unknown id', () => {
      expect(findCustomModel(config, 'other')).toBeUndefined();
    });

    it('returns undefined when there is no configuration', () => {
      expect(findCustomModel(undefined, 'custom_1')).toBeUndefined();
    });

    it('returns undefined when no id is given', () => {
      expect(findCustomModel(config, undefined)).toBeUndefined();
    });
  });

  describe('resolveActiveCustomModel', () => {
    it('resolves the selected custom model', () => {
      const resolved = resolveActiveCustomModel(config);
      expect(resolved?.baseUrl).toBe('https://api.example.test/v1');
      expect(resolved?.apiKey).toBe('sk-test');
      expect(resolved?.model).toBe('my-model:latest');
    });

    it('returns undefined when no custom model is selected', () => {
      expect(
        resolveActiveCustomModel({ ...config, activeCustomModelId: undefined }),
      ).toBeUndefined();
    });

    it('returns undefined when the selected model was removed', () => {
      expect(
        resolveActiveCustomModel({ ...config, activeCustomModelId: 'gone' }),
      ).toBeUndefined();
    });
  });

  describe('withCustomModel', () => {
    it('addresses the custom endpoint', () => {
      const resolved = resolveActiveCustomModel(config)!;
      const result = withCustomModel(config, resolved);
      expect(result.apiUrl).toBe('https://api.example.test/v1');
      expect(result.apiKey).toBe('sk-test');
      expect(result.model).toBe('my-model:latest');
      expect(result.providerKeys?.openai).toBe('sk-test');
    });

    it('keeps the provider on the OpenAI-compatible protocol', () => {
      const resolved = resolveActiveCustomModel(config)!;
      expect(withCustomModel(config, resolved).provider).toBe('openai');
    });

    it('keeps the unrelated settings of the configuration', () => {
      const resolved = resolveActiveCustomModel(config)!;
      const result = withCustomModel(
        { ...config, temperature: 0.3, systemPrompt: 'be brief' },
        resolved,
      );
      expect(result.temperature).toBe(0.3);
      expect(result.systemPrompt).toBe('be brief');
    });
  });

  describe('resolveRequestConfig', () => {
    it('resolves to the custom endpoint when one is selected', () => {
      const result = resolveRequestConfig(config);
      expect(result.apiUrl).toBe('https://api.example.test/v1');
      expect(result.model).toBe('my-model:latest');
    });

    it('leaves the configuration alone when no custom model is selected', () => {
      const withoutCustom = { ...config, activeCustomModelId: undefined };
      expect(resolveRequestConfig(withoutCustom)).toBe(withoutCustom);
    });
  });

  describe('customModelOptions', () => {
    it('offers the model list of the custom model', () => {
      const withModels = {
        ...config,
        customModels: [{ ...CUSTOM_MODEL, models: ['a', 'b'] }],
      };
      expect(customModelOptions(withModels)).toEqual(['a', 'b']);
    });

    it('offers the model id when the custom model has no list', () => {
      expect(customModelOptions(config)).toEqual(['my-model:latest']);
    });

    it('offers nothing when no custom model is selected', () => {
      expect(
        customModelOptions({ ...config, activeCustomModelId: undefined }),
      ).toEqual([]);
    });
  });
});
