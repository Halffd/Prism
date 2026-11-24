// Browser-side media host. All wire construction and response parsing is
// owned by prism-core through the WASM bridge; this module only drives
// fetch and maps results into `<img>`-ready data URLs.

import {
  type MediaRequestInput,
  type WasmCore,
  buildA1111Body,
  buildComfyUiWorkflow,
  comfyUiImageFromHistory,
  configureCoreWeb,
  loadCore,
  mediaDefaultBaseUrl,
  parseA1111Images,
  parseTaskId,
  renderNativeImage,
} from '@prism/ai-core';

// The bundled Prism native server listens on 7861; stock A1111 uses 7860.
export const NATIVE_A1111_URL = 'http://127.0.0.1:7861';
export const NATIVE_ID = 'native';
export const A1111_ID = 'a1111';
export const COMFYUI_ID = 'comfyui';

let corePromise: Promise<WasmCore> | null = null;

/** Load the browser wasm from Next's static assets. */
export function getCore(): Promise<WasmCore> {
  if (!corePromise) {
    configureCoreWeb('/wasm-pkg-web/prism_wasm.js');
    const pending = loadCore();
    corePromise = pending;
    return pending;
  }
  return corePromise;
}

export interface GeneratedImage {
  url: string;
  label: string;
}

export interface ImageForm {
  provider: string;
  checkpoint: string;
  vae: string;
  clipSkip: number;
  loras: { name: string; weight: number }[];
  prompt: string;
  negativePrompt: string;
  sampler: string;
  scheduler: string;
  steps: number;
  cfg: number;
  denoise: number;
  width: number | null;
  height: number | null;
  batch: number;
  seed: number | null;
  baseUrl: string;
}

export function defaultBaseUrl(core: WasmCore, provider: string): string {
  if (provider === A1111_ID) return NATIVE_A1111_URL;
  const fromCore = mediaDefaultBaseUrl(core, provider);
  return fromCore || 'http://127.0.0.1:8188';
}

export function toMediaRequest(
  core: WasmCore,
  form: ImageForm,
  seed: number | null,
  batch = 1,
): MediaRequestInput {
  const base = form.baseUrl.trim() || defaultBaseUrl(core, form.provider);
  return {
    provider: form.provider,
    base_url: base,
    prompt: form.prompt.trim(),
    negative_prompt: form.negativePrompt.trim() || null,
    model: form.checkpoint.trim() || null,
    vae: form.vae.trim() || null,
    clip_skip: form.clipSkip,
    loras: form.loras.filter((lora) => lora.name.trim()),
    sampler: form.sampler,
    scheduler: form.scheduler,
    steps: form.steps,
    cfg: form.cfg,
    denoise: form.denoise,
    batch,
    width: form.width,
    height: form.height,
    seed,
  };
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`);
  }
  return response.text();
}

function renderNative(
  core: WasmCore,
  form: ImageForm,
  seed: number | null,
): Promise<GeneratedImage[]> {
  const batch = Math.max(1, Math.min(8, form.batch));
  const baseSeed = seed ?? Math.floor(Math.random() * 2 ** 31);
  const images: GeneratedImage[] = [];
  for (let index = 0; index < batch; index++) {
    const request = toMediaRequest(core, form, baseSeed + index, 1);
    const url = renderNativeImage(core, request);
    images.push({ url, label: `seed ${baseSeed + index}` });
  }
  return Promise.resolve(images);
}

async function generateA1111(
  core: WasmCore,
  form: ImageForm,
  seed: number | null,
): Promise<GeneratedImage[]> {
  const request = toMediaRequest(core, form, seed);
  const body = buildA1111Body(core, request);
  const base = (request.base_url ?? '').replace(/\/+$/, '');
  const raw = await fetchText(`${base}/sdapi/v1/txt2img`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return parseA1111Images(core, raw).map((url: string, index: number) => ({
    url,
    label: `${form.provider} result ${index + 1}`,
  }));
}

async function comfyCheckpoint(core: WasmCore, form: ImageForm): Promise<string> {
  const base = (form.baseUrl.trim() || defaultBaseUrl(core, form.provider)).replace(/\/+$/, '');
  const raw = await fetchText(`${base}/object_info/CheckpointLoaderSimple`);
  const info = JSON.parse(raw) as {
    CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: unknown[] } } };
  };
  const options = info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
  if (Array.isArray(options)) {
    const names = options.filter((item): item is string => typeof item === 'string');
    if (names.length && form.checkpoint.trim()) {
      const match = names.find((name) => name === form.checkpoint.trim());
      if (match) return match;
    }
    if (names.length) return names[0];
  }
  return form.checkpoint.trim();
}

async function generateComfyUi(
  core: WasmCore,
  form: ImageForm,
  seed: number | null,
): Promise<GeneratedImage[]> {
  const checkpoint = await comfyCheckpoint(core, form);
  const request = toMediaRequest(core, { ...form, checkpoint }, seed);
  const workflow = buildComfyUiWorkflow(core, request, checkpoint);
  const base = (request.base_url ?? '').replace(/\/+$/, '');
  const submitted = await fetchText(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });
  const taskId = parseTaskId(core, submitted);
  for (let attempt = 0; attempt < 90; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const history = await fetchText(`${base}/history/${encodeURIComponent(taskId)}`);
    let ready = false;
    try {
      const parsed = JSON.parse(history) as Record<string, { outputs?: unknown }>;
      ready = !!parsed[taskId]?.outputs;
    } catch {
      ready = false;
    }
    if (ready) {
      const [filename, subfolder, type] = comfyUiImageFromHistory(core, history);
      const params = new URLSearchParams({ filename, subfolder, type });
      return [
        {
          url: `${base}/view?${params.toString()}`,
          label: `${form.provider} result`,
        },
      ];
    }
  }
  throw new Error(`${form.provider} did not finish in time`);
}

/** Generate one batch through the selected backend. */
export async function generateImages(
  core: WasmCore,
  form: ImageForm,
  seed: number | null,
): Promise<GeneratedImage[]> {
  if (!form.prompt.trim()) throw new Error('Enter a prompt first.');
  switch (form.provider) {
    case NATIVE_ID:
      return renderNative(core, form, seed);
    case A1111_ID:
      return generateA1111(core, form, seed);
    case COMFYUI_ID:
      return generateComfyUi(core, form, seed);
    default:
      throw new Error(`unknown image backend: ${form.provider}`);
  }
}
