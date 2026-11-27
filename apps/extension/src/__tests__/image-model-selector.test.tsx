import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  ImageGenerationSection,
  MAX_IMAGE_GENERATION_COUNT,
} from '../popup/ImageGenerationSection';

describe('ImageGenerationSection model picker', () => {
  const props = {
    generatedImages: [] as string[],
    setGeneratedImages: jest.fn(),
    imageGenerationPrompt: '',
    setImageGenerationPrompt: jest.fn(),
    imageGenerationModel: 'black-forest-labs/FLUX.1-dev',
    setImageGenerationModel: jest.fn(),
    imageCount: 1,
    setImageCount: jest.fn(),
    generateImage: jest.fn(),
    isGeneratingImage: false,
    imageGenerationApiKey: 'hf-test',
  };

  it('groups models by access tier', () => {
    const { container } = render(<ImageGenerationSection {...props} />);

    const groups = Array.from(container.querySelectorAll('optgroup')).map(
      (group) => group.getAttribute('label'),
    );
    expect(groups).toContain('Free models');
    expect(groups).toContain('Pro-only models');
    expect(
      screen.getByRole('option', { name: 'FLUX.1 dev — pro-only' }),
    ).toBeTruthy();
    expect(screen.getByText(/Pro-only: this model needs access/)).toBeTruthy();
  });

  it('reports a free model when one is selected', () => {
    render(
      <ImageGenerationSection
        {...props}
        imageGenerationModel="stabilityai/stable-diffusion-xl-base-1.0"
      />,
    );

    expect(screen.getByText(/Free: this model works/)).toBeTruthy();
  });

  it('offers a multi-image count', () => {
    render(<ImageGenerationSection {...props} imageCount={2} />);

    const count = screen.getByLabelText(
      'Select how many images to generate',
    ) as HTMLSelectElement;
    expect(count.value).toBe('2');
    expect(
      Array.from(count.querySelectorAll('option')).map(
        (option) => option.value,
      ),
    ).toEqual(['1', '2', '3', String(MAX_IMAGE_GENERATION_COUNT)]);
  });

  it('keeps the tier visible after images are generated', () => {
    render(
      <ImageGenerationSection
        {...props}
        generatedImages={[
          'data:image/png;base64,AA',
          'data:image/png;base64,BB',
        ]}
      />,
    );

    expect(screen.getByText(/FLUX\.1 dev — pro-only/)).toBeTruthy();
    expect(screen.getByText(/needs image-provider access/)).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Generated Images' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download 2' })).toBeTruthy();
  });
});
