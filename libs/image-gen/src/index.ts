import { HfInference } from '@huggingface/inference';

export interface ImageGenerationConfig {
  model: string;
  apiKey: string;
}

export interface ImageGenerationResult {
  imageUrl: string;
  imageBlob?: Blob;
}

/** Access tier reported for an image model, not a paywall or an upsell. */
export type ImageModelAccess = 'free' | 'pro-only';

export interface ImageModelOption {
  id: string;
  label: string;
  access: ImageModelAccess;
}

/**
 * Image models offered by the extension.
 *
 * The tier is part of the model description so a selector can say whether
 * a model works with a normal provider token or needs provider-side paid
 * access. It is not an in-app entitlement: the extension never gates a
 * model behind its own account or credit system.
 */
export const IMAGE_MODEL_OPTIONS: readonly ImageModelOption[] = [
  {
    id: 'stabilityai/stable-diffusion-2-1',
    label: 'Stable Diffusion 2.1',
    access: 'free',
  },
  {
    id: 'runwayml/stable-diffusion-v1-5',
    label: 'Stable Diffusion 1.5',
    access: 'free',
  },
  {
    id: 'stabilityai/stable-diffusion-xl-base-1.0',
    label: 'Stable Diffusion XL',
    access: 'free',
  },
  {
    id: 'black-forest-labs/FLUX.1-schnell',
    label: 'FLUX.1 schnell',
    access: 'free',
  },
  {
    id: 'black-forest-labs/FLUX.1-dev',
    label: 'FLUX.1 dev',
    access: 'pro-only',
  },
] as const;

export function imageModelsForAccess(
  access: ImageModelAccess,
): ImageModelOption[] {
  return IMAGE_MODEL_OPTIONS.filter((model) => model.access === access);
}

export function imageModelAccess(id: string): ImageModelAccess | undefined {
  return IMAGE_MODEL_OPTIONS.find((model) => model.id === id)?.access;
}

/** Option text that shows the access tier without opening a separate panel. */
export function imageModelOptionLabel(model: ImageModelOption): string {
  return `${model.label} — ${model.access}`;
}

export class ImageGenerationService {
  private hf: HfInference;
  private config: ImageGenerationConfig;

  constructor(config: ImageGenerationConfig) {
    this.config = config;
    this.hf = new HfInference(config.apiKey);
  }

  async generateImage(prompt: string): Promise<ImageGenerationResult> {
    try {
      // This uses text-to-image models from Hugging Face
      const response = await this.hf.textToImage({
        inputs: prompt,
        model: this.config.model,
      });

      // Convert the response to a blob URL
      const blob = new Blob([response], { type: 'image/png' });
      const imageUrl = URL.createObjectURL(blob);

      return {
        imageUrl,
        imageBlob: blob,
      };
    } catch (error) {
      console.error('Error generating image:', error);
      throw error;
    }
  }

  async updateConfig(newConfig: ImageGenerationConfig) {
    this.config = newConfig;
    this.hf = new HfInference(newConfig.apiKey);
  }

  // Get a list of supported models
  static getSupportedModels() {
    return {
      stableDiffusion: IMAGE_MODEL_OPTIONS.filter((model) =>
        model.id.includes('stable-diffusion'),
      ).map((model) => model.id),
      flux: IMAGE_MODEL_OPTIONS.filter((model) =>
        model.id.includes('FLUX'),
      ).map((model) => model.id),
    };
  }
}
