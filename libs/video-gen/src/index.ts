import type { VideoGenRequest, VideoGenResult, Result, ServiceConfig } from '@prism/shared-types';

export interface VideoGenService {
  readonly provider: string;
  generate(request: VideoGenRequest): Promise<Result<VideoGenResult>>;
}

export class RunwayVideoGenService implements VideoGenService {
  readonly provider = 'runway';
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  async generate(request: VideoGenRequest): Promise<Result<VideoGenResult>> {
    try {
      const body: Record<string, unknown> = {
        promptText: request.prompt,
        ratio: request.aspectRatio || '16:9',
        duration: request.duration || 5,
      };
      if (request.seed !== undefined) body.seed = request.seed;

      const taskResponse = await fetch(
        `${this.config.apiUrl || 'https://api.dev.runwayml.com/v1'}/image_to_video`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
            'X-Runway-Version': '2024-11-06',
          },
          body: JSON.stringify(body),
        },
      );

      if (!taskResponse.ok) {
        const data = (await taskResponse.json()) as Record<string, unknown>;
        return { ok: false, error: (data.error as string) || 'Runway video gen request failed' };
      }

      const taskData = (await taskResponse.json()) as Record<string, unknown>;
      const taskId = taskData.id as string;

      for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise((r) => setTimeout(r, 5000));
        const pollResp = await fetch(
          `${this.config.apiUrl || 'https://api.dev.runwayml.com/v1'}/tasks/${taskId}`,
          { headers: { Authorization: `Bearer ${this.config.apiKey}`, 'X-Runway-Version': '2024-11-06' } },
        );
        if (!pollResp.ok) continue;
        const pollData = (await pollResp.json()) as Record<string, unknown>;
        const status = pollData.status as string;
        if (status === 'SUCCEEDED') {
          const output = pollData.output as Record<string, unknown>[] | undefined;
          const videoUrl = output?.[0]?.url as string | undefined;
          if (!videoUrl) return { ok: false, error: 'Runway returned success but no video URL' };
          const videoResp = await fetch(videoUrl);
          const video = await videoResp.blob();
          return { ok: true, value: { video, videoUrl, duration: request.duration || 5, format: request.outputFormat || 'mp4' } };
        }
        if (status === 'FAILED') {
          return { ok: false, error: 'Runway video generation task failed' };
        }
      }
      return { ok: false, error: 'Runway video generation timed out' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown video gen error' };
    }
  }
}

export class KlingVideoGenService implements VideoGenService {
  readonly provider = 'kling';
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  async generate(request: VideoGenRequest): Promise<Result<VideoGenResult>> {
    try {
      const body: Record<string, unknown> = {
        prompt: request.prompt,
        duration: request.duration || 5,
        aspect_ratio: request.aspectRatio || '16:9',
      };
      if (request.seed !== undefined) body.seed = request.seed;

      const taskResponse = await fetch(
        `${this.config.apiUrl || 'https://api.klingai.com/v1'}/videos/generations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
        },
      );

      if (!taskResponse.ok) {
        const data = (await taskResponse.json()) as Record<string, unknown>;
        return { ok: false, error: (data.message as string) || 'Kling video gen request failed' };
      }

      const taskData = (await taskResponse.json()) as Record<string, unknown>;
      const taskResp = taskData.data as Record<string, unknown> | undefined;
      const taskId = taskResp?.task_id as string | undefined;
      if (!taskId) return { ok: false, error: 'Kling returned no task ID' };

      for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise((r) => setTimeout(r, 5000));
        const pollResp = await fetch(
          `${this.config.apiUrl || 'https://api.klingai.com/v1'}/videos/generations/${taskId}`,
          { headers: { Authorization: `Bearer ${this.config.apiKey}` } },
        );
        if (!pollResp.ok) continue;
        const pollData = (await pollResp.json()) as Record<string, unknown>;
        const pollRespData = pollData.data as Record<string, unknown> | undefined;
        const status = pollRespData?.task_status as string | undefined;
        if (status === 'succeed') {
          const videos = pollRespData?.task_result as Record<string, unknown>[] | undefined;
          const videoUrl = videos?.[0]?.url as string | undefined;
          if (!videoUrl) return { ok: false, error: 'Kling returned success but no video URL' };
          const videoResp = await fetch(videoUrl);
          const video = await videoResp.blob();
          return { ok: true, value: { video, videoUrl, duration: request.duration || 5, format: request.outputFormat || 'mp4' } };
        }
        if (status === 'failed') {
          return { ok: false, error: 'Kling video generation task failed' };
        }
      }
      return { ok: false, error: 'Kling video generation timed out' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown video gen error' };
    }
  }
}

export class LumaVideoGenService implements VideoGenService {
  readonly provider = 'luma';
  private config: ServiceConfig;

  constructor(config: ServiceConfig) {
    this.config = config;
  }

  async generate(request: VideoGenRequest): Promise<Result<VideoGenResult>> {
    try {
      const body: Record<string, unknown> = {
        prompt: request.prompt,
        aspect_ratio: request.aspectRatio || '16:9',
      };
      const taskResponse = await fetch(
        `${this.config.apiUrl || 'https://api.lumalabs.ai/dream-machine/v1'}/generations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
        },
      );

      if (!taskResponse.ok) {
        const data = (await taskResponse.json()) as Record<string, unknown>;
        return { ok: false, error: (data.detail as string) || 'Luma video gen request failed' };
      }

      const taskData = (await taskResponse.json()) as Record<string, unknown>;
      const taskId = taskData.id as string;

      for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise((r) => setTimeout(r, 5000));
        const pollResp = await fetch(
          `${this.config.apiUrl || 'https://api.lumalabs.ai/dream-machine/v1'}/generations/${taskId}`,
          { headers: { Authorization: `Bearer ${this.config.apiKey}` } },
        );
        if (!pollResp.ok) continue;
        const pollData = (await pollResp.json()) as Record<string, unknown>;
        const state = pollData.state as string;
        if (state === 'completed') {
          const assets = pollData.assets as Record<string, unknown> | undefined;
          const videoUrl = assets?.video as string | undefined;
          if (!videoUrl) return { ok: false, error: 'Luma returned success but no video URL' };
          const videoResp = await fetch(videoUrl);
          const video = await videoResp.blob();
          return { ok: true, value: { video, videoUrl, duration: request.duration || 5, format: request.outputFormat || 'mp4' } };
        }
        if (state === 'failed') {
          return { ok: false, error: 'Luma video generation task failed' };
        }
      }
      return { ok: false, error: 'Luma video generation timed out' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown video gen error' };
    }
  }
}
