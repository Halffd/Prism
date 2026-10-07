import type { InpaintRequest, InpaintResult, Result, ServiceConfig } from '@prism/shared-types';

export interface InpaintService {
  readonly provider: string;
  inpaint(request: InpaintRequest): Promise<Result<InpaintResult>>;
}

export class StabilityInpaintService implements InpaintService {
  readonly provider = 'stability';
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  async inpaint(request: InpaintRequest): Promise<Result<InpaintResult>> {
    try {
      const formData = new FormData();
      const imageBlob = typeof request.image === 'string'
        ? await this.urlToBlob(request.image)
        : request.image;
      const maskBlob = typeof request.mask === 'string'
        ? await this.urlToBlob(request.mask)
        : request.mask;

      formData.append('image', imageBlob);
      formData.append('mask', maskBlob);
      formData.append('prompt', request.prompt);
      if (request.negativePrompt) formData.append('negative_prompt', request.negativePrompt);
      formData.append('output_format', 'png');

      const response = await fetch(
        `${this.config.apiUrl || 'https://api.stability.ai/v2beta'}/stable-image/edit/inpaint`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Accept': 'image/*',
          },
          body: formData,
        },
      );

      if (!response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        return { ok: false, error: (data.message as string) || 'Stability inpaint request failed' };
      }

      const image = await response.blob();
      return { ok: true, value: { image } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown inpaint error' };
    }
  }

  private async urlToBlob(url: string): Promise<Blob> {
    const response = await fetch(url);
    return response.blob();
  }
}

export class HuggingFaceInpaintService implements InpaintService {
  readonly provider = 'huggingface';
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  async inpaint(request: InpaintRequest): Promise<Result<InpaintResult>> {
    try {
      const imageBlob = typeof request.image === 'string'
        ? await this.urlToBlob(request.image)
        : request.image;
      const maskBlob = typeof request.mask === 'string'
        ? await this.urlToBlob(request.mask)
        : request.mask;

      const formData = new FormData();
      formData.append('image', imageBlob);
      formData.append('mask', maskBlob);
      formData.append('prompt', request.prompt);

      const model = this.config.model || 'runwayml/stable-diffusion-inpainting';
      const response = await fetch(
        `${this.config.apiUrl || 'https://api-inference.huggingface.co/models'}/${model}`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
          body: formData,
        },
      );

      if (!response.ok) {
        const data = (await response.json()) as Record<string, unknown>;
        return { ok: false, error: (data.error as string) || 'HuggingFace inpaint request failed' };
      }

      const image = await response.blob();
      return { ok: true, value: { image } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown inpaint error' };
    }
  }

  private async urlToBlob(url: string): Promise<Blob> {
    const response = await fetch(url);
    return response.blob();
  }
}

export class FireworksInpaintService implements InpaintService {
  readonly provider = 'fireworks';
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  async inpaint(request: InpaintRequest): Promise<Result<InpaintResult>> {
    try {
      const imageBase64 = typeof request.image === 'string'
        ? request.image
        : await this.blobToBase64(request.image);
      const maskBase64 = typeof request.mask === 'string'
        ? request.mask
        : await this.blobToBase64(request.mask);

      const response = await fetch(
        `${this.config.apiUrl || 'https://api.fireworks.ai/inference/v1'}/image_generation/inpainting`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.config.model || 'stability/stable-diffusion-xl-inpainting',
            prompt: request.prompt,
            negative_prompt: request.negativePrompt,
            image: imageBase64,
            mask: maskBase64,
            num_inference_steps: request.numInferenceSteps || 30,
            guidance_scale: request.guidanceScale || 7.5,
          }),
        },
      );

      if (!response.ok) {
        const errData = (await response.json()) as Record<string, unknown>;
        const err = errData.error as Record<string, unknown> | undefined;
        return { ok: false, error: (err?.message as string) || 'Fireworks inpaint request failed' };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const images = data.images as Array<string> | undefined;
      const dataArray = data.data as Array<Record<string, unknown>> | undefined;
      const imageBase64Result: string | undefined = images?.[0] || (dataArray?.[0]?.b64_json as string | undefined);
      if (!imageBase64Result) {
        return { ok: false, error: 'No image in response' };
      }

      const binary = atob(imageBase64Result);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const image = new Blob([bytes], { type: 'image/png' });

      return { ok: true, value: { image } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown inpaint error' };
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}
