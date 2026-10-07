import type { ModelGenRequest, ModelGenResult, Result, ServiceConfig } from '@prism/shared-types';

export interface ModelGenService {
  readonly provider: string;
  generate(request: ModelGenRequest): Promise<Result<ModelGenResult>>;
}

export class MeshyModelGenService implements ModelGenService {
  readonly provider = 'meshy';
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  async generate(request: ModelGenRequest): Promise<Result<ModelGenResult>> {
    try {
      const body: Record<string, unknown> = {
        mode: 'text_to_3d',
        prompt: request.prompt,
        art_style: 'realistic',
        negative_prompt: 'low quality, low resolution, bad anatomy',
      };

      if (request.image) {
        body.mode = 'image_to_3d';
        const imageBase64 = typeof request.image === 'string'
          ? request.image
          : await this.blobToBase64(request.image);
        body.image_url = imageBase64;
      }

      const createResponse = await fetch(`${this.config.apiUrl || 'https://api.meshy.ai/v2'}/text-to-3d`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const createData = (await createResponse.json()) as Record<string, unknown>;
      if (!createResponse.ok) {
        return { ok: false, error: (createData.error as string) || 'Meshy model gen request failed' };
      }

      const taskId = createData.result as string;
      const model = await this.pollTask(taskId, request.format || 'glb');
      return { ok: true, value: { model, format: request.format || 'glb' } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown model gen error' };
    }
  }

  private async pollTask(taskId: string, format: string, maxAttempts = 120): Promise<Blob> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const response = await fetch(`${this.config.apiUrl || 'https://api.meshy.ai/v2'}/text-to-3d/${taskId}`, {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
      });
      const data = (await response.json()) as Record<string, unknown>;
      const status = data.status as string;
      if (status === 'SUCCEEDED') {
        const modelUrls = data.model_urls as Record<string, string> | undefined;
        const modelUrl = modelUrls?.[format] || modelUrls?.glb;
        if (!modelUrl) throw new Error('No model URL in response');
        const modelResponse = await fetch(modelUrl);
        return modelResponse.blob();
      }
      if (status === 'FAILED') {
        throw new Error((data.error as string) || 'Meshy task failed');
      }
    }
    throw new Error('Meshy task timed out');
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

export class TripoModelGenService implements ModelGenService {
  readonly provider = 'tripo';
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  async generate(request: ModelGenRequest): Promise<Result<ModelGenResult>> {
    try {
      const body: Record<string, unknown> = {
        type: 'text_to_model',
        prompt: request.prompt,
      };

      if (request.image) {
        body.type = 'image_to_model';
        const imageBase64 = typeof request.image === 'string'
          ? request.image
          : await this.blobToBase64(request.image);
        body.file = imageBase64;
      }

      const createResponse = await fetch(`${this.config.apiUrl || 'https://api.tripo3d.ai/v2'}/task`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const createData = (await createResponse.json()) as Record<string, unknown>;
      if (!createResponse.ok) {
        return { ok: false, error: (createData.message as string) || 'Tripo model gen request failed' };
      }

      const data = createData.data as Record<string, unknown> | undefined;
      const taskId = data?.task_id as string | undefined;
      if (!taskId) {
        return { ok: false, error: 'No task ID in Tripo response' };
      }

      const model = await this.pollTask(taskId, request.format || 'glb');
      return { ok: true, value: { model, format: request.format || 'glb' } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown model gen error' };
    }
  }

  private async pollTask(taskId: string, format: string, maxAttempts = 120): Promise<Blob> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const response = await fetch(`${this.config.apiUrl || 'https://api.tripo3d.ai/v2'}/task/${taskId}`, {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
      });
      const respData = (await response.json()) as Record<string, unknown>;
      const data = respData.data as Record<string, unknown> | undefined;
      const status = data?.status as string | undefined;
      if (status === 'success') {
        const modelData = data?.model as Record<string, string> | undefined;
        const modelUrl = modelData?.[format] || modelData?.glb;
        if (!modelUrl) throw new Error('No model URL in Tripo response');
        const modelResponse = await fetch(modelUrl);
        return modelResponse.blob();
      }
      if (status === 'failed') {
        throw new Error((data?.message as string) || 'Tripo task failed');
      }
    }
    throw new Error('Tripo task timed out');
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
