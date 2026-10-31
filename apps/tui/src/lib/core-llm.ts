// TUI provider path, swapped onto prism-core via the WASM bindings
// (migration step 6). Hosts drive HTTP; the core builds request bodies
// and decodes response streams. Mirrors the egui/Slint routing policy:
// server mode → prism-api; local mode → Ollama native when hardware
// overrides are set, else OpenAI-compat; api mode → direct
// OpenAI-compatible stream.
//
// KoboldCpp note: the old hand-rolled adapter used the legacy
// /api/v1/generate API; the core contract uses KoboldCpp's
// OpenAI-compatible /v1 endpoint.

import { createRequire } from 'module';
import type { HardwareProfile } from '@prism/shared-types';

const wasmPath = './wasm-pkg/prism_wasm.js';
// Anchor at this module so the pkg resolves next to whichever artifact
// loaded it (ESM bundle: import.meta.url; CJS test compile: __filename).
const moduleAnchor =
  typeof import.meta !== 'undefined' && import.meta.url
    ? import.meta.url
    : typeof __filename !== 'undefined'
      ? __filename
      : process.cwd() + '/index.js';
const nodeRequire = createRequire(moduleAnchor);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const wasm = nodeRequire(wasmPath) as WasmCore;

interface WasmSseDecoder {
  feed(chunk: Uint8Array): string;
  finish(): string;
  is_done(): boolean;
}

interface WasmNdjsonDecoder {
  feed(chunk: Uint8Array): string;
  finish(): string;
  is_done(): boolean;
}

interface WasmCore {
  SseDecoder: new () => WasmSseDecoder;
  NdjsonDecoder: new () => WasmNdjsonDecoder;
  build_stream_body: (reqJson: string) => string;
  build_ollama_body: (reqJson: string) => string;
  build_api_chat_body: (reqJson: string) => string;
  parse_api_response: (body: string) => string;
  ollama_root_url: (base: string) => string;
  providers_json: () => string;
}

export type CoreConnection = 'api' | 'server' | 'local';

export interface CoreChatRequest {
  connection: CoreConnection;
  /** aiConfig.provider — openai | gemini | qwen | ollama | llamacpp | koboldcpp | sglang */
  provider: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  /** Direct-mode base URL override (aiConfig.apiUrl). */
  apiUrl?: string;
  /** Local-mode server URL (settings.localApiUrl). */
  localApiUrl?: string;
  hardware?: HardwareProfile;
  prismApiUrl?: string;
  prismApiKey?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

type StreamEvent = { Chunk: string } | 'Done' | { Error: string };

interface ProviderDef {
  id: string;
  base_url: string;
  needs_key?: boolean;
  /** Env-var names that may carry the key (matches core ProviderDef.env). */
  env?: string[];
}

let providerTable: ProviderDef[] | null = null;

function providers(): ProviderDef[] {
  if (!providerTable) {
    providerTable = JSON.parse(wasm.providers_json()) as ProviderDef[];
  }
  return providerTable;
}

function providerBaseUrl(provider: string): string {
  return (
    providers().find((p) => p.id === provider)?.base_url ??
    'https://api.openai.com/v1'
  );
}

function ensureV1Suffix(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/** Ollama native path only when hardware overrides must reach the server. */
function hasHardwareOverrides(hw?: HardwareProfile): boolean {
  return (
    !!hw &&
    (hw.gpuLayersOverride !== undefined ||
      hw.contextTokens !== undefined ||
      hw.preferredCompute === 'cpu-only')
  );
}

function parseBodyResult(json: string): string {
  const parsed = JSON.parse(json) as { Ok?: unknown; Err?: string };
  if (parsed.Err !== undefined || parsed.Ok === undefined) {
    throw new Error(`core rejected request: ${parsed.Err ?? 'unknown'}`);
  }
  // The builder embeds the body as a JSON value inside {"Ok": ...}.
  return JSON.stringify(parsed.Ok);
}

/** Drain decoded events; concatenate chunk text; throw on Error events. */
async function decodeStreamToText(
  body: AsyncIterable<Uint8Array>,
  decoder: WasmSseDecoder | WasmNdjsonDecoder,
): Promise<string> {
  let text = '';
  for await (const chunk of body) {
    const events = JSON.parse(decoder.feed(chunk)) as StreamEvent[];
    for (const event of events) {
      if (typeof event === 'string') {
        if (event === 'Done') return text;
      } else if ('Chunk' in event) {
        text += event.Chunk;
      } else if ('Error' in event) {
        throw new Error(event.Error);
      }
    }
  }
  JSON.parse(decoder.finish()) as StreamEvent[];
  return text;
}

async function directStream(
  base: string,
  apiKey: string,
  bodyJson: string,
): Promise<string> {
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: bodyJson,
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `server returned ${response.status}: ${text.slice(0, 300)}`,
    );
  }
  return decodeStreamToText(
    response.body as unknown as AsyncIterable<Uint8Array>,
    new wasm.SseDecoder(),
  );
}

