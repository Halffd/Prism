import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  ImageGenerationService,
  normalizeImageGenerationModel,
} from '@prism/image-gen';

describe('image model selection', () => {
  it('keeps an offered model', () => {
    expect(normalizeImageGenerationModel('black-forest-labs/FLUX.1-dev')).toBe(
      'black-forest-labs/FLUX.1-dev',
    );
  });

  it('replaces a stored model that no longer has a provider', () => {
    expect(
      normalizeImageGenerationModel('nvidia/Nemotron-Labs-Image-30B-A3B'),
    ).toBe(DEFAULT_IMAGE_GENERATION_MODEL);
    expect(normalizeImageGenerationModel(undefined)).toBe(
      DEFAULT_IMAGE_GENERATION_MODEL,
    );
  });

  it('refuses to build a service for an unlisted model', () => {
    expect(
      () =>
        new ImageGenerationService({
          model: 'Comfy-Org/Flux-2-Dev',
          apiKey: 'hf-test',
        }),
    ).toThrow(/not an offered image model/);
  });
});
