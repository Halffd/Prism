import React from 'react';
import { render, screen } from '@testing-library/react';
import { ImageGenerationSection } from '../popup/ImageGenerationSection';

describe('ImageGenerationSection model picker', () => {
  const props = {
    generatedImage: null,
    imageGenerationPrompt: '',
    setImageGenerationPrompt: jest.fn(),
    imageGenerationModel: 'black-forest-labs/FLUX.1-dev',
    setImageGenerationModel: jest.fn(),
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

  it('keeps the tier visible after an image is generated', () => {
    render(
      <ImageGenerationSection
        {...props}
        generatedImage="data:image/png;base64,AA"
      />,
    );

    expect(screen.getByText(/FLUX\.1 dev — pro-only/)).toBeTruthy();
    expect(screen.getByText(/needs image-provider access/)).toBeTruthy();
  });
});
