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
    id: 'stabilityai/stable-diffusion-3.5-large-turbo',
    label: 'Stable Diffusion 3.5 Large Turbo',
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

/**
 * The model a fresh install starts on.
 *
 * Every offered model must currently have a live text-to-image inference
 * provider; models with an empty provider mapping are not listed because
 * the Hugging Face SDK refuses to route them.
 */
export const DEFAULT_IMAGE_GENERATION_MODEL = IMAGE_MODEL_OPTIONS[0].id;

/** True when the id is one of the models this app actually offers. */
export function isOfferedImageGenerationModel(
  id: string,
): id is (typeof IMAGE_MODEL_OPTIONS)[number]['id'] {
  return IMAGE_MODEL_OPTIONS.some((model) => model.id === id);
}

/** Replace a stored id that is no longer offered with the offered default. */
export function normalizeImageGenerationModel(id?: string | null): string {
  return id && isOfferedImageGenerationModel(id)
    ? id
    : DEFAULT_IMAGE_GENERATION_MODEL;
}

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
    if (!isOfferedImageGenerationModel(config.model)) {
      throw new Error(
        `${config.model} is not an offered image model. Use a model from the selector.`,
      );
    }
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
    if (!isOfferedImageGenerationModel(newConfig.model)) {
      throw new Error(
        `${newConfig.model} is not an offered image model. Use a model from the selector.`,
      );
    }
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
