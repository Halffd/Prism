import {
  IMAGE_MODEL_OPTIONS,
  imageModelAccess,
  imageModelOptionLabel,
  imageModelsForAccess,
} from '@prism/image-gen';

describe('image model tiers', () => {
  it('labels both free and pro-only image models', () => {
    const free = imageModelsForAccess('free');
    const proOnly = imageModelsForAccess('pro-only');

    expect(free.length).toBeGreaterThan(0);
    expect(proOnly.length).toBeGreaterThan(0);
    expect(free.every((model) => model.access === 'free')).toBe(true);
    expect(proOnly.every((model) => model.access === 'pro-only')).toBe(true);
  });

  it('gives every model one access tier', () => {
    for (const model of IMAGE_MODEL_OPTIONS) {
      expect(imageModelAccess(model.id)).toBe(model.access);
    }
  });

  it('places FLUX dev in pro-only and FLUX schnell in free', () => {
    expect(imageModelAccess('black-forest-labs/FLUX.1-dev')).toBe('pro-only');
    expect(imageModelAccess('black-forest-labs/FLUX.1-schnell')).toBe('free');
  });

  it('shows the tier in the option label', () => {
    const dev = IMAGE_MODEL_OPTIONS.find(
      (model) => model.id === 'black-forest-labs/FLUX.1-dev',
    );
    expect(dev).toBeDefined();
    expect(imageModelOptionLabel(dev!)).toBe('FLUX.1 dev — pro-only');
  });
});
