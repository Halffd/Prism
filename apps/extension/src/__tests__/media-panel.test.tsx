import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MediaPanel } from '../components/MediaPanel';
import type { MediaCapabilityClient } from '../chat/media-capabilities';

/**
 * The media panel must offer every capability, route the call to the
 * capability that is selected, and show the provider's answer.
 */
describe('MediaPanel', () => {
  /** A client that records the capability it was asked to serve. */
  function recordingClient() {
    const calls: Array<{ capability: string; provider: string }> = [];
    const client: MediaCapabilityClient = {
      setCapabilityProvider(capability, provider) {
        calls.push({ capability, provider });
      },
      async inpaint() {
        return {
          success: true,
          data: { image: new Blob(), imageUrl: 'https://img.test/out.png' },
        };
      },
      async modelGen() {
        return {
          success: true,
          data: { model: new Blob(), modelUrl: 'https://model.test/out.glb', format: 'glb' },
        };
      },
      async videoGen() {
        return {
          success: true,
          data: {
            video: new Blob(),
            videoUrl: 'https://video.test/out.mp4',
            duration: 5,
            format: 'mp4',
          },
        };
      },
    };
    return { client, calls };
  }

  beforeEach(() => {
    // The panel loads the stored settings on mount; the global chrome
    // mock answers with an empty object.
    (
      chrome.storage.local.get as unknown as jest.Mock
    ).mockResolvedValue({});
    (chrome.storage.local.set as unknown as jest.Mock).mockResolvedValue(
      undefined,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('offers every media capability', async () => {
    render(<MediaPanel client={null} />);
    const select = screen.getByLabelText('Media capability');
    await waitFor(() => {
      expect(select.querySelectorAll('option')).toHaveLength(4);
    });
  });

  it('shows the providers of the selected capability', async () => {
    render(<MediaPanel client={null} />);
    const provider = screen.getByLabelText('Media provider');
    await waitFor(() => {
      expect(provider.querySelectorAll('option').length).toBeGreaterThan(0);
    });
    // Image generation is Hugging Face only.
    expect(provider.querySelectorAll('option')[0].getAttribute('value')).toBe(
      'huggingface',
    );
  });

  it('asks for a mask only when inpainting is selected', async () => {
    render(<MediaPanel client={null} />);
    await waitFor(() => {
      expect(screen.queryByLabelText('Mask image URL')).toBeNull();
    });
    fireEvent.change(screen.getByLabelText('Media capability'), {
      target: { value: 'inpaint' },
    });
    expect(screen.getByLabelText('Mask image URL')).toBeTruthy();
    expect(screen.getByLabelText('Source image URL')).toBeTruthy();
  });

  it('routes an inpainting request to the inpaint capability', async () => {
    const { client, calls } = recordingClient();
    render(<MediaPanel client={client} />);

    fireEvent.change(screen.getByLabelText('Media capability'), {
      target: { value: 'inpaint' },
    });
    fireEvent.change(screen.getByLabelText('Media prompt'), {
      target: { value: 'make it blue' },
    });
    fireEvent.change(screen.getByLabelText('Source image URL'), {
      target: { value: 'data:image/png;base64,AAA' },
    });
    fireEvent.change(screen.getByLabelText('Mask image URL'), {
      target: { value: 'data:image/png;base64,BBB' },
    });

    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(calls[0]?.capability).toBe('inpaint');
    });
    expect(calls[0].provider).toBe('stability');
  });

  it('routes a video request to the video capability', async () => {
    const { client, calls } = recordingClient();
    render(<MediaPanel client={client} />);

    fireEvent.change(screen.getByLabelText('Media capability'), {
      target: { value: 'video-gen' },
    });
    fireEvent.change(screen.getByLabelText('Media prompt'), {
      target: { value: 'a wave' },
    });
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(calls[0]?.capability).toBe('video-gen');
    });
  });

  it('routes a model request to the model capability', async () => {
    const { client, calls } = recordingClient();
    render(<MediaPanel client={client} />);

    fireEvent.change(screen.getByLabelText('Media capability'), {
      target: { value: 'model-gen' },
    });
    fireEvent.change(screen.getByLabelText('Media prompt'), {
      target: { value: 'a chair' },
    });
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(calls[0]?.capability).toBe('model-gen');
    });
  });

  it('shows the generated image', async () => {
    const { client } = recordingClient();
    render(<MediaPanel client={client} />);

    fireEvent.change(screen.getByLabelText('Media capability'), {
      target: { value: 'inpaint' },
    });
    fireEvent.change(screen.getByLabelText('Media prompt'), {
      target: { value: 'make it blue' },
    });
    fireEvent.change(screen.getByLabelText('Source image URL'), {
      target: { value: 'data:image/png;base64,AAA' },
    });
    fireEvent.change(screen.getByLabelText('Mask image URL'), {
      target: { value: 'data:image/png;base64,BBB' },
    });
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(screen.getByAltText('Generated')).toBeTruthy();
    });
  });

  it('disables the generate button without a prompt', async () => {
    render(<MediaPanel client={null} />);
    await waitFor(() => {
      expect(screen.getByText('Generate')).toBeTruthy();
    });
    expect(
      (screen.getByText('Generate') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
