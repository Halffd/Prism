import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { HeaderSection } from '../popup/HeaderSection';
import { getProviderOptions, loadProviderOptions } from '../popup/provider-catalog';
import {
  cacheModels,
  clearCachedModels,
  getCachedModels,
  loadModelCache,
  modelsForProvider,
} from '../popup/model-cache';
import type { AIConfig } from '@prism/shared-types';

/**
 * Provider and model selection must work with no signed-in user and no
 * Prism API reachable. The provider list comes from the shared catalogue
 * and the model list falls back to a locally cached list.
 */
describe('Offline provider and model selection', () => {
  const storage = new Map<string, unknown>();

  beforeEach(() => {
    storage.clear();
    (global as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: jest.fn(async (key: string) => ({
            [key]: storage.get(key),
          })),
          set: jest.fn(async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) {
              storage.set(key, value);
            }
          }),
          remove: jest.fn(async (key: string) => {
            storage.delete(key);
          }),
        },
      },
    };
  });

  test('the provider catalogue is shared, not a component-local list', () => {
    const options = getProviderOptions();
    expect(options.length).toBeGreaterThan(0);
    expect(options.map((option) => option.id)).toContain('openai');
    expect(options.map((option) => option.id)).toContain('prism-api');
    // Every option carries a human-readable label.
    for (const option of options) {
      expect(option.label.length).toBeGreaterThan(0);
    }
  });

  test('the catalogue falls back to the shared list without the core', async () => {
    // The wasm core may be missing in a test or an offline browser: the
    // shared list is still returned.
    const options = await loadProviderOptions();
    expect(options.length).toBeGreaterThan(0);
    expect(options.map((option) => option.id)).toContain('openai');
  });

  test('the model list persists across a restart and is used offline', async () => {
    await cacheModels('openai', ['gpt-4o', 'gpt-4o-mini']);
    expect(storage.has('prismModelCache')).toBe(true);

    // A "restart" is a fresh read of the persisted storage.
    const cache = await loadModelCache();
    expect(cache.openai).toEqual(['gpt-4o', 'gpt-4o-mini']);

    const config: AIConfig = { provider: 'openai' };
    const models = await modelsForProvider(config);
    expect(models).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  test('the cached list is merged, not replaced', async () => {
    await cacheModels('openai', ['gpt-4o']);
    await cacheModels('openai', ['gpt-4o-mini']);
    expect(await getCachedModels('openai')).toEqual([
      'gpt-4o',
      'gpt-4o-mini',
    ]);

    await clearCachedModels('openai');
    expect(await getCachedModels('openai')).toEqual([]);
  });

  test('the header renders the shared providers and disables the API sync when signed out', () => {
    const config: AIConfig = {
      provider: 'openai',
      model: 'gpt-4o',
      apiUrl: 'http://localhost:3000/api',
    };
    const providers = getProviderOptions();

    render(
      <HeaderSection
        context={null}
        aiConfig={config}
        availableModels={['gpt-4o']}
        fetchingModels={false}
        isOnline={false}
        providerOptions={providers}
        setShowMenu={jest.fn()}
        updateAIConfig={jest.fn()}
        updateModel={jest.fn()}
        fetchAvailableModels={jest.fn()}
        syncFromAPI={jest.fn()}
        syncToAPI={jest.fn()}
        toggleAutoSync={jest.fn()}
        user={null}
        isAuthenticated={false}
        signInWithGoogle={jest.fn()}
        signOut={jest.fn()}
        autoSyncEnabled={false}
      />,
    );

    const providerSelect = screen.getByLabelText(
      'Select AI provider',
    ) as HTMLSelectElement;
    // The options come from the shared catalogue.
    expect(providerSelect.querySelectorAll('option').length).toBe(
      providers.length,
    );
    expect(providerSelect.value).toBe('openai');

    const modelSelect = screen.getByLabelText(
      'Select AI model',
    ) as HTMLSelectElement;
    expect(modelSelect.value).toBe('gpt-4o');
    expect(modelSelect.disabled).toBe(false);

    // The Prism API sync is optional and disabled when signed out.
    const syncFrom = screen.getByLabelText(
      'Sync from Prism API',
    ) as HTMLButtonElement;
    expect(syncFrom.disabled).toBe(true);
  });

  test('selecting a provider and a model works with no user and no network', () => {
    const config: AIConfig = { provider: 'openai', model: 'gpt-4o' };
    const updateAIConfig = jest.fn();
    const updateModel = jest.fn();
    const providers = getProviderOptions();

    render(
      <HeaderSection
        context={null}
        aiConfig={config}
        availableModels={['gpt-4o', 'gpt-4o-mini']}
        fetchingModels={false}
        isOnline={false}
        providerOptions={providers}
        setShowMenu={jest.fn()}
        updateAIConfig={updateAIConfig}
        updateModel={updateModel}
        fetchAvailableModels={jest.fn()}
        syncFromAPI={jest.fn()}
        syncToAPI={jest.fn()}
        toggleAutoSync={jest.fn()}
        user={null}
        isAuthenticated={false}
        signInWithGoogle={jest.fn()}
        signOut={jest.fn()}
        autoSyncEnabled={false}
      />,
    );

    fireEvent.change(screen.getByLabelText('Select AI provider'), {
      target: { value: 'gemini' },
    });
    expect(updateAIConfig).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'gemini' }),
    );

    fireEvent.change(screen.getByLabelText('Select AI model'), {
      target: { value: 'gpt-4o-mini' },
    });
    expect(updateModel).toHaveBeenCalledWith('gpt-4o-mini');
  });
});