/** Full assistant text for a chat request, via the core. */
export async function coreChat(req: CoreChatRequest): Promise<string> {
  if (req.connection === 'server') {
    if (!req.prismApiKey) {
      throw new Error('Prism API token required');
    }
    const last = req.messages[req.messages.length - 1]?.content ?? '';
    const bodyJson = parseBodyResult(
      wasm.build_api_chat_body(
        JSON.stringify({
          server_url: req.prismApiUrl ?? 'http://localhost:3000',
          token: req.prismApiKey,
          content: last,
        }),
      ),
    );
    const response = await fetch(
      `${(req.prismApiUrl ?? 'http://localhost:3000').replace(/\/+$/, '')}/api/chat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${req.prismApiKey}`,
        },
        body: bodyJson,
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `server returned ${response.status}: ${text.slice(0, 300)}`,
      );
    }
    const parsed = JSON.parse(
      wasm.parse_api_response(await response.text()),
    ) as { Ok?: string; Err?: string };
    if (parsed.Err !== undefined) {
      throw new Error(parsed.Err);
    }
    return parsed.Ok ?? '';
  }

  if (
    req.connection === 'local' &&
    req.provider === 'ollama' &&
    hasHardwareOverrides(req.hardware)
  ) {
    // Ollama native: hardware overrides reach the server here.
    const root = wasm.ollama_root_url(
      req.localApiUrl ?? 'http://localhost:11434',
    );
    const bodyJson = parseBodyResult(
      wasm.build_ollama_body(
        JSON.stringify({
          base_url: root,
          model: req.model,
          temperature: req.temperature,
          messages: req.messages,
          num_ctx: req.hardware?.contextTokens,
          num_gpu:
            req.hardware?.preferredCompute === 'cpu-only'
              ? 0
              : req.hardware?.gpuLayersOverride,
          max_tokens: req.maxTokens,
        }),
      ),
    );
    const response = await fetch(`${root}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyJson,
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `server returned ${response.status}: ${text.slice(0, 300)}`,
      );
    }
    return decodeStreamToText(
      response.body as unknown as AsyncIterable<Uint8Array>,
      new wasm.NdjsonDecoder(),
    );
  }

  if (req.connection === 'local') {
    // Local OpenAI-compat (llamacpp / sglang / kobold / ollama-without-overrides).
    const raw = req.localApiUrl ?? providerBaseUrl(req.provider);
    const base = req.provider === 'ollama' ? raw : ensureV1Suffix(raw);
    const bodyJson = parseBodyResult(
      wasm.build_stream_body(
        JSON.stringify({
          base_url: base,
          api_key: req.apiKey,
          model: req.model,
          temperature: req.temperature,
          messages: req.messages,
          max_tokens: req.maxTokens,
        }),
      ),
    );
    return directStream(base, req.apiKey, bodyJson);
  }

  // Direct api mode.
  const base = req.apiUrl?.trim()
    ? req.apiUrl.trim().replace(/\/+$/, '')
    : providerBaseUrl(req.provider);
  const bodyJson = parseBodyResult(
    wasm.build_stream_body(
      JSON.stringify({
        base_url: base,
        api_key: req.apiKey,
        model: req.model,
        temperature: req.temperature,
        messages: req.messages,
        max_tokens: req.maxTokens,
      }),
    ),
  );
  return directStream(base, req.apiKey, bodyJson);
}
