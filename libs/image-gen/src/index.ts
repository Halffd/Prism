import { HfInference } from '@huggingface/inference';

export interface ImageGenerationConfig {
  model: string;
  apiKey: string;
}

export interface ImageGenerationResult {
  imageUrl: string;
  imageBlob?: Blob;
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
        imageBlob: blob
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
      stableDiffusion: [
        'stabilityai/stable-diffusion-2-1',
        'runwayml/stable-diffusion-v1-5',
        'stabilityai/stable-diffusion-xl-base-1.0'
      ],
      flux: [
        'black-forest-labs/FLUX.1-schnell',
        'black-forest-labs/FLUX.1-dev'
      ]
    };
  }
}